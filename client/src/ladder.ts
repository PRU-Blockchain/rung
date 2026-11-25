// The rung sender: tries each rung when it is due, signed by the session key,
// stops at the first fill, gives up with a refund after the last rung, and
// returns every lamport left on the session key to the user.

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionExpiredBlockheightExceededError,
  TransactionInstruction,
} from "@solana/web3.js";

import { Order, decodeOrder, rungDueSlot } from "./accounts";
import { DEFAULT_CU_PRICE, DEFAULT_REFUND_CU_LIMIT, cuLimitFor, sweepFeeLamports } from "./budget";
import { Failure, classifyFailure, describeFailure } from "./errors";
import { OrderFilled, OrderRefunded, findEvent } from "./events";
import { PoolAccounts, computeUnitLimitIx, computeUnitPriceIx, refundIx, tryRungIx } from "./instructions";
import { JITO_HOSTS, JitoOptions, jitoTipIx, runtimeFetch, sendToJito } from "./jito";
import { orderPda } from "./pdas";

export type AttemptKind = "try" | "refund" | "sweep";
export type Outcome =
  | "filled" // try_rung bought
  | "slippage" // the venue refused this rung's minimum (pump 6042, PumpSwap 6040)
  | "order-filled" // Rung says the order already bought
  | "failed" // any other error
  | "not-landed" // blockhash expired before the transaction landed
  | "dropped" // sent through Jito and never landed: it would not have filled (or no leader took it); costs nothing
  | "ok"; // refund or sweep succeeded

export interface Attempt {
  kind: AttemptKind;
  rungIndex?: number;
  rungBps?: number;
  dueSlot?: bigint;
  signature: string;
  /** Slot the transaction landed in. */
  slot?: number;
  /** `meta.fee`, lamports. */
  fee?: bigint;
  /** `meta.computeUnitsConsumed`. */
  computeUnits?: number;
  /** The Jito tip this try paid (only a try that landed and filled pays it). */
  tip?: bigint;
  /** The road a try took. */
  via?: "jito" | "rpc";
  outcome: Outcome;
  failure?: Failure;
  logs?: string[];
}

export type LadderEvent =
  | { type: "waiting"; rungIndex: number; dueSlot: bigint; slot: bigint }
  | { type: "sent"; kind: AttemptKind; rungIndex?: number; signature: string }
  | { type: "result"; attempt: Attempt; text: string };

export interface LadderParams {
  connection: Connection;
  user: PublicKey;
  mint: PublicKey;
  tokenProgram: PublicKey;
  /**
   * Curve order: one of pump's `Global.buyback_fee_recipients`. PumpSwap
   * order: the wrapped-SOL account of one of PumpSwap's (`findBuybackWsolAccounts`).
   */
  buybackRecipient: PublicKey;
  /** The canonical pool's accounts; required when the order's venue is PumpSwap. */
  pool?: PoolAccounts;
  /** The order's one-time key. Pays every fee here; ends with 0 lamports. */
  sessionKeypair: Keypair;
  /** The order as read after `open_order`; fetched if omitted. */
  order?: Order;
  /** Defaults to the order's venue limit (`cuLimitFor`). */
  cuLimit?: number;
  /** Micro-lamports per compute unit. */
  cuPrice?: bigint;
  refundCuLimit?: number;
  /** Slot polling interval. */
  pollMs?: number;
  /**
   * The try of rung 0 that was sent together with `open_order`
   * (`sendFirstTryEarly`). The ladder takes its result instead of sending
   * rung 0 itself.
   */
  firstTry?: EarlyTry;
  /** How long to wait for that early try before sending rung 0 the ordinary way. */
  firstTryWaitMs?: number;
  /**
   * Send the tries through Jito's block engine, each as a bundle of its own
   * (see jito.ts). A try that would not fill then never lands and costs
   * nothing, so the ladder moves to the next rung when that rung is due
   * instead of waiting for a failure. If the block engine cannot be reached
   * a try goes the ordinary road.
   */
  jito?: JitoOptions;
  onEvent?: (event: LadderEvent) => void;
}

export interface LadderResult {
  attempts: Attempt[];
  filled?: OrderFilled;
  refunded?: OrderRefunded;
  /** Lamports the sweep returned to the user. */
  sweptLamports: bigint;
  /** Session key balance at the end (0 when the sweep worked). */
  sessionBalanceAfter: bigint;
  /** Sum of `meta.fee` over every landed transaction here. */
  totalFees: bigint;
  /** Jito tips paid (at most one: the try that filled). */
  totalTips: bigint;
}

// Present in every JavaScript runtime this module targets; declared here so
// the module does not pull in Node or DOM type libraries.
declare function setTimeout(callback: () => void, ms: number): unknown;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Reads the order, retrying while the `open_order` transaction propagates. */
export async function fetchOrder(connection: Connection, user: PublicKey, tries = 10): Promise<Order | null> {
  for (let i = 0; i < tries; i++) {
    const info = await connection.getAccountInfo(orderPda(user), "confirmed");
    if (info) return decodeOrder(info.data);
    if (i + 1 < tries) await sleep(500);
  }
  return null;
}

export interface Landed {
  signature: string;
  landed: boolean;
  slot?: number;
  fee?: bigint;
  computeUnits?: number;
  err?: unknown;
  logs: string[];
}

/** Signs with `signer` (fee payer), sends without preflight, waits for `confirmed`. */
export async function sendAndConfirm(
  connection: Connection,
  instructions: TransactionInstruction[],
  signer: Keypair,
  onSent?: (signature: string) => void,
): Promise<Landed> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: signer.publicKey, blockhash, lastValidBlockHeight }).add(...instructions);
  tx.sign(signer);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  onSent?.(signature);
  return confirmSent(connection, { signature, blockhash, lastValidBlockHeight });
}

/** Waits for a transaction that was already sent and reads what it did. */
export async function confirmSent(
  connection: Connection,
  sent: { signature: string; blockhash: string; lastValidBlockHeight: number },
): Promise<Landed> {
  const { signature, blockhash, lastValidBlockHeight } = sent;
  try {
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  } catch (e) {
    if (e instanceof TransactionExpiredBlockheightExceededError) return { signature, landed: false, logs: [] };
    // web3.js 1.x can reject with the transaction's own status error, a plain
    // object such as `{ InstructionError: [2, { Custom: 6042 }] }`, when the
    // transaction landed and failed in a program. That is a result: read it
    // below like any other. Only real exceptions are rethrown.
    if (e instanceof Error) throw e;
  }
  return readLanded(connection, signature);
}

/** Reads what a transaction that has landed did. */
async function readLanded(connection: Connection, signature: string): Promise<Landed> {
  for (let i = 0; i < 20; i++) {
    const got = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (got?.meta) {
      return {
        signature,
        landed: true,
        slot: got.slot,
        fee: BigInt(got.meta.fee),
        computeUnits: got.meta.computeUnitsConsumed,
        err: got.meta.err ?? undefined,
        logs: got.meta.logMessages ?? [],
      };
    }
    await sleep(500);
  }
  // Confirmed but not yet served by getTransaction: report what the status says.
  const status = (await connection.getSignatureStatuses([signature])).value[0];
  return { signature, landed: true, slot: status?.slot, err: status?.err ?? undefined, logs: [] };
}

/** A try of rung 0 that is already on its way (see `sendFirstTryEarly`). */
export interface EarlyTry {
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number;
  /** Programs of the transaction's instructions, in order, to read a failure. */
  programIds: PublicKey[];
  /** Set when it went through Jito. */
  via?: "jito" | "rpc";
  tip?: bigint;
  /** Ends the re-sends. */
  stop: () => void;
}

/**
 * Sends `try_rung(0)` without waiting for `open_order` to be confirmed, so the
 * first try lands in the first block after the order exists instead of
 * seconds later. Until the order lands the session key holds no SOL, so a copy
 * that arrives too early cannot land and costs nothing; the same signed bytes
 * are therefore sent again every `resendMs` for a while. On mainnet (Nov 24, 2026, re-sent every 400 ms) the try landed 3, 4, 4 and 10 slots after the order; sent only after the order's confirmation it had been a median of 9.
 *
 * Give it the blockhash the order transaction uses. It stays a transaction of
 * its own, signed only by the session key: the price the rung is measured
 * from is the one `open_order` wrote down before this try runs.
 */
export async function sendFirstTryEarly(p: {
  connection: Connection;
  user: PublicKey;
  mint: PublicKey;
  tokenProgram: PublicKey;
  buybackRecipient: PublicKey;
  venue: Order["venue"];
  pool?: PoolAccounts;
  sessionKeypair: Keypair;
  blockhash: string;
  lastValidBlockHeight: number;
  cuLimit?: number;
  cuPrice?: bigint;
  /** Pause between re-sends (default 200 ms, about half a slot). */
  resendMs?: number;
  /** How many times the same bytes are sent again (default 30, about six seconds). */
  resends?: number;
  /** Send it through Jito, with a tip, as a bundle of its own (see jito.ts). */
  jito?: JitoOptions;
}): Promise<EarlyTry> {
  const session = p.sessionKeypair;
  const instructions = [
    computeUnitLimitIx(p.cuLimit ?? cuLimitFor(p.venue)),
    computeUnitPriceIx(p.cuPrice ?? DEFAULT_CU_PRICE),
    tryRungIx({
      sessionKey: session.publicKey,
      user: p.user,
      mint: p.mint,
      tokenProgram: p.tokenProgram,
      buybackRecipient: p.buybackRecipient,
      rungIndex: 0,
      venue: p.venue,
      pool: p.pool,
    }),
  ];
  return sendTry({
    connection: p.connection,
    session,
    instructions,
    blockhash: p.blockhash,
    lastValidBlockHeight: p.lastValidBlockHeight,
    jito: p.jito,
    resendMs: p.resendMs,
    resends: p.resends,
  });
}

/**
 * Signs one try and keeps sending the same bytes until stopped: through Jito
 * (with the tip added) when `jito` is given, otherwise through the connection.
 * Throws when the very first send fails.
 */
async function sendTry(p: {
  connection: Connection;
  session: Keypair;
  instructions: TransactionInstruction[];
  blockhash: string;
  lastValidBlockHeight: number;
  jito?: JitoOptions;
  resendMs?: number;
  resends?: number;
}): Promise<EarlyTry> {
  const jito = p.jito;
  const instructions = jito
    ? [...p.instructions, jitoTipIx(p.session.publicKey, jito.tipAccount, jito.tipLamports)]
    : p.instructions;
  const tx = new Transaction({
    feePayer: p.session.publicKey,
    blockhash: p.blockhash,
    lastValidBlockHeight: p.lastValidBlockHeight,
  }).add(...instructions);
  tx.sign(p.session);
  const raw = tx.serialize();
  let send: (n: number) => Promise<string>;
  if (jito) {
    const fetchFn = jito.fetch ?? runtimeFetch();
    const hosts = jito.hosts ?? JITO_HOSTS;
    // One request per second per region without a key: take the hosts in turn.
    send = (n) => sendToJito(fetchFn, hosts[n % hosts.length], raw);
  } else {
    // maxRetries 0: the re-sends below are the retries, on our own clock.
    send = () => p.connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
  }
  const signature = await send(0);

  let stopped = false;
  const resends = p.resends ?? (jito ? 200 : 30);
  const resendMs = p.resendMs ?? jito?.resendMs ?? (jito ? 300 : 200);
  void (async () => {
    for (let i = 1; i <= resends && !stopped; i++) {
      await sleep(resendMs);
      if (stopped) break;
      // "Already processed" and the like are expected once it has landed.
      await send(i).catch(() => undefined);
    }
  })();

  return {
    signature,
    blockhash: p.blockhash,
    lastValidBlockHeight: p.lastValidBlockHeight,
    programIds: instructions.map((x) => x.programId),
    via: jito ? "jito" : "rpc",
    tip: jito?.tipLamports,
    stop: () => {
      stopped = true;
    },
  };
}

function attemptText(a: Attempt): string {
  const what = a.kind === "try" ? `rung ${a.rungIndex} (${a.rungBps} bps)` : a.kind;
  const result = a.failure ? `${a.outcome}: ${describeFailure(a.failure)}` : a.outcome;
  return `${what}: ${result}`;
}

export async function runLadder(p: LadderParams): Promise<LadderResult> {
  const { connection, user, sessionKeypair: session } = p;
  const cuPrice = p.cuPrice ?? DEFAULT_CU_PRICE;
  const pollMs = p.pollMs ?? 200;
  const attempts: Attempt[] = [];
  const result: LadderResult = { attempts, sweptLamports: 0n, sessionBalanceAfter: 0n, totalFees: 0n, totalTips: 0n };

  const record = (a: Attempt) => {
    attempts.push(a);
    if (a.fee !== undefined) result.totalFees += a.fee;
    p.onEvent?.({ type: "result", attempt: a, text: attemptText(a) });
  };
  const toAttempt = (kind: AttemptKind, landed: Landed, programIds: PublicKey[]): Attempt => {
    const a: Attempt = {
      kind,
      signature: landed.signature,
      slot: landed.slot,
      fee: landed.fee,
      computeUnits: landed.computeUnits,
      outcome: "ok",
      logs: landed.logs,
    };
    if (!landed.landed) a.outcome = "not-landed";
    else if (landed.err) {
      a.failure = classifyFailure(landed.err, landed.logs, programIds);
      a.outcome = a.failure.kind === "slippage" || a.failure.kind === "order-filled" ? a.failure.kind : "failed";
    }
    return a;
  };

  const order = p.order ?? (await fetchOrder(connection, user));
  if (!order) throw new Error("order account not found");
  // An early first try can have bought before the order was read back; its result is taken below.
  const filledByEarlyTry = order.status === "Filled" && p.firstTry !== undefined;
  if (order.status !== "Open" && !filledByEarlyTry) throw new Error(`order is ${order.status}, not Open`);
  if (!order.sessionKey.equals(session.publicKey)) throw new Error("session key does not match the order");
  if (order.venue === "PumpSwap" && !p.pool) throw new Error("a PumpSwap order needs the pool's accounts");
  const cuLimit = p.cuLimit ?? cuLimitFor(order.venue);

  const tryInstructions = (rungIndex: number) => [
    computeUnitLimitIx(cuLimit),
    computeUnitPriceIx(cuPrice),
    tryRungIx({
      sessionKey: session.publicKey,
      user,
      mint: p.mint,
      tokenProgram: p.tokenProgram,
      buybackRecipient: p.buybackRecipient,
      rungIndex,
      venue: order.venue,
      pool: p.pool,
    }),
  ];

  // --- The Jito road. A try sent there leaves no trace unless it lands, so every
  // try stays "in flight" and is looked at again while later rungs run.
  interface InFlight extends EarlyTry {
    rungIndex: number;
    dueSlot: bigint;
    settled: boolean;
  }
  const inFlight: InFlight[] = [];
  /** Reads every Jito try that has landed since the last look. True once the order has bought. */
  const settle = async (): Promise<boolean> => {
    const open = inFlight.filter((f) => !f.settled);
    if (open.length === 0) return false;
    const statuses = (await connection.getSignatureStatuses(open.map((f) => f.signature))).value;
    let bought = false;
    for (let k = 0; k < open.length; k++) {
      const status = statuses[k];
      if (!status || (status.confirmationStatus !== "confirmed" && status.confirmationStatus !== "finalized")) continue;
      const f = open[k];
      f.settled = true;
      f.stop();
      const landed = await readLanded(connection, f.signature);
      const a = toAttempt("try", landed, f.programIds);
      a.rungIndex = f.rungIndex;
      a.rungBps = order.rungsBps[f.rungIndex];
      a.dueSlot = f.dueSlot;
      a.via = "jito";
      if (!landed.err) {
        a.outcome = "filled";
        a.tip = f.tip;
        result.totalTips += f.tip ?? 0n;
        result.filled = findEvent(landed.logs, "OrderFilled");
        bought = true;
      } else if (a.outcome === "order-filled") {
        bought = true;
      }
      record(a);
    }
    if (bought) inFlight.forEach((f) => f.stop());
    return bought;
  };

  let stop = false;
  for (let i = 0; i < order.rungCount && !stop; i++) {
    const dueSlot = rungDueSlot(order, i);
    let slot = BigInt(await connection.getSlot("processed"));
    while (slot < dueSlot) {
      // A Jito try of an earlier rung can still land while this one waits.
      if (await settle()) {
        stop = true;
        break;
      }
      p.onEvent?.({ type: "waiting", rungIndex: i, dueSlot, slot });
      await sleep(pollMs);
      slot = BigInt(await connection.getSlot("processed"));
    }
    if (stop) break;
    if (slot >= order.lastSlot) break; // expired: only a refund is left

    if (p.jito) {
      let flight: EarlyTry | undefined;
      if (i === 0 && p.firstTry?.via === "jito") {
        flight = p.firstTry;
      } else if (!(i === 0 && p.firstTry)) {
        try {
          const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
          flight = await sendTry({
            connection,
            session,
            instructions: tryInstructions(i),
            blockhash,
            lastValidBlockHeight,
            jito: p.jito,
          });
        } catch {
          flight = undefined; // the block engine cannot be reached: this rung goes the ordinary road below
        }
      }
      if (flight) {
        p.onEvent?.({ type: "sent", kind: "try", rungIndex: i, signature: flight.signature });
        const f: InFlight = { ...flight, rungIndex: i, dueSlot, settled: false };
        inFlight.push(f);
        // This rung has the road to itself until the next one is due (the last: until the order expires).
        const until = i + 1 < order.rungCount ? rungDueSlot(order, i + 1) : order.lastSlot;
        for (;;) {
          if (await settle()) {
            stop = true;
            break;
          }
          if (f.settled) break; // it landed and was refused on chain: this rung is done
          if (BigInt(await connection.getSlot("processed")) >= until) break;
          await sleep(pollMs);
        }
        f.stop();
        if (!f.settled) {
          record({
            kind: "try",
            rungIndex: i,
            rungBps: order.rungsBps[i],
            dueSlot,
            signature: f.signature,
            outcome: "dropped",
            via: "jito",
          });
        }
        continue;
      }
    }

    if (i === 0 && p.firstTry) {
      const early = p.firstTry;
      p.onEvent?.({ type: "sent", kind: "try", rungIndex: 0, signature: early.signature });
      const waited = await Promise.race([
        confirmSent(connection, early),
        sleep(p.firstTryWaitMs ?? 8_000).then(() => null),
      ]);
      early.stop();
      const a = toAttempt("try", waited ?? { signature: early.signature, landed: false, logs: [] }, early.programIds);
      a.rungIndex = 0;
      a.rungBps = order.rungsBps[0];
      a.dueSlot = dueSlot;
      a.via = "rpc";
      if (waited?.landed && !waited.err) {
        a.outcome = "filled";
        result.filled = findEvent(waited.logs, "OrderFilled");
        stop = true;
      } else if (a.outcome === "order-filled") {
        stop = true;
      }
      record(a);
      // It landed (filled or refused): rung 0 is done. Otherwise send rung 0 the ordinary way below.
      if (waited?.landed) continue;
    }

    const instructions = tryInstructions(i);
    const landed = await sendAndConfirm(connection, instructions, session, (signature) =>
      p.onEvent?.({ type: "sent", kind: "try", rungIndex: i, signature }),
    );
    const a = toAttempt("try", landed, instructions.map((x) => x.programId));
    a.rungIndex = i;
    a.rungBps = order.rungsBps[i];
    a.dueSlot = dueSlot;
    a.via = "rpc";
    if (landed.landed && !landed.err) {
      a.outcome = "filled";
      result.filled = findEvent(landed.logs, "OrderFilled");
      stop = true;
    } else if (a.outcome === "order-filled") {
      stop = true;
    }
    record(a);
  }

  // A Jito try can land a moment after its window closed.
  if (!stop) await settle();
  inFlight.forEach((f) => f.stop());

  const filled = attempts.some((a) => a.outcome === "filled" || a.outcome === "order-filled");
  if (!filled) {
    const instructions = [
      computeUnitLimitIx(p.refundCuLimit ?? DEFAULT_REFUND_CU_LIMIT),
      computeUnitPriceIx(cuPrice),
      refundIx({ caller: session.publicKey, user }),
    ];
    try {
      const landed = await sendAndConfirm(connection, instructions, session, (signature) =>
        p.onEvent?.({ type: "sent", kind: "refund", signature }),
      );
      const a = toAttempt("refund", landed, instructions.map((x) => x.programId));
      result.refunded = findEvent(landed.logs, "OrderRefunded");
      record(a);
      // The refund was refused because the order had bought after all: find the try that did it.
      if (a.outcome === "order-filled") await settle();
    } catch (e) {
      record({ kind: "refund", signature: "", outcome: "failed", failure: { kind: "other", raw: String(e) } });
    }
  }

  await sweepSessionKey(p, result, record);
  return result;
}

/** Sends the session key's whole balance, less the fee, to the user. */
async function sweepSessionKey(p: LadderParams, result: LadderResult, record: (a: Attempt) => void) {
  const { connection, sessionKeypair: session, user } = p;
  const balance = BigInt(await connection.getBalance(session.publicKey, "confirmed"));
  const build = (lamports: bigint) =>
    SystemProgram.transfer({ fromPubkey: session.publicKey, toPubkey: user, lamports });
  const probe = new Transaction({ feePayer: session.publicKey, ...(await connection.getLatestBlockhash("confirmed")) }).add(
    build(balance),
  );
  const quoted = (await connection.getFeeForMessage(probe.compileMessage(), "confirmed")).value;
  const fee = quoted !== null ? BigInt(quoted) : sweepFeeLamports();
  if (balance <= fee) {
    result.sessionBalanceAfter = balance;
    return;
  }
  try {
    const landed = await sendAndConfirm(connection, [build(balance - fee)], session, (signature) =>
      p.onEvent?.({ type: "sent", kind: "sweep", signature }),
    );
    const a: Attempt = {
      kind: "sweep",
      signature: landed.signature,
      slot: landed.slot,
      fee: landed.fee,
      computeUnits: landed.computeUnits,
      outcome: "ok",
    };
    if (!landed.landed) a.outcome = "not-landed";
    else if (landed.err) {
      a.outcome = "failed";
      a.failure = classifyFailure(landed.err, landed.logs, [SystemProgram.programId]);
    } else result.sweptLamports = balance - fee;
    record(a);
  } catch (e) {
    record({ kind: "sweep", signature: "", outcome: "failed", failure: { kind: "other", raw: String(e) } });
  }
  result.sessionBalanceAfter = BigInt(await connection.getBalance(session.publicKey, "confirmed"));
}
