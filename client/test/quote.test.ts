// (3) minTokensForRung and the quotes give the Rust numbers; the budget math.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { PublicKey } from "@solana/web3.js";

import {
  FeeConfig,
  MAX_FEE_BUDGET_LAMPORTS,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  base64Decode,
  bondingCurvePda,
  curveFees,
  decodeBondingCurve,
  decodeFeeConfig,
  decodeMint,
  decodePumpGlobal,
  expectedTokensSeen,
  expectedTokensStart,
  feeBudget,
  maxFeeLamports,
  minTokensAt,
  minTokensForRung,
  pickFeeTier,
  pumpFeeConfigPda,
  pumpGlobalPda,
  quoteOrder,
  quotesAgree,
  rawQuote,
  rentReserve,
} from "../src/index";
import { REPO_DIR, vectors } from "./helpers";

const v = vectors();

test("minTokensAt / minTokensForRung equal math.rs on the Rust vectors", () => {
  for (const c of v.math.min_tokens) {
    const seen = BigInt(c.seen);
    const start = BigInt(c.start);
    assert.equal(minTokensAt(seen, c.cap_bps).toString(), c.min_tokens_at_seen_cap);
    assert.equal(minTokensForRung(seen, start, c.rung_bps, c.cap_bps).toString(), c.min_tokens_for_rung);
  }
});

test("math.rs unit test numbers", () => {
  assert.equal(minTokensAt(1_000_000n, 100), 990_100n);
  assert.equal(minTokensAt(123_456_789n, 0), 123_456_789n);
  assert.equal(minTokensAt(10n, 100), 10n);
  assert.equal(minTokensAt((1n << 64n) - 1n, 0), (1n << 64n) - 1n);
  assert.equal(minTokensForRung(1_000_000n, 950_000n, 300, 300), minTokensAt(1_000_000n, 300));
  assert.equal(minTokensForRung(1_000_000n, 1_100_000n, 100, 300), minTokensAt(1_100_000n, 100));
});

test("rawQuote equals venue.rs raw_quote", () => {
  for (const c of v.math.raw_quote) {
    const got = rawQuote(BigInt(c.lamports), {
      virtualTokenReserves: BigInt(c.virtual_token),
      virtualQuoteReserves: BigInt(c.virtual_quote),
    });
    assert.equal(got.toString(), c.raw_quote);
  }
  assert.equal(rawQuote(10_000n, { virtualTokenReserves: 1_000_000n, virtualQuoteReserves: 30_000n }), 250_000n);
});

// real_pump.rs T5 on the 2026-11-23 mainnet snapshot: a 0.1 SOL buy returned
// exactly the A1 formula with the fee_config tier (protocol 95, creator 30).
const T5 = {
  amount: 100_000_000n,
  reserves: { virtualTokenReserves: 774_376_454_879_262n, virtualQuoteReserves: 41_568_929_187n },
  supply: 1_000_000_000_000_000n,
  marketCap: 53_680_517_951n,
  protocol: 95n,
  creator: 30n,
  actual: 1_835_513_681_547n,
  raw: 1_858_402_579_543n,
};

test("expectedTokensSeen reproduces the real pump buy of real_pump.rs T5", () => {
  assert.equal(expectedTokensSeen(T5.amount, T5.reserves, T5.protocol, T5.creator), T5.actual);
  assert.equal(rawQuote(T5.amount, T5.reserves), T5.raw);
  assert.ok(quotesAgree(T5.actual, T5.raw));
});

test("fee tier selection: highest threshold at or below the market cap, else the first", () => {
  const fees = (p: bigint) => ({ lpFeeBps: 0n, protocolFeeBps: p, creatorFeeBps: 0n });
  const cfg: FeeConfig = {
    bump: 0,
    admin: PublicKey.default,
    flatFees: fees(0n),
    feeTiers: [
      { marketCapLamportsThreshold: 100n, fees: fees(1n) },
      { marketCapLamportsThreshold: 1_000n, fees: fees(2n) },
    ],
    stableFeeTiers: [],
    exoticFlatFees: fees(0n),
  };
  assert.equal(pickFeeTier(cfg, 50n).protocolFeeBps, 1n);
  assert.equal(pickFeeTier(cfg, 100n).protocolFeeBps, 1n);
  assert.equal(pickFeeTier(cfg, 999n).protocolFeeBps, 1n);
  assert.equal(pickFeeTier(cfg, 1_000n).protocolFeeBps, 2n);
});

test("expectedTokensStart is open_order's scaling", () => {
  assert.equal(expectedTokensStart(1_000n, 2_000n, 1_900n), 950n);
});

// The mainnet accounts real_pump.rs runs on (git-ignored; skipped without them).
const FIXTURE = join(REPO_DIR, "programs/rung/tests/fixtures/pump/accounts.json");

test("decoders read the mainnet fixture and quote the T5 buy", { skip: !existsSync(FIXTURE) }, () => {
  const json = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const account = (address: string) => {
    const a = json.accounts.find((x: { address: string }) => x.address === address);
    assert.ok(a?.exists, `fixture account ${address}`);
    return base64Decode(a.data);
  };
  const mint = new PublicKey(json.buy_accounts[1].address);
  const curve = decodeBondingCurve(account(bondingCurvePda(mint).toBase58()));
  const feeConfig = decodeFeeConfig(account(pumpFeeConfigPda().toBase58()));
  const global = decodePumpGlobal(account(pumpGlobalPda().toBase58()));
  const { supply } = decodeMint(account(mint.toBase58()));

  assert.equal(curve.virtualTokenReserves, T5.reserves.virtualTokenReserves);
  assert.equal(curve.virtualQuoteReserves, T5.reserves.virtualQuoteReserves);
  assert.equal(curve.complete, false);
  assert.ok(curve.quoteMint.equals(PublicKey.default));
  assert.equal(supply, T5.supply);
  assert.equal(global.feeBasisPoints, 95n);
  assert.equal(global.buybackBasisPoints, 5_000n);
  assert.ok(global.buybackFeeRecipients.some((k) => k.toBase58() === json.buy_accounts[13].address));

  const fees = curveFees(curve, feeConfig, supply);
  assert.deepEqual(fees, { protocolFeeBps: T5.protocol, creatorFeeBps: T5.creator, marketCapLamports: T5.marketCap });
  const q = quoteOrder(T5.amount, curve, feeConfig, supply);
  assert.equal(q.expectedTokensSeen, T5.actual);
  assert.equal(q.rawTokensSeen, T5.raw);
});

test("maxFeeLamports = rungCount * (5000 + cuLimit * cuPrice / 1e6)", () => {
  assert.equal(maxFeeLamports(3, 200_000, 5_000n), 3n * (5_000n + 1_000n));
  assert.equal(maxFeeLamports(1, 200_000, 0n), 5_000n);
  // Rounds the priority fee up, as the runtime does.
  assert.equal(maxFeeLamports(1, 1, 1n), 5_001n);
});

test("feeBudget adds refund, sweep and the rent-exempt minimum, and stops at the program's limit", () => {
  const b = feeBudget({ rungCount: 3, rentExemptMinimum: 890_880n, cuLimit: 200_000, cuPrice: 5_000n });
  assert.equal(b.tries, 18_000n);
  assert.equal(b.refund, 5_000n + 250n);
  assert.equal(b.sweep, 5_000n);
  assert.equal(b.total, 18_000n + 5_250n + 5_000n + 890_880n);
  assert.throws(
    () => feeBudget({ rungCount: 5, rentExemptMinimum: 890_880n, cuLimit: 200_000, cuPrice: 2_000_000n }),
    new RegExp(`above the program's limit of ${MAX_FEE_BUDGET_LAMPORTS}`),
  );
});

test("rentReserve: two token accounts, the accumulator and a margin, within the limit", async () => {
  const rent = async (len: number) => BigInt((len + 128) * 6_960);
  const spl = await rentReserve(rent, TOKEN_PROGRAM_ID);
  assert.equal(spl.userTokenAccount, BigInt((165 + 128) * 6_960));
  assert.equal(spl.accumulator, BigInt((137 + 128) * 6_960));
  const t22 = await rentReserve(rent, TOKEN_2022_PROGRAM_ID);
  assert.equal(t22.userTokenAccount, BigInt((170 + 128) * 6_960));
  assert.equal(t22.total, 2n * t22.userTokenAccount + t22.accumulator + t22.margin);
  await assert.rejects(rentReserve(rent, TOKEN_PROGRAM_ID, 10_000_000n), /above the program's limit/);
});
