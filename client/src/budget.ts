// What an order hands to the session key (fee budget) and to the vault (rent
// reserve), and the most the fees can be. The compute numbers are defaults
// until they are measured on a live cluster.

import {
  LAMPORTS_PER_SIGNATURE,
  MAX_FEE_BUDGET_LAMPORTS,
  MAX_RENT_RESERVE_LAMPORTS,
  SPL_TOKEN_ACCOUNT_LEN,
  TOKEN_2022_ACCOUNT_LEN,
  TOKEN_2022_PROGRAM_ID,
  USER_VOLUME_ACCUMULATOR_LEN,
} from "./constants";
import type { PublicKey } from "@solana/web3.js";

export const DEFAULT_CU_LIMIT = 200_000;
/** Micro-lamports per compute unit. */
export const DEFAULT_CU_PRICE = 5_000n;
/** Compute unit limit of the session key's `refund` transaction. */
export const DEFAULT_REFUND_CU_LIMIT = 50_000;
/** Room in the rent reserve for pump topping up an older, shorter curve account. */
export const RENT_RESERVE_MARGIN = 500_000n;

/** Priority fee: `ceil(cuLimit * cuPrice / 1e6)` lamports. */
export function priorityFeeLamports(cuLimit: number, cuPrice: bigint): bigint {
  return (BigInt(cuLimit) * cuPrice + 999_999n) / 1_000_000n;
}

/** Fee of a one-signature transaction with this compute budget. */
export function txFeeLamports(cuLimit = 0, cuPrice = 0n): bigint {
  return LAMPORTS_PER_SIGNATURE + priorityFeeLamports(cuLimit, cuPrice);
}

/** Most the rung tries can cost: `rungCount * (5000 + cuLimit * cuPrice / 1e6)`. */
export function maxFeeLamports(rungCount: number, cuLimit = DEFAULT_CU_LIMIT, cuPrice = DEFAULT_CU_PRICE): bigint {
  return BigInt(rungCount) * txFeeLamports(cuLimit, cuPrice);
}

/** The session key's `refund` (GaveUp) transaction. */
export const refundFeeLamports = (cuPrice = DEFAULT_CU_PRICE, refundCuLimit = DEFAULT_REFUND_CU_LIMIT) =>
  txFeeLamports(refundCuLimit, cuPrice);

/** The plain transfer that returns what is left on the session key. */
export const sweepFeeLamports = () => txFeeLamports();

export interface FeeBudget {
  tries: bigint;
  refund: bigint;
  sweep: bigint;
  /** The session key is a new account: it must hold at least this, or nothing. */
  rentExemptMinimum: bigint;
  total: bigint;
}

/**
 * Lamports `open_order` sends to the session key: every try, the refund and
 * the final sweep at their highest fee, plus the empty account's rent-exempt
 * minimum (`getMinimumBalanceForRentExemption(0)`), so the key stays
 * rent-exempt until the sweep empties it.
 */
export function feeBudget(p: {
  rungCount: number;
  rentExemptMinimum: bigint;
  cuLimit?: number;
  cuPrice?: bigint;
  refundCuLimit?: number;
}): FeeBudget {
  const cuPrice = p.cuPrice ?? DEFAULT_CU_PRICE;
  const tries = maxFeeLamports(p.rungCount, p.cuLimit ?? DEFAULT_CU_LIMIT, cuPrice);
  const refund = refundFeeLamports(cuPrice, p.refundCuLimit ?? DEFAULT_REFUND_CU_LIMIT);
  const sweep = sweepFeeLamports();
  const total = tries + refund + sweep + p.rentExemptMinimum;
  if (total > MAX_FEE_BUDGET_LAMPORTS) {
    throw new Error(
      `fee budget ${total} lamports is above the program's limit of ${MAX_FEE_BUDGET_LAMPORTS}: lower the compute unit price or limit, or use fewer rungs`,
    );
  }
  return { tries, refund, sweep, rentExemptMinimum: p.rentExemptMinimum, total };
}

/** Token account size the ATA program creates for a mint of this token program. */
export const tokenAccountLen = (tokenProgram: PublicKey) =>
  tokenProgram.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_ACCOUNT_LEN : SPL_TOKEN_ACCOUNT_LEN;

export interface RentReserve {
  userTokenAccount: bigint;
  vaultTokenAccount: bigint;
  accumulator: bigint;
  margin: bigint;
  total: bigint;
}

/**
 * Lamports for the accounts a fill creates, paid from the vault: the user's
 * token account (kept), the vault's token account (closed again in the same
 * instruction) and pump's volume accumulator for the vault (137 bytes).
 * Whatever is not spent goes back to the user.
 */
export async function rentReserve(
  rentFor: (len: number) => Promise<bigint>,
  tokenProgram: PublicKey,
  margin = RENT_RESERVE_MARGIN,
): Promise<RentReserve> {
  const ata = await rentFor(tokenAccountLen(tokenProgram));
  const accumulator = await rentFor(USER_VOLUME_ACCUMULATOR_LEN);
  const total = ata + ata + accumulator + margin;
  if (total > MAX_RENT_RESERVE_LAMPORTS) {
    throw new Error(`rent reserve ${total} lamports is above the program's limit of ${MAX_RENT_RESERVE_LAMPORTS}`);
  }
  return { userTokenAccount: ata, vaultTokenAccount: ata, accumulator, margin, total };
}
