// Tries sent through Jito's block engine as one-transaction bundles.
//
// A bundle lands whole or not at all, so a try the venue would refuse never
// reaches the chain and costs nothing. The try carries a small tip to Jito and
// a marker account ("jitodontfront…") that keeps it at the front of any bundle:
// it cannot be placed behind someone else's buy. Nothing here changes what the
// program checks; only the road the try takes changes.
//
// What that means for the sender: a refused try leaves no trace. The ladder
// cannot wait for a failure; it moves to the next rung when that rung is due
// and keeps watching the earlier tries in case one lands late.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

import {
  COMPUTE_BUDGET_PROGRAM_ID,
  JITO_DONT_FRONT,
  JITO_MAX_TIP_LAMPORTS,
  JITO_MIN_TIP_LAMPORTS,
  Order,
  RUNG_IX,
  RUNG_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  chooseJitoTip,
  feeBudget,
  jitoTipIx,
  runLadder,
  sendFirstTryEarly,
  sendToJito,
} from "../src/index";

const key = () => Keypair.generate().publicKey;
const user = key();
const mint = key();
const buybackRecipient = key();
const tipAccount = key();
const TIP = 8_000n;

// ---------------------------------------------------------------- pure parts

test("the marker account is a real address that starts with jitodontfront", () => {
  assert.ok(JITO_DONT_FRONT.toBase58().startsWith("jitodontfront"));
  assert.equal(JITO_DONT_FRONT.toBytes().length, 32);
});

test("the tip is a plain transfer from the session key, with the marker as a read-only extra account", () => {
  const session = key();
  const ix = jitoTipIx(session, tipAccount, TIP);
  assert.ok(ix.programId.equals(SystemProgram.programId));
  assert.ok(ix.keys[0].pubkey.equals(session) && ix.keys[0].isSigner && ix.keys[0].isWritable);
  assert.ok(ix.keys[1].pubkey.equals(tipAccount) && ix.keys[1].isWritable && !ix.keys[1].isSigner);
  assert.ok(ix.keys[2].pubkey.equals(JITO_DONT_FRONT) && !ix.keys[2].isSigner && !ix.keys[2].isWritable);
  // System transfer: u32 instruction index 2, then u64 lamports.
  assert.equal(ix.data.readUInt32LE(0), 2);
  assert.equal(ix.data.readBigUInt64LE(4), TIP);
});

test("the tip follows the median of landed tips, never below Jito's minimum, never above our cap", () => {
  // The shape of https://bundles.jito.wtf/api/v1/bundles/tip_floor (values in SOL), read on Nov 25, 2026.
  const floor = [{ landed_tips_50th_percentile: 8.042e-6, landed_tips_75th_percentile: 0.0000318475 }];
  assert.equal(chooseJitoTip(floor), 8_042n);
  assert.equal(chooseJitoTip([{ landed_tips_50th_percentile: 1e-7 }]), JITO_MIN_TIP_LAMPORTS);
  assert.equal(chooseJitoTip([{ landed_tips_50th_percentile: 0.5 }]), JITO_MAX_TIP_LAMPORTS);
  // Anything unreadable: the minimum, not a guess.
  for (const bad of [null, [], [{}], [{ landed_tips_50th_percentile: "x" }], [{ landed_tips_50th_percentile: -1 }], "nope"]) {
    assert.equal(chooseJitoTip(bad), JITO_MIN_TIP_LAMPORTS);
  }
  assert.equal(chooseJitoTip(floor, 5_000n), 5_000n);
});

test("the session key's budget grows by exactly one tip: only the try that lands pays it", () => {
  const base = feeBudget({ rungCount: 3, rentExemptMinimum: 890_880n });
  const withTip = feeBudget({ rungCount: 3, rentExemptMinimum: 890_880n, tipLamports: TIP });
  assert.equal(withTip.total - base.total, TIP);
  assert.equal(withTip.tip, TIP);
  assert.equal(base.tip, 0n);
});

test("a try goes to the block engine as a bundle of its own, base64, and the signature comes back", async () => {
  const calls: { url: string; body: any }[] = [];
  const fetchFn = async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: JSON.parse(init!.body!) });
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: "the-signature" }) };
  };
  const raw = Uint8Array.from([1, 2, 3, 250]);
  const signature = await sendToJito(fetchFn, "frankfurt.mainnet.block-engine.jito.wtf", raw);
  assert.equal(signature, "the-signature");
  assert.equal(calls[0].url, "https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/transactions?bundleOnly=true");
  assert.equal(calls[0].body.method, "sendTransaction");
  assert.deepEqual(calls[0].body.params, ["AQID+g==", { encoding: "base64" }]);
});

test("a refusal by the block engine is an error, with its reason", async () => {
  const limited = async () => ({ ok: false, status: 429, json: async () => ({}) });
  await assert.rejects(sendToJito(limited, "h", Uint8Array.from([1])), /429/);
  const refused = async () => ({ ok: true, status: 200, json: async () => ({ error: { code: -32602, message: "bundle must tip" } }) });
  await assert.rejects(sendToJito(refused, "h", Uint8Array.from([1])), /bundle must tip/);
});

// ------------------------------------------------------------ the ladder

interface SentTx {
  signature: string;
  tx: Transaction;
  via: "jito" | "rpc";
}

/** What a transaction does once sent: lands in `slot` (optionally failing), or never. */
type Fate = { slot: number; err?: unknown } | "never";

const SLIPPAGE = { InstructionError: [2, { Custom: 6042 }] };

/**
 * A chain and a block engine that never touch the network. Time is the slot
 * counter: every `getSlot` moves it one slot on.
 */
function world(fate: (sent: SentTx) => Fate, opts: { jitoDown?: boolean; startSlot?: number } = {}) {
  const sent: SentTx[] = [];
  const bySignature = new Map<string, SentTx>();
  let slot = opts.startSlot ?? 1_000;
  let n = 0;
  const register = (raw: Uint8Array, via: "jito" | "rpc") => {
    const tx = Transaction.from(raw);
    const same = sent.find((s) => Buffer.from(s.tx.serialize()).equals(Buffer.from(raw)));
    const s = same ?? { signature: `sig-${n++}`, tx, via };
    if (!same) bySignature.set(s.signature, s);
    sent.push({ ...s, via });
    return s.signature;
  };
  const landed = (signature: string) => {
    const s = bySignature.get(signature);
    if (!s) return null;
    const f = fate(s);
    return f !== "never" && slot >= f.slot ? f : null;
  };
  const connection = {
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }),
    getSlot: async () => slot++,
    getBalance: async () => 0,
    getFeeForMessage: async () => ({ value: 5000 }),
    sendRawTransaction: async (raw: Uint8Array) => register(raw, "rpc"),
    confirmTransaction: async ({ signature }: { signature: string }) => {
      // Used only by the ordinary road (refund, sweep, fallback): those land at once here.
      const f = fate(bySignature.get(signature)!);
      if (f === "never") return new Promise(() => undefined);
      slot = Math.max(slot, f.slot);
      return { context: { slot }, value: { err: f.err ?? null } };
    },
    getSignatureStatuses: async (signatures: string[]) => ({
      value: signatures.map((sig) => {
        const f = landed(sig);
        return f ? { slot: f.slot, confirmationStatus: "confirmed", err: f.err ?? null } : null;
      }),
    }),
    getTransaction: async (signature: string) => {
      const f = landed(signature) ?? fate(bySignature.get(signature)!);
      if (f === "never") return null;
      return { slot: f.slot, meta: { fee: 6000, computeUnitsConsumed: 120_000, err: f.err ?? null, logMessages: [] } };
    },
  } as unknown as Connection;
  const fetchFn = async (_url: string, init?: { body?: string }) => {
    if (opts.jitoDown) throw new Error("network down");
    const body = JSON.parse(init!.body!);
    const signature = register(Buffer.from(body.params[0], "base64"), "jito");
    return { ok: true, status: 200, json: async () => ({ result: signature }) };
  };
  return { connection, fetchFn, sent, now: () => slot };
}

function rungOf(tx: Transaction): number | undefined {
  const ix = tx.instructions.find((i) => i.programId.equals(RUNG_PROGRAM_ID));
  if (!ix || !Buffer.from(ix.data.subarray(0, 8)).equals(Buffer.from(RUNG_IX.tryRung))) return undefined;
  return ix.data[8];
}

function order(session: PublicKey, lastSlot = 5_000n): Order {
  return {
    user,
    sessionKey: session,
    mint,
    venue: "Curve",
    status: "Open",
    rungCount: 3,
    rungsBps: [100, 200, 300],
    amount: 10_000_000n,
    rentReserve: 0n,
    expectedTokensSeen: 1n,
    expectedTokensStart: 1n,
    startSlot: 1_000n,
    windowSlots: 4n,
    lastSlot,
    filledRung: 0,
    tokensBought: 0n,
    lamportsSpent: 0n,
    bump: 0,
    vaultBump: 0,
  };
}

const ladder = (w: ReturnType<typeof world>, session: Keypair, over: Partial<Parameters<typeof runLadder>[0]> = {}) =>
  runLadder({
    connection: w.connection,
    user,
    mint,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    buybackRecipient,
    sessionKeypair: session,
    order: order(session.publicKey),
    pollMs: 1,
    jito: { tipAccount, tipLamports: TIP, fetch: w.fetchFn, hosts: ["a", "b"], resendMs: 2 },
    ...over,
  });

const tries = (r: Awaited<ReturnType<typeof runLadder>>) =>
  r.attempts.filter((a) => a.kind === "try").map((a) => [a.rungIndex, a.outcome]);

test("a try that fills went through Jito, with the tip and the marker in the same transaction", async () => {
  const session = Keypair.generate();
  const w = world(() => ({ slot: 1_001 }));
  const result = await ladder(w, session);
  assert.deepEqual(tries(result), [[0, "filled"]]);
  const first = w.sent.find((s) => rungOf(s.tx) === 0)!;
  assert.equal(first.via, "jito");
  assert.deepEqual(
    first.tx.instructions.map((i) => i.programId.toBase58()),
    [COMPUTE_BUDGET_PROGRAM_ID, COMPUTE_BUDGET_PROGRAM_ID, RUNG_PROGRAM_ID, SystemProgram.programId].map((p) => p.toBase58()),
  );
  const tip = first.tx.instructions[3];
  assert.ok(tip.keys[1].pubkey.equals(tipAccount));
  assert.ok(tip.keys[2].pubkey.equals(JITO_DONT_FRONT));
  assert.equal(tip.data.readBigUInt64LE(4), TIP);
  assert.ok(first.tx.feePayer!.equals(session.publicKey));
  // The filled try reports its tip next to its fee.
  const filled = result.attempts.find((a) => a.outcome === "filled")!;
  assert.equal(filled.tip, TIP);
  assert.equal(filled.via, "jito");
  assert.equal(result.totalTips, TIP);
  // No try went the ordinary road.
  assert.equal(w.sent.filter((s) => s.via === "rpc" && rungOf(s.tx) !== undefined).length, 0);
});

test("a try the venue would refuse never lands: no fee, and the next rung goes out when it is due", async () => {
  const session = Keypair.generate();
  const w = world((s) => (rungOf(s.tx) === 1 ? { slot: 1_005 } : rungOf(s.tx) === 0 ? "never" : { slot: 1_000 }));
  const result = await ladder(w, session);
  assert.deepEqual(tries(result), [
    [0, "dropped"],
    [1, "filled"],
  ]);
  const dropped = result.attempts[0];
  assert.equal(dropped.fee, undefined);
  assert.equal(dropped.tip, undefined);
  // Rung 1 was not sent before its window opened (start 1000, window 4).
  assert.ok(w.sent.some((s) => rungOf(s.tx) === 1));
  assert.equal(result.totalTips, TIP);
  assert.ok(!result.attempts.some((a) => a.kind === "refund"));
});

test("the same try is sent again while its window is open, turning over the block engine's hosts", async () => {
  const session = Keypair.generate();
  const urls: string[] = [];
  const w = world((s) => (rungOf(s.tx) === 1 ? { slot: 1_005 } : rungOf(s.tx) === 0 ? "never" : { slot: 1_000 }));
  const fetchFn = async (url: string, init?: { body?: string }) => {
    urls.push(url);
    return w.fetchFn(url, init);
  };
  await ladder(w, session, { jito: { tipAccount, tipLamports: TIP, fetch: fetchFn, hosts: ["a", "b"], resendMs: 1 }, pollMs: 3 });
  const rung0 = w.sent.filter((s) => rungOf(s.tx) === 0);
  assert.ok(rung0.length >= 2, "rung 0 was sent more than once");
  assert.equal(new Set(rung0.map((s) => s.signature)).size, 1, "always the same transaction");
  assert.ok(urls.some((u) => u.startsWith("https://a/")) && urls.some((u) => u.startsWith("https://b/")));
});

test("an earlier try that lands late still counts: the order bought once, at that rung", async () => {
  const session = Keypair.generate();
  // Rung 0 lands in slot 1006, after rung 1 went out (due 1004); rung 1 itself never lands.
  const w = world((s) => (rungOf(s.tx) === 0 ? { slot: 1_006 } : rungOf(s.tx) === 1 ? "never" : { slot: 1_000 }));
  const result = await ladder(w, session);
  const filled = result.attempts.filter((a) => a.outcome === "filled");
  assert.equal(filled.length, 1);
  assert.equal(filled[0].rungIndex, 0);
  assert.ok(!result.attempts.some((a) => a.kind === "refund"), "no refund after a buy");
  assert.ok(!w.sent.some((s) => rungOf(s.tx) === 2), "rung 2 was never sent");
});

test("a try that landed and was refused on chain is read like any other failure", async () => {
  const session = Keypair.generate();
  // Can happen when a block is abandoned and its transactions are replayed outside their bundle.
  const w = world((s) => (rungOf(s.tx) === 0 ? { slot: 1_001, err: SLIPPAGE } : { slot: 1_005 }));
  const result = await ladder(w, session);
  assert.deepEqual(tries(result), [
    [0, "failed"],
    [1, "filled"],
  ]);
  assert.equal(result.attempts[0].fee, 6000n);
});

test("when the block engine cannot be reached the try goes the ordinary road", async () => {
  const session = Keypair.generate();
  const w = world(() => ({ slot: 1_001 }), { jitoDown: true });
  const result = await ladder(w, session);
  assert.deepEqual(tries(result), [[0, "filled"]]);
  const first = w.sent.find((s) => rungOf(s.tx) === 0)!;
  assert.equal(first.via, "rpc");
  assert.equal(result.attempts[0].via, "rpc");
  // The ordinary road has no tip: three instructions.
  assert.equal(first.tx.instructions.length, 3);
  assert.equal(result.totalTips, 0n);
});

test("when no rung lands the SOL goes back, and the tries cost nothing", async () => {
  const session = Keypair.generate();
  const w = world((s) => (rungOf(s.tx) !== undefined ? "never" : { slot: 1_020 }));
  const result = await ladder(w, session, { order: order(session.publicKey, 1_016n) });
  assert.deepEqual(tries(result), [
    [0, "dropped"],
    [1, "dropped"],
    [2, "dropped"],
  ]);
  assert.ok(result.attempts.some((a) => a.kind === "refund" && a.outcome === "ok"));
  assert.equal(result.totalTips, 0n);
  // Only the refund's fee was paid (the sweep finds nothing to send in this fake).
  assert.equal(result.totalFees, 6000n);
});

test("the first try can leave with the order on the Jito road too", async () => {
  const session = Keypair.generate();
  const w = world(() => ({ slot: 1_001 }));
  const early = await sendFirstTryEarly({
    connection: w.connection,
    user,
    mint,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    buybackRecipient,
    venue: "Curve",
    sessionKeypair: session,
    blockhash: "11111111111111111111111111111111",
    lastValidBlockHeight: 100,
    resendMs: 2,
    resends: 2,
    jito: { tipAccount, tipLamports: TIP, fetch: w.fetchFn, hosts: ["a"] },
  });
  assert.equal(w.sent[0].via, "jito");
  assert.equal(w.sent[0].tx.instructions.length, 4);
  const result = await ladder(w, session, { firstTry: early });
  assert.deepEqual(tries(result), [[0, "filled"]]);
  assert.equal(result.attempts[0].signature, early.signature);
  assert.equal(result.attempts[0].tip, TIP);
  assert.equal(w.sent.filter((s) => rungOf(s.tx) !== undefined && s.signature !== early.signature).length, 0);
});
