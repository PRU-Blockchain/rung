// The dollar value of a SOL amount, for display only. The price is read from
// the chain: Pyth's SOL/USD price account, written by Pyth's receiver program
// about once a minute (seen Nov 25, 2026). No price service, no key.

import { PublicKey } from "@solana/web3.js";

import { Reader, startsWith } from "./bytes";

/** Pyth's receiver program; it owns the price accounts. */
export const PYTH_RECEIVER_PROGRAM_ID = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
/** Pyth's SOL/USD price account (the same address on mainnet and devnet). */
export const PYTH_SOL_USD_ACCOUNT = new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");

// Anchor discriminator of the account type ("PriceUpdateV2").
const PRICE_UPDATE_DISCRIMINATOR = [0x22, 0xf1, 0x23, 0x63, 0x9d, 0x7e, 0xf4, 0xcd] as const;
// Pyth's id of the SOL/USD feed.
const SOL_USD_FEED_ID = [
  0xef, 0x0d, 0x8b, 0x6f, 0xda, 0x2c, 0xeb, 0xa4, 0x1d, 0xa1, 0x5d, 0x40, 0x95, 0xd1, 0xda, 0x39, 0x2a, 0x0d, 0x2f, 0x8e,
  0xd0, 0xc6, 0xc7, 0xbc, 0x0f, 0x4c, 0xfa, 0xc8, 0xc2, 0x80, 0xb5, 0x6d,
] as const;

// discriminator 8, write authority 32, verification level 1 ("full"), then the
// price message: feed id 32, price i64, confidence u64, exponent i32, publish
// time i64, previous publish time i64, two averages (i64, u64); posted slot u64.
const VERIFICATION_AT = 40;
const FEED_ID_AT = 41;
const PRICE_AT = 73;
const EXPONENT_AT = 89;
const POSTED_SLOT_AT = 125;
const FULL_LENGTH = 133;
const VERIFICATION_FULL = 1;

/**
 * A price older than this many slots is not shown (about five minutes at
 * 0.4 s a slot). Counted in slots read together with the account, so the
 * phone's clock does not matter.
 */
export const SOL_USD_MAX_AGE_SLOTS = 750;

export interface SolUsd {
  usdPerSol: number;
  /** The slot the price was written in. */
  postedSlot: number;
}

/** The price in a Pyth price account, or null when it is not a fully verified SOL/USD price. */
export function decodeSolUsd(data: Uint8Array): SolUsd | null {
  if (data.length < FULL_LENGTH) return null;
  if (!startsWith(data, PRICE_UPDATE_DISCRIMINATOR)) return null;
  if (data[VERIFICATION_AT] !== VERIFICATION_FULL) return null;
  if (!startsWith(data.subarray(FEED_ID_AT), SOL_USD_FEED_ID)) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const price = view.getBigInt64(PRICE_AT, true);
  const exponent = view.getInt32(EXPONENT_AT, true);
  if (price <= 0n || exponent > 0 || exponent < -18) return null;
  const postedSlot = Number(new Reader(data, POSTED_SLOT_AT).u64());
  return { usdPerSol: Number(price) / 10 ** -exponent, postedSlot };
}

/**
 * The SOL/USD price from the account read at `PYTH_SOL_USD_ACCOUNT`, or null
 * when there is nothing to show: no account, another owner, not a price, or
 * written more than `SOL_USD_MAX_AGE_SLOTS` before `slotNow` (the slot of the
 * same read).
 */
export function solUsdFromAccount(account: { owner: PublicKey; data: Uint8Array } | null, slotNow: number): SolUsd | null {
  if (!account || !account.owner.equals(PYTH_RECEIVER_PROGRAM_ID)) return null;
  const price = decodeSolUsd(account.data);
  if (!price || slotNow - price.postedSlot > SOL_USD_MAX_AGE_SLOTS) return null;
  return price;
}

export const lamportsToUsd = (lamports: bigint, usdPerSol: number): number => (Number(lamports) / 1e9) * usdPerSol;

/** "$0.69", "$1,234.50"; "<$0.01" for an amount that would round to nothing; "" when there is no amount. */
export function usdText(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) return "";
  const cents = Math.round(usd * 100);
  if (cents === 0 && usd > 0) return "<$0.01";
  const whole = Math.floor(cents / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${whole}.${(cents % 100).toString().padStart(2, "0")}`;
}
