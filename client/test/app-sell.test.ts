// Selling from the app (Buğra, Nov 27: "only being able to buy is bad; people
// must go to another app to sell"). The sale itself is the venue's plain sell,
// the one the script has used on mainnet since Nov 24; how it climbs is in
// app-sell-ladder.test.ts. These are the rules of the token list.
import assert from "node:assert/strict";
import { test } from "node:test";

import { PublicKey } from "../src";
import { holdingsFrom, showsInTokens } from "../../app/src/screens/sellRules";

/** A token account as the chain stores it: mint, owner, amount (u64, little endian), then the rest. */
function tokenAccount(mint: PublicKey, amount: bigint, length = 165): Uint8Array {
  const data = new Uint8Array(length);
  data.set(mint.toBytes(), 0);
  let rest = amount;
  for (let i = 0; i < 8; i++) {
    data[64 + i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return data;
}

const CATE = new PublicKey("Ai66LHZG9MCzg1WKdawwqduVAXpNDUuV8M3uyq5ppump");
const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

test("holdings: one line per token with a balance, the mint and the amount read from the account", () => {
  const list = holdingsFrom([tokenAccount(CATE, 39_130_000n, 170), tokenAccount(USDC, 5_000_000n)]);
  assert.deepEqual(list, [
    { mint: CATE.toBase58(), amount: 39_130_000n },
    { mint: USDC.toBase58(), amount: 5_000_000n },
  ]);
});

test("holdings: empty accounts and data too short to be a token account are left out", () => {
  assert.deepEqual(holdingsFrom([tokenAccount(CATE, 0n), new Uint8Array(40)]), []);
});

test("holdings: the same token in two accounts is one line with the sum", () => {
  assert.deepEqual(holdingsFrom([tokenAccount(CATE, 10n), tokenAccount(CATE, 5n)]), [{ mint: CATE.toBase58(), amount: 15n }]);
});

test("the list shows pump.fun tokens: on mainnet their addresses end in pump", () => {
  assert.equal(showsInTokens(CATE.toBase58(), "mainnet-beta"), true);
  assert.equal(showsInTokens(USDC.toBase58(), "mainnet-beta"), false);
});

test("devnet's pump tokens carry no such ending, so there every token is listed", () => {
  assert.equal(showsInTokens("HXjR12NYVtMpxNS4Ye8eHuf2V1yv2FdfH9cRF53wxwoR", "devnet"), true);
});
