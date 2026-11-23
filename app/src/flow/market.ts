// Where a token trades now (pump.fun bonding curve or its PumpSwap pool) and
// what an order there needs, the way scripts/devnet-ladder.ts reads it, with
// messages for the screen.

import type { AccountInfo } from "@solana/web3.js";

import {
  BondingCurve,
  FeeConfig,
  PoolAccounts,
  PoolMarket,
  PublicKey,
  Reserves,
  Venue,
  bondingCurvePda,
  decodeBondingCurve,
  decodeFeeConfig,
  decodeMint,
  decodePool,
  decodePumpGlobal,
  decodeTokenAccount,
  fetchPoolMarket,
  poolReserves,
  pumpFeeConfigPda,
  pumpGlobalPda,
  resolveVenue,
} from "../../../client/src";

import { connection } from "./connection";

interface MarketBase {
  mint: PublicKey;
  tokenProgram: PublicKey;
  decimals: number;
  supply: bigint;
  /** Curve: one of pump's buyback wallets. Pool: a listed buyback wallet's wrapped-SOL account. */
  buybackRecipient: PublicKey;
}

export interface CurveMarket extends MarketBase {
  venue: "Curve";
  curve: BondingCurve;
  feeConfig: FeeConfig;
}

export interface PoolTokenMarket extends MarketBase {
  venue: "PumpSwap";
  pool: PoolMarket;
}

export type Market = CurveMarket | PoolTokenMarket;

/** A reason the token cannot be bought here, worded for the screen. */
export class MarketError extends Error {}

export const NOT_PUMP = "This token is not a pump.fun token.";
export const NO_POOL_YET = "This token's curve is complete but its pool does not exist yet.";

/** `resolveVenue`'s reasons, worded for the screen. */
const REASONS: Record<string, string> = {
  "mint not found": "No token was found at this address.",
  "not a token mint": "This address is not a token.",
  "not a pump.fun token": NOT_PUMP,
  "curve is not paired with SOL": "This token is not paired with SOL.",
  "cashback coin is not supported": "This kind of pump.fun token is not supported yet.",
  "curve complete, no canonical pool yet": NO_POOL_YET,
  "canonical pool is not owned by PumpSwap": "This token's pool could not be read.",
  "canonical pool could not be read": "This token's pool could not be read.",
  "canonical pool is for another mint": "This token's pool could not be read.",
  "pool is not paired with SOL": "This token's pool is not paired with SOL.",
  "cashback pool is not supported": "Cashback pools are not supported.",
};

export const reasonText = (reason: string) => REASONS[reason] ?? "This token cannot be bought here.";

/** One line for the token box. */
export const venueText = (venue: Venue) => (venue === "PumpSwap" ? "In a PumpSwap pool" : "On a pump.fun bonding curve");

export function parseMint(text: string): PublicKey | null {
  try {
    const t = text.trim();
    return t.length >= 32 ? new PublicKey(t) : null;
  } catch {
    return null;
  }
}

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

export async function loadMarket(mint: PublicKey): Promise<Market> {
  const r = await resolveVenue(connection, mint);
  if (!r.ok) throw new MarketError(reasonText(r.reason));
  if (r.venue === "PumpSwap") {
    let pool: PoolMarket;
    try {
      pool = await fetchPoolMarket(connection, mint, r);
    } catch (e) {
      const text = String((e as Error)?.message ?? e);
      if (/Network request failed/i.test(text)) throw e;
      console.log(`RUNG pool not usable: ${text}`);
      throw new MarketError(/buyback|global config|fee_config/.test(text) ? "PumpSwap is not available on this network." : "This token's pool could not be read.");
    }
    return {
      venue: "PumpSwap",
      mint,
      tokenProgram: pool.tokenProgram,
      decimals: pool.decimals,
      supply: pool.supply,
      pool,
      buybackRecipient: pick(pool.buybackWsolAccounts),
    };
  }

  const [mintInfo, feeInfo, globalInfo] = await connection.getMultipleAccountsInfo([mint, pumpFeeConfigPda(), pumpGlobalPda()]);
  if (!mintInfo) throw new MarketError("No token was found at this address.");
  if (!feeInfo || !globalInfo) throw new MarketError("pump.fun is not available on this network.");
  const recipients = decodePumpGlobal(globalInfo.data).buybackFeeRecipients.filter((k) => !k.equals(PublicKey.default));
  if (recipients.length === 0) throw new MarketError("pump.fun is not available on this network.");
  const { supply, decimals } = decodeMint(mintInfo.data);
  return {
    venue: "Curve",
    mint,
    tokenProgram: r.tokenProgram,
    decimals,
    supply,
    curve: r.curve,
    feeConfig: decodeFeeConfig(feeInfo.data),
    buybackRecipient: pick(recipients),
  };
}

/** The accounts a quote refresh reads: the curve, or the pool and its two token accounts. */
export const priceKeys = (m: Market): PublicKey[] =>
  m.venue === "Curve"
    ? [bondingCurvePda(m.mint)]
    : [m.pool.poolAccounts.address, m.pool.poolAccounts.baseTokenAccount, m.pool.poolAccounts.quoteTokenAccount];

/**
 * The market with fresh reserves from `infos` (read with `priceKeys`), or
 * "moved" when the curve completed meanwhile (load the token again: it is in
 * a pool now, or the pool does not exist yet).
 */
export function withPrice(m: Market, infos: (AccountInfo<Buffer> | null)[]): Market | "moved" {
  if (m.venue === "Curve") {
    const info = infos[0];
    if (!info) throw new MarketError(NOT_PUMP);
    const curve = decodeBondingCurve(info.data);
    if (curve.complete) return "moved";
    return { ...m, curve };
  }
  const [poolInfo, baseInfo, quoteInfo] = infos;
  if (!poolInfo || !baseInfo || !quoteInfo) throw new MarketError("This token's pool could not be read.");
  const pool = decodePool(poolInfo.data);
  const baseBalance = decodeTokenAccount(baseInfo.data).amount;
  const quoteBalance = decodeTokenAccount(quoteInfo.data).amount;
  return { ...m, pool: { ...m.pool, pool, baseBalance, quoteBalance, reserves: poolReserves(pool, baseBalance, quoteBalance) } };
}

/** Reserves the price comes from now, for the "not bought" line; null when unknown. */
export async function reservesNow(venue: Venue, mint: PublicKey, pool?: PoolAccounts): Promise<Reserves | null> {
  if (venue === "Curve") {
    const info = await connection.getAccountInfo(bondingCurvePda(mint), "confirmed");
    if (!info) return null;
    const curve = decodeBondingCurve(info.data);
    // A curve that completed meanwhile has no tokens left to quote.
    return curve.complete ? null : curve;
  }
  if (!pool) return null;
  const [p, b, q] = await connection.getMultipleAccountsInfo([pool.address, pool.baseTokenAccount, pool.quoteTokenAccount], "confirmed");
  if (!p || !b || !q) return null;
  return poolReserves(decodePool(p.data), decodeTokenAccount(b.data).amount, decodeTokenAccount(q.data).amount);
}

/**
 * Seconds since the curve account's first transaction (its creation), or
 * null if unknown. Only "younger than two minutes" matters, so when there are
 * more signatures than one page the oldest on the page still answers that.
 */
export async function curveAgeSeconds(mint: PublicKey): Promise<number | null> {
  const sigs = await connection.getSignaturesForAddress(bondingCurvePda(mint), { limit: 1000 });
  const oldest = sigs[sigs.length - 1];
  if (!oldest?.blockTime) return null;
  return Date.now() / 1000 - oldest.blockTime;
}
