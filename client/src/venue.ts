// Which venue a mint trades on now, and everything a PumpSwap order needs
// from the chain: the canonical pool, its reserves, the fee tier and a
// buyback account that exists.

import type { AccountInfo, Connection, PublicKey } from "@solana/web3.js";

import {
  AmmGlobalConfig,
  BondingCurve,
  FeeConfig,
  Pool,
  decodeAmmGlobalConfig,
  decodeBondingCurve,
  decodeFeeConfig,
  decodeMint,
  decodePool,
  decodeTokenAccount,
} from "./accounts";
import {
  AMM_FEE_CONFIG,
  AMM_GLOBAL_CONFIG,
  PUMP_PROGRAM_ID,
  PUMP_SWAP_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  WSOL_MINT,
} from "./constants";
import type { PoolAccounts } from "./instructions";
import { bondingCurvePda, canonicalPoolPda, wsolAta } from "./pdas";
import { Reserves, poolReserves } from "./quote";

type AccountReader = Pick<Connection, "getMultipleAccountsInfo">;
type Info = AccountInfo<Uint8Array> | null;

const PUBKEY_DEFAULT = "11111111111111111111111111111111";

export type VenueResolution =
  | { ok: true; venue: "Curve"; tokenProgram: PublicKey; curve: BondingCurve }
  | { ok: true; venue: "PumpSwap"; tokenProgram: PublicKey; curve: BondingCurve; poolAddress: PublicKey; pool: Pool }
  | { ok: false; reason: string };

/**
 * Where an order for `mint` can buy now:
 * - the bonding curve, while it is open (SOL-paired, not a cashback coin);
 * - once the curve is complete, the canonical PumpSwap pool, if it exists, is
 *   owned by PumpSwap, is quoted in wrapped SOL and is not a cashback pool
 *   (PumpSwap's v2 buy rejects those with 6079);
 * - otherwise `ok: false` with the reason.
 */
export async function resolveVenue(connection: AccountReader, mint: PublicKey): Promise<VenueResolution> {
  const poolAddress = canonicalPoolPda(mint);
  const [mintInfo, curveInfo, poolInfo] = (await connection.getMultipleAccountsInfo([
    mint,
    bondingCurvePda(mint),
    poolAddress,
  ])) as Info[];
  if (!mintInfo) return { ok: false, reason: "mint not found" };
  const tokenProgram = mintInfo.owner;
  if (!tokenProgram.equals(TOKEN_PROGRAM_ID) && !tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
    return { ok: false, reason: "not a token mint" };
  }
  if (!curveInfo || !curveInfo.owner.equals(PUMP_PROGRAM_ID)) return { ok: false, reason: "not a pump.fun token" };
  let curve: BondingCurve;
  try {
    curve = decodeBondingCurve(curveInfo.data);
  } catch {
    return { ok: false, reason: "not a pump.fun token" };
  }

  if (!curve.complete) {
    if (curve.quoteMint.toBase58() !== PUBKEY_DEFAULT) return { ok: false, reason: "curve is not paired with SOL" };
    if (curve.isCashbackCoin) return { ok: false, reason: "cashback coin is not supported" };
    return { ok: true, venue: "Curve", tokenProgram, curve };
  }

  if (!poolInfo) return { ok: false, reason: "curve complete, no canonical pool yet" };
  if (!poolInfo.owner.equals(PUMP_SWAP_PROGRAM_ID)) return { ok: false, reason: "canonical pool is not owned by PumpSwap" };
  let pool: Pool;
  try {
    pool = decodePool(poolInfo.data);
  } catch {
    return { ok: false, reason: "canonical pool could not be read" };
  }
  if (!pool.baseMint.equals(mint)) return { ok: false, reason: "canonical pool is for another mint" };
  if (!pool.quoteMint.equals(WSOL_MINT)) return { ok: false, reason: "pool is not paired with SOL" };
  if (pool.isCashbackCoin) return { ok: false, reason: "cashback pool is not supported" };
  return { ok: true, venue: "PumpSwap", tokenProgram, curve, poolAddress, pool };
}

/**
 * The wrapped-SOL ATAs of the listed buyback wallets that exist now and are
 * what they claim (SPL Token, WSOL, owned by that wallet). PumpSwap needs
 * one of them: a missing one fails with 6027, an unlisted wallet's with 6053.
 */
export async function findBuybackWsolAccounts(connection: AccountReader, wallets: PublicKey[]): Promise<PublicKey[]> {
  const listed = wallets.filter((k) => k.toBase58() !== PUBKEY_DEFAULT);
  const accounts = listed.map(wsolAta);
  const infos = (await connection.getMultipleAccountsInfo(accounts)) as Info[];
  return accounts.filter((_, i) => {
    const info = infos[i];
    if (!info || !info.owner.equals(TOKEN_PROGRAM_ID) || info.data.length < 72) return false;
    const t = decodeTokenAccount(info.data);
    return t.mint.equals(WSOL_MINT) && t.owner.equals(listed[i]);
  });
}

export interface PoolMarket {
  mint: PublicKey;
  tokenProgram: PublicKey;
  decimals: number;
  supply: bigint;
  pool: Pool;
  poolAccounts: PoolAccounts;
  baseBalance: bigint;
  quoteBalance: bigint;
  /** Effective reserves: base balance, quote balance + `virtual_quote_reserves`. */
  reserves: Reserves;
  feeConfig: FeeConfig;
  globalConfig: AmmGlobalConfig;
  /** Usable buyback accounts (see `findBuybackWsolAccounts`); never empty. */
  buybackWsolAccounts: PublicKey[];
}

/** Reads the canonical pool of a mint that `resolveVenue` sent to `PumpSwap`. */
export async function fetchPoolMarket(
  connection: AccountReader,
  mint: PublicKey,
  resolution: Extract<VenueResolution, { venue: "PumpSwap" }>,
): Promise<PoolMarket> {
  const { pool, poolAddress, tokenProgram } = resolution;
  const [baseInfo, quoteInfo, globalInfo, feeInfo, mintInfo] = (await connection.getMultipleAccountsInfo([
    pool.poolBaseTokenAccount,
    pool.poolQuoteTokenAccount,
    AMM_GLOBAL_CONFIG,
    AMM_FEE_CONFIG,
    mint,
  ])) as Info[];
  if (!baseInfo || !baseInfo.owner.equals(tokenProgram)) throw new Error("pool base token account not found");
  if (!quoteInfo || !quoteInfo.owner.equals(TOKEN_PROGRAM_ID)) throw new Error("pool quote token account not found");
  if (!globalInfo || !globalInfo.owner.equals(PUMP_SWAP_PROGRAM_ID)) throw new Error("PumpSwap global config not found");
  if (!feeInfo) throw new Error("PumpSwap fee_config not found");
  if (!mintInfo) throw new Error("mint not found");
  const baseBalance = decodeTokenAccount(baseInfo.data).amount;
  const quoteBalance = decodeTokenAccount(quoteInfo.data).amount;
  const globalConfig = decodeAmmGlobalConfig(globalInfo.data);
  const buybackWsolAccounts = await findBuybackWsolAccounts(connection, globalConfig.buybackFeeRecipients);
  if (buybackWsolAccounts.length === 0) throw new Error("no listed buyback wallet has a wrapped-SOL account");
  const { supply, decimals } = decodeMint(mintInfo.data);
  return {
    mint,
    tokenProgram,
    decimals,
    supply,
    pool,
    poolAccounts: {
      address: poolAddress,
      baseTokenAccount: pool.poolBaseTokenAccount,
      quoteTokenAccount: pool.poolQuoteTokenAccount,
    },
    baseBalance,
    quoteBalance,
    reserves: poolReserves(pool, baseBalance, quoteBalance),
    feeConfig: decodeFeeConfig(feeInfo.data),
    globalConfig,
    buybackWsolAccounts,
  };
}
