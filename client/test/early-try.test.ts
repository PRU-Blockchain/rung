// The first try is sent together with the order instead of after it is
// confirmed. On mainnet the old way put the first try 6 to 30 slots behind
// the order; in a launch rush the price runs in that time. Sent early, the
// try waits at the leaders and lands in the first block after the order
// exists: before that the session key holds no SOL, so an early copy cannot
// land and cannot cost anything.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";

import {
  COMPUTE_BUDGET_PROGRAM_ID,
  Order,
  RUNG_IX,
  RUNG_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  runLadder,
  sendFirstTryEarly,
} from "../src/index";

const BLOCKHASH = "11111111111111111111111111111111";
const SLIPPAGE = { InstructionError: [2, { Custom: 6042 }] };
// The log lines of a real failed try name the program that refused the buy (pump, error 6042 = 0x179a).
const SLIPPAGE_LOGS = [
  "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P failed: custom program error: 0x179a",
  "Program Ej2bWTwgPULuni3RVS7Krg1cNYrm5Em5WqfMcUVJUhio failed: custom program error: 0x179a",
];
const key = () => Keypair.generate().publicKey;

interface Sent {
  signature: string;
  raw: Uint8Array;
  tx: Transaction;
  options: unknown;
}

/** A connection that never touches the network. `outcome` decides what each signature did. */
function fake(outcome: (sent: Sent) => "ok" | "slippage" | "never") {
  const sent: Sent[] = [];
  const bySignature = new Map<string, Sent>();
  let slot = 1_000;
  const connection = {
    // A new blockhash every time, as on a real network: a later try is a different transaction.
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }),
    getSlot: async () => slot++,
    getBalance: async () => 0,
    getFeeForMessage: async () => ({ value: 5000 }),
    sendRawTransaction: async (raw: Uint8Array, options: unknown) => {
      const tx = Transaction.from(raw);
      // The same bytes again are the same transaction.
      const known = sent.find((s) => Buffer.from(s.raw).equals(Buffer.from(raw)));
      const s = known ?? { signature: `sig-${sent.length}`, raw, tx, options };
      if (!known) bySignature.set(s.signature, s);
      sent.push({ ...s, options });
      return s.signature;
    },
    confirmTransaction: async ({ signature }: { signature: string }) => {
      const what = outcome(bySignature.get(signature)!);
      if (what === "never") return new Promise(() => undefined);
      return { context: { slot: 1_001 }, value: { err: what === "ok" ? null : SLIPPAGE } };
    },
    getTransaction: async (signature: string) => {
      const what = outcome(bySignature.get(signature)!);
      const failed = what !== "ok";
      return { slot: 1_001, meta: { fee: 6000, computeUnitsConsumed: 120_000, err: failed ? SLIPPAGE : null, logMessages: failed ? SLIPPAGE_LOGS : [] } };
    },
    getSignatureStatuses: async () => ({ value: [null] }),
  } as unknown as Connection;
  return { connection, sent };
}

/** The rung index of a try_rung transaction, or undefined for anything else. */
function rungOf(tx: Transaction): number | undefined {
  const ix = tx.instructions.find((i) => i.programId.equals(RUNG_PROGRAM_ID));
  if (!ix || !Buffer.from(ix.data.subarray(0, 8)).equals(Buffer.from(RUNG_IX.tryRung))) return undefined;
  return ix.data[8];
}

const user = key();
const mint = key();
const buybackRecipient = key();

function order(session: PublicKey): Order {
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
    startSlot: 990n,
    windowSlots: 4n,
    lastSlot: 5_000n,
    filledRung: 0,
    tokensBought: 0n,
    lamportsSpent: 0n,
    bump: 0,
    vaultBump: 0,
  };
}

const early = (connection: Connection, session: Keypair, over: { resendMs?: number; resends?: number } = {}) =>
  sendFirstTryEarly({
    connection,
    user,
    mint,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    buybackRecipient,
    venue: "Curve",
    sessionKeypair: session,
    blockhash: BLOCKHASH,
    lastValidBlockHeight: 100,
    resendMs: 5,
    resends: 3,
    ...over,
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("the early try is try_rung(0), paid and signed by the session key, on the order's blockhash", async () => {
  const session = Keypair.generate();
  const { connection, sent } = fake(() => "ok");
  const e = await early(connection, session, { resends: 0 });
  assert.equal(sent.length, 1);
  const tx = sent[0].tx;
  assert.equal(e.signature, sent[0].signature);
  assert.equal(tx.recentBlockhash, BLOCKHASH);
  assert.ok(tx.feePayer!.equals(session.publicKey));
  assert.equal(tx.signatures.length, 1, "the wallet does not sign a try");
  assert.ok(tx.verifySignatures());
  assert.deepEqual(
    tx.instructions.map((i) => i.programId.toBase58()),
    [COMPUTE_BUDGET_PROGRAM_ID.toBase58(), COMPUTE_BUDGET_PROGRAM_ID.toBase58(), RUNG_PROGRAM_ID.toBase58()],
  );
  assert.equal(rungOf(tx), 0);
  // No preflight: a simulation before the order exists would only say "no order".
  assert.equal((sent[0].options as { skipPreflight?: boolean }).skipPreflight, true);
});

test("the same bytes are sent again a few times, so the try arrives right after the order lands", async () => {
  const session = Keypair.generate();
  const { connection, sent } = fake(() => "ok");
  await early(connection, session, { resendMs: 5, resends: 3 });
  await sleep(60);
  assert.equal(sent.length, 4);
  assert.equal(new Set(sent.map((s) => s.signature)).size, 1, "one transaction, not four");
});

test("stop() ends the re-sends", async () => {
  const session = Keypair.generate();
  const { connection, sent } = fake(() => "ok");
  const e = await early(connection, session, { resendMs: 20, resends: 50 });
  e.stop();
  await sleep(80);
  assert.equal(sent.length, 1);
});

test("an early try that filled is the ladder's first result: no second try is sent", async () => {
  const session = Keypair.generate();
  const { connection, sent } = fake(() => "ok");
  const firstTry = await early(connection, session, { resends: 0 });
  const result = await runLadder({
    connection,
    user,
    mint,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    buybackRecipient,
    sessionKeypair: session,
    order: order(session.publicKey),
    firstTry,
    pollMs: 1,
  });
  assert.equal(result.attempts[0].kind, "try");
  assert.equal(result.attempts[0].rungIndex, 0);
  assert.equal(result.attempts[0].signature, firstTry.signature);
  assert.equal(result.attempts[0].outcome, "filled");
  assert.equal(sent.filter((s) => rungOf(s.tx) !== undefined).length, 1, "exactly one try was ever sent");
  assert.ok(!result.attempts.some((a) => a.kind === "refund"));
});

test("the early try may have bought before the ladder even starts: a filled order is then expected", async () => {
  // Seen on a local fork: the try landed one slot after the order, before the script had read the order back.
  const session = Keypair.generate();
  const { connection, sent } = fake(() => "ok");
  const firstTry = await early(connection, session, { resends: 0 });
  const result = await runLadder({
    connection,
    user,
    mint,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    buybackRecipient,
    sessionKeypair: session,
    order: { ...order(session.publicKey), status: "Filled" },
    firstTry,
    pollMs: 1,
  });
  assert.equal(result.attempts[0].outcome, "filled");
  assert.equal(result.attempts[0].signature, firstTry.signature);
  assert.equal(sent.filter((s) => rungOf(s.tx) !== undefined).length, 1);
});

test("without an early try a filled order is still refused: there is nothing left to do", async () => {
  const session = Keypair.generate();
  const { connection } = fake(() => "ok");
  await assert.rejects(
    runLadder({
      connection,
      user,
      mint,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      buybackRecipient,
      sessionKeypair: session,
      order: { ...order(session.publicKey), status: "Filled" },
      pollMs: 1,
    }),
    /order is Filled, not Open/,
  );
});

test("an early try that failed on slippage leads to rung 1, not to rung 0 again", async () => {
  const session = Keypair.generate();
  const { connection, sent } = fake((s) => (rungOf(s.tx) === 0 ? "slippage" : "ok"));
  const firstTry = await early(connection, session, { resends: 0 });
  const result = await runLadder({
    connection,
    user,
    mint,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    buybackRecipient,
    sessionKeypair: session,
    order: order(session.publicKey),
    firstTry,
    pollMs: 1,
  });
  const tries = result.attempts.filter((a) => a.kind === "try");
  assert.deepEqual(tries.map((a) => [a.rungIndex, a.outcome]), [
    [0, "slippage"],
    [1, "filled"],
  ]);
  assert.deepEqual(
    sent.map((s) => rungOf(s.tx)).filter((r) => r !== undefined),
    [0, 1],
  );
});

test("an early try with no result in time is given up, and rung 0 is tried the ordinary way", async () => {
  const session = Keypair.generate();
  let earlySignature = "";
  const { connection, sent } = fake((s) => (s.signature === earlySignature ? "never" : "ok"));
  const firstTry = await early(connection, session, { resends: 0 });
  earlySignature = firstTry.signature;
  const result = await runLadder({
    connection,
    user,
    mint,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    buybackRecipient,
    sessionKeypair: session,
    order: order(session.publicKey),
    firstTry,
    firstTryWaitMs: 30,
    pollMs: 1,
  });
  const tries = result.attempts.filter((a) => a.kind === "try");
  assert.deepEqual(tries.map((a) => [a.rungIndex, a.outcome]), [
    [0, "not-landed"],
    [0, "filled"],
  ]);
  assert.equal(tries[0].signature, firstTry.signature);
  assert.notEqual(tries[1].signature, firstTry.signature);
});

test("without an early try the ladder behaves as before", async () => {
  const session = Keypair.generate();
  const { connection, sent } = fake(() => "ok");
  const result = await runLadder({
    connection,
    user,
    mint,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    buybackRecipient,
    sessionKeypair: session,
    order: order(session.publicKey),
    pollMs: 1,
  });
  assert.equal(result.attempts[0].outcome, "filled");
  assert.equal(sent.filter((s) => rungOf(s.tx) === 0).length, 1);
});
