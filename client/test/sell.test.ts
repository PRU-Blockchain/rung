// A direct PumpSwap sell from a plain wallet. Rung itself only buys; the
// script uses this to sell what a test buy bought, so the SOL comes back.
// The account order and the discriminators are PumpSwap's public IDL
// (pump-fun/pump-public-docs, idl/pump_amm.json, read 2026-11-24): `sell_v2`
// takes the same 17 accounts as `buy_exact_quote_in_v2`.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { Keypair } from "@solana/web3.js";

import {
  PUMP_IX,
  PUMP_PROGRAM_ID,
  PUMP_SWAP_IX,
  PUMP_SWAP_PROGRAM_ID,
  pumpBuyAccounts,
  pumpCloseVolumeAccumulatorIx,
  pumpEventAuthorityPda,
  pumpSellV3Ix,
  userVolumeAccumulatorPda,
  TOKEN_2022_PROGRAM_ID,
  ammEventAuthorityPda,
  ammUserVolumeAccumulatorPda,
  poolSellEstimate,
  poolExpectedTokens,
  pumpSwapBuyAccounts,
  pumpSwapCloseVolumeAccumulatorIx,
  pumpSwapSellV2Ix,
} from "../src/index";

const key = () => Keypair.generate().publicKey;
const anchorDiscriminator = (name: string) => [...createHash("sha256").update(`global:${name}`).digest().subarray(0, 8)];

const seller = key();
const mint = key();
const pool = { address: key(), baseTokenAccount: key(), quoteTokenAccount: key() };
const buybackWsolAccount = key();

test("the sell discriminators are Anchor's for sell_v2 and close_user_volume_accumulator", () => {
  assert.deepEqual([...PUMP_SWAP_IX.sellV2], anchorDiscriminator("sell_v2"));
  assert.deepEqual([...PUMP_SWAP_IX.sellV2], [93, 246, 130, 60, 231, 233, 64, 178]);
  assert.deepEqual([...PUMP_SWAP_IX.closeUserVolumeAccumulator], anchorDiscriminator("close_user_volume_accumulator"));
});

test("sell_v2: discriminator, then tokens in and minimum lamports out as u64 LE", () => {
  const ix = pumpSwapSellV2Ix({
    seller,
    mint,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    pool,
    buybackWsolAccount,
    tokensIn: 41_291_388n,
    minLamportsOut: 9_900_000n,
  });
  assert.ok(ix.programId.equals(PUMP_SWAP_PROGRAM_ID));
  assert.equal(ix.data.length, 24);
  assert.deepEqual([...ix.data.subarray(0, 8)], [...PUMP_SWAP_IX.sellV2]);
  assert.equal(ix.data.readBigUInt64LE(8), 41_291_388n);
  assert.equal(ix.data.readBigUInt64LE(16), 9_900_000n);
});

test("sell_v2 takes the 17 accounts of the v2 buy, with the seller as the signing user", () => {
  const ix = pumpSwapSellV2Ix({
    seller,
    mint,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    pool,
    buybackWsolAccount,
    tokensIn: 1n,
    minLamportsOut: 1n,
  });
  const buy = pumpSwapBuyAccounts({ buyer: seller, mint, tokenProgram: TOKEN_2022_PROGRAM_ID, pool, buybackWsolAccount, buyerSigns: true });
  assert.equal(ix.keys.length, 17);
  assert.deepEqual(
    ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
    buy.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
  );
  assert.ok(ix.keys[1].pubkey.equals(seller) && ix.keys[1].isSigner);
  assert.equal(ix.keys.filter((k) => k.isSigner).length, 1);
});

test("a sell of nothing, or for nothing, is not built", () => {
  const base = { seller, mint, tokenProgram: TOKEN_2022_PROGRAM_ID, pool, buybackWsolAccount };
  assert.throws(() => pumpSwapSellV2Ix({ ...base, tokensIn: 0n, minLamportsOut: 1n }), /nothing to sell/);
  assert.throws(() => pumpSwapSellV2Ix({ ...base, tokensIn: 1n, minLamportsOut: 0n }), /minimum/);
});

test("close_user_volume_accumulator: user (signer), its accumulator, event authority, program", () => {
  const ix = pumpSwapCloseVolumeAccumulatorIx(seller);
  assert.ok(ix.programId.equals(PUMP_SWAP_PROGRAM_ID));
  assert.deepEqual([...ix.data], [...PUMP_SWAP_IX.closeUserVolumeAccumulator]);
  assert.deepEqual(
    ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
    [
      [seller.toBase58(), true, true],
      [ammUserVolumeAccumulatorPda(seller).toBase58(), false, true],
      [ammEventAuthorityPda().toBase58(), false, false],
      [PUMP_SWAP_PROGRAM_ID.toBase58(), false, false],
    ],
  );
});

// --- the same for a token that still trades on its pump.fun curve ---------------------------
// pump's `sell_v3` takes the 17 accounts of `buy_exact_quote_in_v3` (idl/pump.json, read 2026-11-24).

const buybackRecipient = key();

test("the curve sell discriminator is Anchor's for sell_v3", () => {
  assert.deepEqual([...PUMP_IX.sellV3], anchorDiscriminator("sell_v3"));
  assert.deepEqual([...PUMP_IX.sellV3], [28, 146, 222, 119, 38, 196, 105, 213]);
  // The same instruction name on both programs gives the same bytes; the program id tells them apart.
  assert.deepEqual([...PUMP_IX.closeUserVolumeAccumulator], [...PUMP_SWAP_IX.closeUserVolumeAccumulator]);
});

test("pump sell_v3: discriminator, then tokens in and minimum lamports out as u64 LE", () => {
  const ix = pumpSellV3Ix({ seller, mint, tokenProgram: TOKEN_2022_PROGRAM_ID, buybackRecipient, tokensIn: 123_456_789n, minLamportsOut: 9_800_000n });
  assert.ok(ix.programId.equals(PUMP_PROGRAM_ID));
  assert.equal(ix.data.length, 24);
  assert.deepEqual([...ix.data.subarray(0, 8)], [...PUMP_IX.sellV3]);
  assert.equal(ix.data.readBigUInt64LE(8), 123_456_789n);
  assert.equal(ix.data.readBigUInt64LE(16), 9_800_000n);
});

test("pump sell_v3 takes the 17 accounts of the v3 buy, with the seller as the signing user", () => {
  const ix = pumpSellV3Ix({ seller, mint, tokenProgram: TOKEN_2022_PROGRAM_ID, buybackRecipient, tokensIn: 1n, minLamportsOut: 1n });
  const buy = pumpBuyAccounts({ buyer: seller, mint, tokenProgram: TOKEN_2022_PROGRAM_ID, buybackRecipient, buyerSigns: true });
  assert.equal(ix.keys.length, 17);
  assert.deepEqual(
    ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
    buy.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
  );
  assert.ok(ix.keys[8].pubkey.equals(seller) && ix.keys[8].isSigner);
  assert.equal(ix.keys.filter((k) => k.isSigner).length, 1);
});

test("a curve sell of nothing, or for nothing, is not built", () => {
  const base = { seller, mint, tokenProgram: TOKEN_2022_PROGRAM_ID, buybackRecipient };
  assert.throws(() => pumpSellV3Ix({ ...base, tokensIn: 0n, minLamportsOut: 1n }), /nothing to sell/);
  assert.throws(() => pumpSellV3Ix({ ...base, tokensIn: 1n, minLamportsOut: 0n }), /minimum/);
});

test("pump close_user_volume_accumulator: user (signer), its pump accumulator, event authority, program", () => {
  const ix = pumpCloseVolumeAccumulatorIx(seller);
  assert.ok(ix.programId.equals(PUMP_PROGRAM_ID));
  assert.deepEqual([...ix.data], [...PUMP_IX.closeUserVolumeAccumulator]);
  assert.deepEqual(
    ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
    [
      [seller.toBase58(), true, true],
      [userVolumeAccumulatorPda(seller).toBase58(), false, true],
      [pumpEventAuthorityPda().toBase58(), false, false],
      [PUMP_PROGRAM_ID.toBase58(), false, false],
    ],
  );
  // Not the PumpSwap account of the same wallet.
  assert.ok(!userVolumeAccumulatorPda(seller).equals(ammUserVolumeAccumulatorPda(seller)));
});

// --- the estimate printed before a sell (the minimum itself comes from a simulation) ---

// The deep pool of the mainnet plan of 2026-11-24: about 8,988 SOL against 37.3M tokens, fees 20 + 5 + 5 bps.
const reserves = { virtualTokenReserves: 37_296_062_343_046n, virtualQuoteReserves: 9_005_377_376_564n };
const fees = { lpFeeBps: 20n, protocolFeeBps: 5n, creatorFeeBps: 5n };

test("selling what a buy just bought returns a little less than was spent: two fees, nothing else", () => {
  const spent = 10_000_000n;
  const tokens = poolExpectedTokens(spent, reserves, fees);
  const back = poolSellEstimate(tokens, reserves, fees);
  assert.ok(back < spent);
  // 30 bps on the way in and 30 bps on the way out; on a pool this deep the price impact is below a lamport.
  const lostBps = Number(((spent - back) * 1_000_000n) / spent) / 100;
  assert.ok(lostBps > 59 && lostBps < 61, `lost ${lostBps} bps`);
});

test("the estimate grows with the amount sold and never exceeds the pool's SOL", () => {
  const small = poolSellEstimate(1_000_000n, reserves, fees);
  const large = poolSellEstimate(2_000_000n, reserves, fees);
  assert.ok(large > small && small > 0n);
  assert.ok(poolSellEstimate(10n ** 18n, reserves, fees) < reserves.virtualQuoteReserves);
  assert.throws(() => poolSellEstimate(0n, reserves, fees), /nothing to sell/);
});
