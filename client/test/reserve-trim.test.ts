// The order hands the vault the rent of the accounts a buy may create. Two of
// them outlive the buy: the buyer's own token account and the venue's volume
// account for the vault. When they already exist the buy creates nothing, so
// their rent need not leave the wallet at all (Buğra, Nov 27: a 0.01 SOL buy
// showed as 0.02 in the wallet). The two accounts that are opened and closed
// inside the buy (the vault's token account and, in a pool, its wrapped-SOL
// account) and the margin always stay: without them the buy could not run.
import assert from "node:assert/strict";
import { test } from "node:test";

import { TOKEN_2022_PROGRAM_ID, rentReserve, trimReserve } from "../src";

// Mainnet rent (docs/pump-arayuz.md K7): 165 B 1,488,440; 170 B 1,513,840; 137 B 1,346,200.
const mainnet: Record<number, bigint> = { 165: 1_488_440n, 170: 1_513_840n, 137: 1_346_200n };
const rent = async (len: number) => mainnet[len];

test("nothing exists yet (a first buy): the whole reserve, as before", async () => {
  const full = await rentReserve(rent, TOKEN_2022_PROGRAM_ID, undefined, "PumpSwap");
  assert.deepEqual(trimReserve(full, { userTokenAccount: false, accumulator: false }), full);
  assert.equal(full.total, 6_362_320n);
});

test("both accounts exist (a repeat buy of the same token): only what the buy itself needs", async () => {
  const full = await rentReserve(rent, TOKEN_2022_PROGRAM_ID, undefined, "PumpSwap");
  const t = trimReserve(full, { userTokenAccount: true, accumulator: true });
  assert.equal(t.userTokenAccount, 0n);
  assert.equal(t.accumulator, 0n);
  // the vault's token account, its wrapped-SOL account and the margin are untouched
  assert.equal(t.vaultTokenAccount, 1_513_840n);
  assert.equal(t.vaultWsolAccount, 1_488_440n);
  assert.equal(t.margin, full.margin);
  assert.equal(t.total, 1_513_840n + 1_488_440n + full.margin);
  assert.equal(t.total, 3_502_280n);
});

test("a new token for a wallet that has bought before: the token account's rent stays in", async () => {
  const full = await rentReserve(rent, TOKEN_2022_PROGRAM_ID, undefined, "PumpSwap");
  const t = trimReserve(full, { userTokenAccount: false, accumulator: true });
  assert.equal(t.userTokenAccount, 1_513_840n);
  assert.equal(t.total, full.total - 1_346_200n);
});

test("on the curve too: no wrapped-SOL account there, the same rule", async () => {
  const full = await rentReserve(rent, TOKEN_2022_PROGRAM_ID);
  const t = trimReserve(full, { userTokenAccount: true, accumulator: true });
  assert.equal(t.vaultWsolAccount, 0n);
  assert.equal(t.total, 1_513_840n + full.margin);
});

test("the parts always add up to the total", async () => {
  const full = await rentReserve(rent, TOKEN_2022_PROGRAM_ID, undefined, "PumpSwap");
  for (const userTokenAccount of [true, false]) {
    for (const accumulator of [true, false]) {
      const t = trimReserve(full, { userTokenAccount, accumulator });
      assert.equal(t.total, t.userTokenAccount + t.vaultTokenAccount + t.vaultWsolAccount + t.accumulator + t.margin);
    }
  }
});
