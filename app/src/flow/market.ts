// Reads a pump curve the way scripts/devnet-ladder.ts does, with messages for the screen.

import {
  BondingCurve,
  FeeConfig,
  PUMP_PROGRAM_ID,
  PublicKey,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  bondingCurvePda,
  decodeBondingCurve,
  decodeFeeConfig,
  decodeMint,
  decodePumpGlobal,
  pumpFeeConfigPda,
  pumpGlobalPda,
} from "../../../client/src";

import { connection } from "./connection";

export interface Market {
  mint: PublicKey;
  tokenProgram: PublicKey;
  decimals: number;
  supply: bigint;
  curve: BondingCurve;
  feeConfig: FeeConfig;
  buybackRecipient: PublicKey;
}

/** A reason the token cannot be bought here, worded for the screen. */
export class MarketError extends Error {}

export const NOT_ON_CURVE = "This token is not on a pump.fun bonding curve.";
export const POOL_TOKEN = "Pool tokens are not supported yet.";

export function parseMint(text: string): PublicKey | null {
  try {
    const t = text.trim();
    return t.length >= 32 ? new PublicKey(t) : null;
  } catch {
    return null;
  }
}

export async function loadMarket(mint: PublicKey): Promise<Market> {
  const [mintInfo, curveInfo, feeInfo, globalInfo] = await connection.getMultipleAccountsInfo([
    mint,
    bondingCurvePda(mint),
    pumpFeeConfigPda(),
    pumpGlobalPda(),
  ]);
  if (!mintInfo) throw new MarketError("No token was found at this address.");
  const tokenProgram = mintInfo.owner;
  if (!tokenProgram.equals(TOKEN_PROGRAM_ID) && !tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new MarketError("This address is not a token.");
  }
  if (!curveInfo || !curveInfo.owner.equals(PUMP_PROGRAM_ID)) throw new MarketError(NOT_ON_CURVE);
  const curve = decodeBondingCurve(curveInfo.data);
  if (curve.complete) throw new MarketError(POOL_TOKEN);
  if (!curve.quoteMint.equals(PublicKey.default)) throw new MarketError("This token is not paired with SOL.");
  if (curve.isCashbackCoin) throw new MarketError("This kind of pump.fun token is not supported yet.");
  if (!feeInfo || !globalInfo) throw new MarketError("pump.fun is not available on this network.");
  const recipients = decodePumpGlobal(globalInfo.data).buybackFeeRecipients.filter((k) => !k.equals(PublicKey.default));
  if (recipients.length === 0) throw new MarketError("pump.fun is not available on this network.");
  const { supply, decimals } = decodeMint(mintInfo.data);
  return {
    mint,
    tokenProgram,
    decimals,
    supply,
    curve,
    feeConfig: decodeFeeConfig(feeInfo.data),
    buybackRecipient: recipients[Math.floor(Math.random() * recipients.length)],
  };
}

/** The curve again (for the 2-3 s quote refresh); the rest of the market does not change. */
export async function refreshCurve(market: Market): Promise<Market> {
  const info = await connection.getAccountInfo(bondingCurvePda(market.mint), "confirmed");
  if (!info) throw new MarketError(NOT_ON_CURVE);
  const curve = decodeBondingCurve(info.data);
  if (curve.complete) throw new MarketError(POOL_TOKEN);
  return { ...market, curve };
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
