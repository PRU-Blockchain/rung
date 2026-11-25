// The dollar value next to a SOL amount. The price is Pyth's SOL/USD account on
// the chain; the bytes in token-vectors.json are that account on mainnet as it
// was on Nov 25, 2026 (price 6923500142 with exponent -8: $69.235, written in
// slot 473848598).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  PYTH_RECEIVER_PROGRAM_ID,
  PYTH_SOL_USD_ACCOUNT,
  PublicKey,
  SOL_USD_MAX_AGE_SLOTS,
  TOKEN_PROGRAM_ID,
  base64Decode,
  decodeSolUsd,
  lamportsToUsd,
  solUsdFromAccount,
  usdText,
} from "../src";

interface Vectors {
  pyth: { address: string; owner: string; data: string; readAt: number };
}
const { pyth } = JSON.parse(readFileSync(new URL("./token-vectors.json", import.meta.url), "utf8")) as Vectors;
const data = base64Decode(pyth.data);
const owner = new PublicKey(pyth.owner);
const POSTED_SLOT = 473848598;

test("the constants are the account that was read", () => {
  assert.equal(PYTH_SOL_USD_ACCOUNT.toBase58(), pyth.address);
  assert.equal(PYTH_RECEIVER_PROGRAM_ID.toBase58(), pyth.owner);
});

test("the price account decodes to dollars per SOL and the slot it was written in", () => {
  const p = decodeSolUsd(data);
  assert.ok(p);
  assert.equal(p.postedSlot, POSTED_SLOT);
  assert.ok(Math.abs(p.usdPerSol - 69.23500142) < 1e-9);
});

// Freshness is counted in slots of the chain, read together with the account,
// so a phone whose clock is wrong still shows the right thing.
test("a price is used only from the Pyth program's account and only while fresh", () => {
  const fresh = solUsdFromAccount({ owner, data }, POSTED_SLOT + 100);
  assert.ok(fresh && Math.abs(fresh.usdPerSol - 69.235) < 0.001);
  assert.ok(solUsdFromAccount({ owner, data }, POSTED_SLOT + SOL_USD_MAX_AGE_SLOTS));
  assert.equal(solUsdFromAccount({ owner, data }, POSTED_SLOT + SOL_USD_MAX_AGE_SLOTS + 1), null);
  assert.equal(solUsdFromAccount({ owner: TOKEN_PROGRAM_ID, data }, POSTED_SLOT + 100), null);
  assert.equal(solUsdFromAccount(null, POSTED_SLOT + 100), null);
  // About one to ten minutes of slots; the account is written about once a minute.
  assert.ok(SOL_USD_MAX_AGE_SLOTS >= 150 && SOL_USD_MAX_AGE_SLOTS <= 1500);
});

test("anything that is not a fully verified SOL/USD price gives nothing", () => {
  for (let cut = 0; cut < data.length; cut += 5) assert.equal(decodeSolUsd(data.subarray(0, cut)), null, `cut at ${cut}`);

  const otherAccount = Uint8Array.from(data);
  otherAccount[0] ^= 1; // another account type
  assert.equal(decodeSolUsd(otherAccount), null);

  const partial = Uint8Array.from(data);
  partial[40] = 0; // "partially verified"
  assert.equal(decodeSolUsd(partial), null);

  const otherFeed = Uint8Array.from(data);
  otherFeed[41] ^= 1; // another price feed
  assert.equal(decodeSolUsd(otherFeed), null);

  const zero = Uint8Array.from(data);
  zero.fill(0, 73, 81);
  assert.equal(decodeSolUsd(zero), null);

  const negative = Uint8Array.from(data);
  negative.fill(255, 73, 81);
  assert.equal(decodeSolUsd(negative), null);
});

test("lamports to dollars", () => {
  assert.ok(Math.abs(lamportsToUsd(10_000_000n, 69.235) - 0.69235) < 1e-12);
  assert.equal(lamportsToUsd(0n, 69.235), 0);
  assert.ok(Math.abs(lamportsToUsd(1_000_000_000n, 69.235) - 69.235) < 1e-12);
});

test("dollar amounts as text", () => {
  assert.equal(usdText(0.69235), "$0.69");
  assert.equal(usdText(0.696), "$0.70");
  assert.equal(usdText(69.235), "$69.24");
  assert.equal(usdText(1234.5), "$1,234.50");
  assert.equal(usdText(1234567.891), "$1,234,567.89");
  assert.equal(usdText(0), "$0.00");
  // An amount that is not nothing never reads as nothing.
  assert.equal(usdText(0.004), "<$0.01");
  assert.equal(usdText(0.0000023), "<$0.01");
  assert.equal(usdText(Number.NaN), "");
  assert.equal(usdText(-1), "");
  assert.equal(usdText(Number.POSITIVE_INFINITY), "");
});
