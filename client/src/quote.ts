// Quotes. All amounts are bigint (lamports, token base units, basis points).

import { PublicKey } from "@solana/web3.js";

import type { BondingCurve, FeeConfig, Fees } from "./accounts";
import { BPS_DENOMINATOR, MAX_VENUE_FEE_BPS } from "./constants";

const U64_MAX = (1n << 64n) - 1n;
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

function checkU64(value: bigint, what: string): bigint {
  if (value < 0n || value > U64_MAX) throw new RangeError(`${what} overflows u64`);
  return value;
}

export interface Reserves {
  virtualTokenReserves: bigint;
  virtualQuoteReserves: bigint;
}

/**
 * Fee-free constant-product quote (`venue.rs` `raw_quote`):
 * `floor(lamports * token_reserves / (quote_reserves + lamports))`.
 */
export function rawQuote(lamports: bigint, reserves: Reserves): bigint {
  const denominator = reserves.virtualQuoteReserves + lamports;
  if (denominator === 0n) throw new Error("empty curve reserves");
  return checkU64((lamports * reserves.virtualTokenReserves) / denominator, "raw quote");
}

/**
 * Tokens pump's `buy_exact_quote_in_v3` returns for `spendable` lamports: the
 * SOL -> tokens formula from pump's IDL docs (docs/pump-arayuz.md A1).
 */
export function expectedTokensSeen(
  spendable: bigint,
  reserves: Reserves,
  protocolFeeBps: bigint,
  creatorFeeBps: bigint,
): bigint {
  return quoteAfterFees(spendable, reserves, [protocolFeeBps, creatorFeeBps]);
}

/**
 * pump A1's steps with any number of fees, each rounded up on its own:
 * 1. `net = floor(s * 10_000 / (10_000 + sum(fees)))`
 * 2. `fees = sum(ceil(net * fee / 10_000))`; if `net + fees > s`, `net -= net + fees - s`
 * 3. `out = floor((net - 1) * tokens / (quote + net - 1))`
 */
function quoteAfterFees(spendable: bigint, reserves: Reserves, feeBps: readonly bigint[]): bigint {
  const total = feeBps.reduce((a, b) => a + b, 0n);
  let net = (spendable * BPS_DENOMINATOR) / (BPS_DENOMINATOR + total);
  const fees = feeBps.reduce((sum, bps) => sum + ceilDiv(net * bps, BPS_DENOMINATOR), 0n);
  if (net + fees > spendable) net -= net + fees - spendable;
  if (net <= 1n) throw new RangeError("amount too small for a quote");
  return checkU64(
    ((net - 1n) * reserves.virtualTokenReserves) / (reserves.virtualQuoteReserves + net - 1n),
    "quote",
  );
}

/** Curve market cap in lamports (Pump Fees README): `virtual_quote * supply / virtual_token`. */
export function curveMarketCapLamports(reserves: Reserves, mintSupply: bigint): bigint {
  return (reserves.virtualQuoteReserves * mintSupply) / reserves.virtualTokenReserves;
}

/** The highest tier whose threshold is at most `marketCap`; the first tier if none is. */
export function pickFeeTier(feeConfig: FeeConfig, marketCapLamports: bigint): Fees {
  const tiers = feeConfig.feeTiers;
  if (tiers.length === 0) throw new Error("fee_config has no fee tiers");
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (tiers[i].marketCapLamportsThreshold <= marketCapLamports) return tiers[i].fees;
  }
  return tiers[0].fees;
}

export interface CurveFees {
  protocolFeeBps: bigint;
  creatorFeeBps: bigint;
  marketCapLamports: bigint;
}

/**
 * Fee rates pump applies to a buy on this curve: the `fee_config` tier for the
 * curve's market cap (as `real_pump.rs` T5 found on mainnet). The creator
 * part is 0 when the curve has no creator (pump IDL docs).
 */
export function curveFees(curve: BondingCurve, feeConfig: FeeConfig, mintSupply: bigint): CurveFees {
  const marketCapLamports = curveMarketCapLamports(curve, mintSupply);
  const tier = pickFeeTier(feeConfig, marketCapLamports);
  const hasCreator = !curve.creator.equals(PublicKey.default);
  return {
    protocolFeeBps: tier.protocolFeeBps,
    creatorFeeBps: hasCreator ? tier.creatorFeeBps : 0n,
    marketCapLamports,
  };
}

export interface OrderQuote extends CurveFees {
  amount: bigint;
  /** With fees: what the buy should return now. Sent as `expected_tokens_seen`. */
  expectedTokensSeen: bigint;
  /** Without fees, on the same reserves. Sent as `raw_tokens_seen`. */
  rawTokensSeen: bigint;
}

/** Both quotes `open_order` needs, checked against the program's fee band. */
export function quoteOrder(amount: bigint, curve: BondingCurve, feeConfig: FeeConfig, mintSupply: bigint): OrderQuote {
  const fees = curveFees(curve, feeConfig, mintSupply);
  const seen = expectedTokensSeen(amount, curve, fees.protocolFeeBps, fees.creatorFeeBps);
  const raw = rawQuote(amount, curve);
  if (!quotesAgree(seen, raw)) {
    throw new Error(`quote with fees (${seen}) is not within ${MAX_VENUE_FEE_BPS} bps below the fee-free quote (${raw})`);
  }
  return { ...fees, amount, expectedTokensSeen: seen, rawTokensSeen: raw };
}

// --- PumpSwap pool (docs/pump-arayuz.md K4, K5) ------------------------------------------

/**
 * The reserves a pool's price comes from (`pump_swap.rs` `pool_reserves`): the
 * base token balance, and the wrapped-SOL balance plus `virtual_quote_reserves`.
 */
export function poolReserves(
  pool: { virtualQuoteReserves: bigint },
  baseBalance: bigint,
  quoteBalance: bigint,
): Reserves {
  const effectiveQuote = quoteBalance + pool.virtualQuoteReserves;
  if (baseBalance <= 0n || effectiveQuote <= 0n) throw new Error("pool has no usable reserves");
  return { virtualTokenReserves: baseBalance, virtualQuoteReserves: checkU64(effectiveQuote, "pool quote reserve") };
}

/** Pool market cap in lamports (Pump Fees README `poolMarketCap`): `quote * supply / base`, effective quote. */
export function poolMarketCapLamports(reserves: Reserves, mintSupply: bigint): bigint {
  return (reserves.virtualQuoteReserves * mintSupply) / reserves.virtualTokenReserves;
}

export interface PoolFees {
  lpFeeBps: bigint;
  protocolFeeBps: bigint;
  creatorFeeBps: bigint;
  marketCapLamports: bigint;
}

/**
 * Fee rates PumpSwap applies to a buy on a canonical pool: the AMM
 * `fee_config` tier for the pool's market cap (real_pumpswap.rs T5: the
 * BuyEvent's three rates were exactly this tier's).
 */
export function poolFees(reserves: Reserves, feeConfig: FeeConfig, mintSupply: bigint): PoolFees {
  const marketCapLamports = poolMarketCapLamports(reserves, mintSupply);
  const tier = pickFeeTier(feeConfig, marketCapLamports);
  return {
    lpFeeBps: tier.lpFeeBps,
    protocolFeeBps: tier.protocolFeeBps,
    creatorFeeBps: tier.creatorFeeBps,
    marketCapLamports,
  };
}

/** Tokens `buy_exact_quote_in_v2` returns for `spendable` lamports of wrapped SOL (K5, exact in T5). */
export function poolExpectedTokens(spendable: bigint, reserves: Reserves, fees: Omit<PoolFees, "marketCapLamports">): bigint {
  return quoteAfterFees(spendable, reserves, [fees.lpFeeBps, fees.protocolFeeBps, fees.creatorFeeBps]);
}

export interface PoolOrderQuote extends PoolFees {
  amount: bigint;
  /** With fees. Sent as `expected_tokens_seen`. */
  expectedTokensSeen: bigint;
  /** Without fees, on the same effective reserves. Sent as `raw_tokens_seen`. */
  rawTokensSeen: bigint;
}

/** Both quotes `open_order` needs for a PumpSwap order, checked against the program's fee band. */
export function quotePoolOrder(amount: bigint, reserves: Reserves, feeConfig: FeeConfig, mintSupply: bigint): PoolOrderQuote {
  const fees = poolFees(reserves, feeConfig, mintSupply);
  const seen = poolExpectedTokens(amount, reserves, fees);
  const raw = rawQuote(amount, reserves);
  if (!quotesAgree(seen, raw)) {
    throw new Error(`quote with fees (${seen}) is not within ${MAX_VENUE_FEE_BPS} bps below the fee-free quote (${raw})`);
  }
  return { ...fees, amount, expectedTokensSeen: seen, rawTokensSeen: raw };
}

/** `open_order`'s check: `seen <= raw` and `seen >= raw * (1 - MAX_VENUE_FEE_BPS)`. */
export function quotesAgree(seen: bigint, raw: bigint): boolean {
  return seen > 0n && seen <= raw && seen * BPS_DENOMINATOR >= raw * (BPS_DENOMINATOR - MAX_VENUE_FEE_BPS);
}

/** `math.rs` `min_tokens_at`: fewest tokens at most `slippageBps` above a quote, rounded up. */
export function minTokensAt(expectedTokens: bigint, slippageBps: number): bigint {
  const denominator = BPS_DENOMINATOR + BigInt(slippageBps);
  return checkU64(ceilDiv(expectedTokens * BPS_DENOMINATOR, denominator), "min tokens");
}

/** `math.rs` `min_tokens_for_rung`: the stricter of the cap floor and the rung floor. */
export function minTokensForRung(
  expectedTokensSeen: bigint,
  expectedTokensStart: bigint,
  rungBps: number,
  capBps: number,
): bigint {
  const capFloor = minTokensAt(expectedTokensSeen, capBps);
  const rungFloor = minTokensAt(expectedTokensStart, rungBps);
  return capFloor > rungFloor ? capFloor : rungFloor;
}

/** `open_order`: `floor(seen * raw_quote(amount, reserves now) / raw_seen)`. */
export function expectedTokensStart(seen: bigint, rawSeen: bigint, rawNow: bigint): bigint {
  return checkU64((seen * rawNow) / rawSeen, "expected tokens start");
}
