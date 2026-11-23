// The public counter: reads the Rung program's transactions from the chain
// (server side only) and counts its events. Cached on the server with
// `use cache` + `cacheLife`, so visitors do not each hit the RPC.

import { cacheLife } from "next/cache";

import {
  RUNG_IX,
  RUNG_ORDER_FILLED_ERROR,
  base58Decode,
  failingProgramFromLogs,
  isVenueSlippage,
  parseEvents,
  startsWith,
  type RungIx,
  type Venue,
} from "./rung-events";
import { STATUS } from "./status";

/** Newest signatures read per refresh. */
export const MAX_SIGNATURES = 1000;
const PAGE_SIZE = 1000;
/** getTransaction calls in flight at once. */
const CONCURRENCY = 4;
/**
 * The public endpoint allows about 10 getTransaction calls per 10 s per IP
 * (measured on Nov 23, 2026: the 11th call got 429 with Retry-After: 10,
 * also inside a JSON-RPC batch). Without RPC_URL the calls are paced to that.
 */
const PUBLIC_RATE = { calls: 10, perMs: 10_500 };
const MAX_ATTEMPTS = 6;
const REQUEST_TIMEOUT_MS = 15_000;
/**
 * The whole read must finish inside Next's cache-fill limit for a prerender
 * (`experimental.useCacheTimeout`, 50 s by default). Past this budget the read
 * gives up and the page shows "counter unavailable"; transactions already read
 * stay memoised in this instance, so the next refresh continues from there.
 */
const BUDGET_MS = 38_000;

export interface RungBucket {
  rungIndex: number;
  rungBps: number;
  buys: number;
}

export interface RecentOrder {
  time: number | null; // unix seconds
  outcome: "bought" | "not bought";
  rungIndex?: number;
  rungBps?: number;
  signature: string;
}

export interface CounterData {
  network: string;
  readAt: number; // ms
  signaturesRead: number;
  hitSignatureCap: boolean;
  transactionsSkipped: number;
  opened: number;
  /** Of `opened`, orders on a PumpSwap pool (the rest are on a bonding curve). */
  openedOnPools: number;
  filled: number;
  notBought: number;
  cancelled: number;
  stillOpen: number;
  doubleBuys: number;
  fillEvents: number;
  eventsWithoutOpenInWindow: number;
  avgRungBps: number | null;
  rungs: RungBucket[];
  feesLamports: { total: number; openOrder: number; tryRung: number; refundCancel: number };
  programTransactions: { total: number; failed: number };
  failedTries: { slippage: number; orderFilled: number; other: number };
  recent: RecentOrder[];
}

export type CounterResult =
  | { ok: true; data: CounterData }
  | { ok: false; error: string; lastGood: CounterData | null };

// Last good read in this server instance (best effort: serverless instances
// are short-lived). Only plain, already-resolved values are stored here.
let lastGood: CounterData | null = null;

export async function getCounter(): Promise<CounterResult> {
  "use cache";
  // stale/revalidate 60 s: at most one refresh per minute in the background;
  // expire 1 h (>= 5 min) keeps the result in the prerendered page.
  cacheLife({ stale: 60, revalidate: 60, expire: 3600 });
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(new Error("RPC read took longer than the time budget"));
    }, BUDGET_MS);
  });
  try {
    // A hard stop: the cached function must return before Next's fill limit,
    // whatever the RPC does.
    const data = await Promise.race([readCounter(abort.signal), timeout]);
    lastGood = data;
    return { ok: true, data };
  } catch (e) {
    abort.abort();
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[counter] ${error} (transactions memoised: ${txMemo.size})`);
    return { ok: false, error, lastGood };
  } finally {
    clearTimeout(timer);
  }
}

// --- JSON-RPC -----------------------------------------------------------------

function rpcUrl(): string {
  // Server-side only; never NEXT_PUBLIC_, so it is not sent to the browser.
  return process.env.RPC_URL?.trim() || STATUS.publicRpc;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(new Error("aborted"))), { once: true });
  });
}

/** Paces calls to the public endpoint (sliding window), and backs off together on a 429. */
const limiter = {
  sent: [] as number[],
  blockedUntil: 0,
  async take(signal: AbortSignal) {
    if (process.env.RPC_URL?.trim()) return;
    for (;;) {
      const now = Date.now();
      while (this.sent.length && now - this.sent[0] >= PUBLIC_RATE.perMs) this.sent.shift();
      if (now >= this.blockedUntil && this.sent.length < PUBLIC_RATE.calls) {
        this.sent.push(now);
        return;
      }
      const wait = Math.max(this.blockedUntil - now, this.sent.length ? PUBLIC_RATE.perMs - (now - this.sent[0]) : 0);
      await sleep(wait + 10, signal);
    }
  },
};

async function rpc<T>(method: string, params: unknown[], signal: AbortSignal): Promise<T> {
  let lastError = "";
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await limiter.take(signal);
    let retryAfterMs = 500 * 2 ** attempt;
    try {
      const res = await fetch(rpcUrl(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        cache: "no-store",
      });
      if (res.status === 429 || res.status >= 500) {
        const header = Number(res.headers.get("retry-after"));
        if (header > 0) retryAfterMs = Math.max(retryAfterMs, header * 1000);
        if (res.status === 429) limiter.blockedUntil = Math.max(limiter.blockedUntil, Date.now() + retryAfterMs);
        lastError = `HTTP ${res.status}`;
      } else if (!res.ok) {
        throw new Error(`HTTP ${res.status} from RPC (${method})`);
      } else {
        const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
        if (!body.error) return body.result as T;
        // Rate-limit and node-busy errors are retried; anything else is final.
        if (![429, -32429, -32005].includes(body.error.code)) {
          throw new Error(`RPC error ${body.error.code} (${method}): ${body.error.message}`);
        }
        lastError = `RPC error ${body.error.code}`;
      }
    } catch (e) {
      if (signal.aborted) throw new Error("aborted");
      if (e instanceof Error && /^(HTTP \d+ from RPC|RPC error)/.test(e.message)) throw e;
      lastError = e instanceof Error ? e.message : String(e);
    }
    await sleep(retryAfterMs, signal);
  }
  throw new Error(`RPC unavailable (${method}): ${lastError}`);
}

interface SignatureInfo {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown;
}

interface RawTransaction {
  slot: number;
  blockTime: number | null;
  meta: {
    err: unknown;
    fee: number;
    logMessages: string[] | null;
    loadedAddresses?: { writable: string[]; readonly: string[] };
  } | null;
  transaction: {
    message: {
      accountKeys: string[];
      instructions: { programIdIndex: number; data: string }[];
    };
  };
}

/** The parts of a finalized transaction the counter needs. Never changes, so it is memoised. */
interface ReadTx {
  signature: string;
  slot: number;
  blockTime: number | null;
  failed: boolean;
  fee: number;
  /** Rung instructions at the top level, in order. */
  rungIxs: RungIx[];
  logs: string[];
}

const txMemo = new Map<string, ReadTx>();

function toReadTx(signature: string, raw: RawTransaction, programId: string): ReadTx {
  const keys = [
    ...raw.transaction.message.accountKeys,
    ...(raw.meta?.loadedAddresses?.writable ?? []),
    ...(raw.meta?.loadedAddresses?.readonly ?? []),
  ];
  const rungIxs: RungIx[] = [];
  for (const ix of raw.transaction.message.instructions) {
    if (keys[ix.programIdIndex] !== programId) continue;
    const data = base58Decode(ix.data);
    const name = (Object.keys(RUNG_IX) as RungIx[]).find((k) => startsWith(data, RUNG_IX[k]));
    if (name) rungIxs.push(name);
  }
  return {
    signature,
    slot: raw.slot,
    blockTime: raw.blockTime,
    failed: raw.meta?.err != null,
    fee: raw.meta?.fee ?? 0,
    rungIxs,
    logs: raw.meta?.logMessages ?? [],
  };
}

async function readSignatures(programId: string, signal: AbortSignal): Promise<SignatureInfo[]> {
  const out: SignatureInfo[] = [];
  let before: string | undefined;
  while (out.length < MAX_SIGNATURES) {
    const limit = Math.min(PAGE_SIZE, MAX_SIGNATURES - out.length);
    const page = await rpc<SignatureInfo[]>(
      "getSignaturesForAddress",
      [programId, { limit, commitment: "finalized", ...(before ? { before } : {}) }],
      signal,
    );
    out.push(...page);
    if (page.length < limit) break;
    before = page[page.length - 1].signature;
  }
  return out;
}

async function readTransactions(sigs: SignatureInfo[], programId: string, signal: AbortSignal) {
  const results = new Map<string, ReadTx>();
  let skipped = 0;
  const queue = sigs.filter((s) => {
    const hit = txMemo.get(s.signature);
    if (hit) results.set(s.signature, hit);
    return !hit;
  });
  let next = 0;
  async function worker() {
    while (next < queue.length) {
      const s = queue[next++];
      const raw = await rpc<RawTransaction | null>(
        "getTransaction",
        [s.signature, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "finalized" }],
        signal,
      );
      if (!raw) {
        skipped++;
        continue;
      }
      const tx = toReadTx(s.signature, raw, programId);
      txMemo.set(s.signature, tx);
      results.set(s.signature, tx);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { results, skipped };
}

// --- Counting -------------------------------------------------------------------

interface OrderState {
  venue: Venue;
  fills: { rungIndex: number; rungBps: number; signature: string; time: number | null }[];
  outcome?: { kind: "not bought" | "cancelled"; signature: string; time: number | null };
}

async function readCounter(signal: AbortSignal): Promise<CounterData> {
  const programId = STATUS.programId;
  const sigs = await readSignatures(programId, signal);
  const { results, skipped } = await readTransactions(sigs, programId, signal);

  // getSignaturesForAddress returns newest first; count oldest first.
  const txs = [...sigs]
    .reverse()
    .map((s) => results.get(s.signature))
    .filter((t): t is ReadTx => t !== undefined && t.rungIxs.length > 0);

  const fees = { total: 0, openOrder: 0, tryRung: 0, refundCancel: 0 };
  const failedTries = { slippage: 0, orderFilled: 0, other: 0 };
  let failedTxs = 0;
  const orders: OrderState[] = [];
  const current = new Map<string, OrderState>();
  let fillEvents = 0;
  let orphans = 0;

  for (const tx of txs) {
    fees.total += tx.fee;
    if (tx.rungIxs.includes("openOrder")) fees.openOrder += tx.fee;
    else if (tx.rungIxs.includes("tryRung")) fees.tryRung += tx.fee;
    else fees.refundCancel += tx.fee;

    if (tx.failed) {
      failedTxs++;
      if (tx.rungIxs.includes("tryRung")) {
        const f = failingProgramFromLogs(tx.logs);
        if (isVenueSlippage(f?.programId, f?.code)) failedTries.slippage++;
        else if (f?.programId === programId && f.code === RUNG_ORDER_FILLED_ERROR) failedTries.orderFilled++;
        else failedTries.other++;
      }
      continue; // a failed transaction changed nothing; its log lines are not events
    }

    for (const ev of parseEvents(tx.logs, programId)) {
      if (ev.name === "OrderOpened") {
        const order: OrderState = { venue: ev.venue, fills: [] };
        orders.push(order);
        current.set(ev.user, order);
        continue;
      }
      const order = current.get(ev.user);
      if (ev.name === "OrderFilled") fillEvents++;
      if (!order) {
        orphans++; // opened before the oldest transaction read
        continue;
      }
      if (ev.name === "OrderFilled") {
        order.fills.push({ rungIndex: ev.rungIndex, rungBps: ev.rungBps, signature: tx.signature, time: tx.blockTime });
      } else if (!order.outcome && order.fills.length === 0) {
        order.outcome = {
          kind: ev.reason === "Cancelled" ? "cancelled" : "not bought",
          signature: tx.signature,
          time: tx.blockTime,
        };
      }
    }
  }

  const filledOrders = orders.filter((o) => o.fills.length > 0);
  const buckets = new Map<string, RungBucket>();
  for (const o of filledOrders) {
    const f = o.fills[0];
    const key = `${f.rungIndex}:${f.rungBps}`;
    const b = buckets.get(key) ?? { rungIndex: f.rungIndex, rungBps: f.rungBps, buys: 0 };
    b.buys++;
    buckets.set(key, b);
  }

  const recent: RecentOrder[] = [];
  for (const o of orders) {
    if (o.fills.length > 0) {
      const f = o.fills[0];
      recent.push({ time: f.time, outcome: "bought", rungIndex: f.rungIndex, rungBps: f.rungBps, signature: f.signature });
    } else if (o.outcome?.kind === "not bought") {
      recent.push({ time: o.outcome.time, outcome: "not bought", signature: o.outcome.signature });
    }
  }
  recent.reverse(); // newest first (orders are in chain order)

  const notBought = orders.filter((o) => o.fills.length === 0 && o.outcome?.kind === "not bought").length;
  const cancelled = orders.filter((o) => o.fills.length === 0 && o.outcome?.kind === "cancelled").length;

  return {
    network: STATUS.network,
    readAt: Date.now(),
    signaturesRead: sigs.length,
    hitSignatureCap: sigs.length >= MAX_SIGNATURES,
    transactionsSkipped: skipped,
    opened: orders.length,
    openedOnPools: orders.filter((o) => o.venue === "PumpSwap").length,
    filled: filledOrders.length,
    notBought,
    cancelled,
    stillOpen: orders.length - filledOrders.length - notBought - cancelled,
    doubleBuys: filledOrders.filter((o) => o.fills.length > 1).length,
    fillEvents,
    eventsWithoutOpenInWindow: orphans,
    avgRungBps: filledOrders.length
      ? filledOrders.reduce((n, o) => n + o.fills[0].rungBps, 0) / filledOrders.length
      : null,
    rungs: [...buckets.values()].sort((a, b) => a.rungIndex - b.rungIndex || a.rungBps - b.rungBps),
    feesLamports: fees,
    programTransactions: { total: txs.length, failed: failedTxs },
    failedTries,
    recent: recent.slice(0, 10),
  };
}
