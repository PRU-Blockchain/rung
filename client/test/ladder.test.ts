// (6) sendAndConfirm: a transaction that landed and failed in a program is a
// result, not an exception. The ladder depends on this: a rung that fails on
// slippage must lead to the next rung, not stop the ladder.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  Connection,
  Keypair,
  SystemProgram,
  TransactionExpiredBlockheightExceededError,
} from "@solana/web3.js";

import { sendAndConfirm } from "../src/ladder";

const SLIPPAGE = { InstructionError: [2, { Custom: 6042 }] };

/** A connection that never touches the network. */
function fakeConnection(confirm: () => Promise<unknown>, metaErr: unknown): Connection {
  return {
    getLatestBlockhash: async () => ({
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 100,
    }),
    sendRawTransaction: async () => "sig",
    confirmTransaction: confirm,
    getTransaction: async () => ({
      slot: 7,
      meta: { fee: 6000, computeUnitsConsumed: 94000, err: metaErr, logMessages: ["log"] },
    }),
    getSignatureStatuses: async () => ({ value: [{ slot: 7, err: metaErr }] }),
  } as unknown as Connection;
}

function transfer(signer: Keypair) {
  return [SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: signer.publicKey, lamports: 0 })];
}

test("a failed transaction reported through the confirm result is returned as landed with its error", async () => {
  const signer = Keypair.generate();
  const connection = fakeConnection(async () => ({ context: { slot: 7 }, value: { err: SLIPPAGE } }), SLIPPAGE);
  const landed = await sendAndConfirm(connection, transfer(signer), signer);
  assert.equal(landed.landed, true);
  assert.deepEqual(landed.err, SLIPPAGE);
  assert.equal(landed.fee, 6000n);
});

test("a failed transaction that web3.js reports by rejecting with the status error is still a result", async () => {
  // Seen in React Native: confirmTransaction rejects with the plain status
  // error object instead of resolving with it.
  const signer = Keypair.generate();
  const connection = fakeConnection(async () => {
    throw SLIPPAGE;
  }, SLIPPAGE);
  const landed = await sendAndConfirm(connection, transfer(signer), signer);
  assert.equal(landed.landed, true);
  assert.deepEqual(landed.err, SLIPPAGE);
  assert.equal(landed.computeUnits, 94000);
});

test("an expired blockhash means the transaction did not land", async () => {
  const signer = Keypair.generate();
  const connection = fakeConnection(async () => {
    throw new TransactionExpiredBlockheightExceededError("sig");
  }, null);
  const landed = await sendAndConfirm(connection, transfer(signer), signer);
  assert.equal(landed.landed, false);
});

test("a real exception while confirming is not swallowed", async () => {
  const signer = Keypair.generate();
  const connection = fakeConnection(async () => {
    throw new Error("network down");
  }, null);
  await assert.rejects(() => sendAndConfirm(connection, transfer(signer), signer), /network down/);
});
