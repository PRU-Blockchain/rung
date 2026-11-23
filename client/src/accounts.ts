// Decoders for the accounts the client reads: Rung's `Order`, pump's
// `BondingCurve` and `Global`, Pump Fees' `FeeConfig`, PumpSwap's `Pool` and
// `GlobalConfig`, and SPL token accounts (docs/pump-arayuz.md E).

import { PublicKey } from "@solana/web3.js";

import { Reader, startsWith } from "./bytes";
import {
  AMM_GLOBAL_CONFIG_DISCRIMINATOR,
  BONDING_CURVE_DISCRIMINATOR,
  FEE_CONFIG_DISCRIMINATOR,
  MAX_RUNGS,
  ORDER_DISCRIMINATOR,
  POOL_DISCRIMINATOR,
  PUMP_GLOBAL_DISCRIMINATOR,
  VENUES,
  type Venue,
} from "./constants";

// --- Rung Order -------------------------------------------------------------

export type OrderStatus = "Uninitialized" | "Open" | "Filled";

const STATUSES: readonly OrderStatus[] = ["Uninitialized", "Open", "Filled"];

export function enumName<T>(names: readonly T[], index: number, what: string): T {
  const name = names[index];
  if (name === undefined) throw new Error(`unknown ${what} variant ${index}`);
  return name;
}

export interface Order {
  user: PublicKey;
  sessionKey: PublicKey;
  mint: PublicKey;
  venue: Venue;
  status: OrderStatus;
  rungCount: number;
  /** The rungs in use (`rungCount` entries); the last one is the cap. */
  rungsBps: number[];
  amount: bigint;
  rentReserve: bigint;
  expectedTokensSeen: bigint;
  expectedTokensStart: bigint;
  startSlot: bigint;
  windowSlots: bigint;
  lastSlot: bigint;
  filledRung: number;
  tokensBought: bigint;
  lamportsSpent: bigint;
  bump: number;
  vaultBump: number;
}

export function decodeOrder(data: Uint8Array): Order {
  if (!startsWith(data, ORDER_DISCRIMINATOR)) throw new Error("not a Rung Order account");
  const r = new Reader(data, 8);
  const user = r.pubkey();
  const sessionKey = r.pubkey();
  const mint = r.pubkey();
  const venue = enumName(VENUES, r.u8(), "Venue");
  const status = enumName(STATUSES, r.u8(), "OrderStatus");
  const rungCount = r.u8();
  const allRungs = Array.from({ length: MAX_RUNGS }, () => r.u16());
  return {
    user,
    sessionKey,
    mint,
    venue,
    status,
    rungCount,
    rungsBps: allRungs.slice(0, rungCount),
    amount: r.u64(),
    rentReserve: r.u64(),
    expectedTokensSeen: r.u64(),
    expectedTokensStart: r.u64(),
    startSlot: r.u64(),
    windowSlots: r.u64(),
    lastSlot: r.u64(),
    filledRung: r.u8(),
    tokensBought: r.u64(),
    lamportsSpent: r.u64(),
    bump: r.u8(),
    vaultBump: r.u8(),
  };
}

/** Slot from which rung `i` may be tried. */
export const rungDueSlot = (order: Pick<Order, "startSlot" | "windowSlots">, rungIndex: number) =>
  order.startSlot + BigInt(rungIndex) * order.windowSlots;

// --- pump BondingCurve ----------------------------------------------------------

export interface BondingCurve {
  virtualTokenReserves: bigint;
  virtualQuoteReserves: bigint;
  realTokenReserves: bigint;
  realQuoteReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
  /** Fields below are absent on older, shorter accounts; read as zero / default. */
  creator: PublicKey;
  isMayhemMode: boolean;
  isCashbackCoin: boolean;
  /** `PublicKey.default` for SOL-paired curves. */
  quoteMint: PublicKey;
  creatorFeeBps: bigint;
  /** Bytes in the account. */
  dataLength: number;
}

export function decodeBondingCurve(data: Uint8Array): BondingCurve {
  if (!startsWith(data, BONDING_CURVE_DISCRIMINATOR)) throw new Error("not a pump BondingCurve account");
  // Older accounts are shorter: pad with zeros, as pump's own client does.
  const padded = new Uint8Array(Math.max(data.length, 123));
  padded.set(data);
  const r = new Reader(padded, 8);
  return {
    virtualTokenReserves: r.u64(),
    virtualQuoteReserves: r.u64(),
    realTokenReserves: r.u64(),
    realQuoteReserves: r.u64(),
    tokenTotalSupply: r.u64(),
    complete: r.bool(),
    creator: r.pubkey(),
    isMayhemMode: r.bool(),
    isCashbackCoin: r.bool(),
    quoteMint: r.pubkey(),
    creatorFeeBps: r.u64(),
    dataLength: data.length,
  };
}

// --- pump Global (only what the client needs) -----------------------------------

export interface PumpGlobal {
  feeBasisPoints: bigint;
  creatorFeeBasisPoints: bigint;
  buybackFeeRecipients: PublicKey[];
  buybackBasisPoints: bigint;
}

/** Offsets from the `Global` field list in docs/pump-arayuz.md E. */
const GLOBAL_FEE_BPS = 105;
const GLOBAL_CREATOR_FEE_BPS = 154;
const GLOBAL_BUYBACK_RECIPIENTS = 741;
const GLOBAL_BUYBACK_BPS = 997;

export function decodePumpGlobal(data: Uint8Array): PumpGlobal {
  if (!startsWith(data, PUMP_GLOBAL_DISCRIMINATOR)) throw new Error("not a pump Global account");
  const at = (offset: number) => new Reader(data, offset);
  const recipients = at(GLOBAL_BUYBACK_RECIPIENTS);
  return {
    feeBasisPoints: at(GLOBAL_FEE_BPS).u64(),
    creatorFeeBasisPoints: at(GLOBAL_CREATOR_FEE_BPS).u64(),
    buybackFeeRecipients: Array.from({ length: 8 }, () => recipients.pubkey()),
    buybackBasisPoints: at(GLOBAL_BUYBACK_BPS).u64(),
  };
}

// --- Pump Fees FeeConfig -----------------------------------------------------------

export interface Fees {
  lpFeeBps: bigint;
  protocolFeeBps: bigint;
  creatorFeeBps: bigint;
}

export interface FeeTier {
  marketCapLamportsThreshold: bigint;
  fees: Fees;
}

export interface FeeConfig {
  bump: number;
  admin: PublicKey;
  flatFees: Fees;
  feeTiers: FeeTier[];
  stableFeeTiers: FeeTier[];
  exoticFlatFees: Fees;
}

export function decodeFeeConfig(data: Uint8Array): FeeConfig {
  if (!startsWith(data, FEE_CONFIG_DISCRIMINATOR)) throw new Error("not a Pump Fees FeeConfig account");
  const r = new Reader(data, 8);
  const fees = (): Fees => ({ lpFeeBps: r.u64(), protocolFeeBps: r.u64(), creatorFeeBps: r.u64() });
  const tiers = (): FeeTier[] =>
    Array.from({ length: r.u32() }, () => ({ marketCapLamportsThreshold: r.u128(), fees: fees() }));
  return {
    bump: r.u8(),
    admin: r.pubkey(),
    flatFees: fees(),
    feeTiers: tiers(),
    stableFeeTiers: tiers(),
    exoticFlatFees: fees(),
  };
}

// --- SPL mint and token account (same prefix in both token programs) -------------

export interface MintInfo {
  supply: bigint;
  decimals: number;
}

export function decodeMint(data: Uint8Array): MintInfo {
  if (data.length < 82) throw new Error("not a mint account");
  return { supply: new Reader(data, 36).u64(), decimals: data[44] };
}

export function tokenAccountAmount(data: Uint8Array): bigint {
  return new Reader(data, 64).u64();
}

export interface TokenAccount {
  mint: PublicKey;
  owner: PublicKey;
  amount: bigint;
}

/** The first 72 bytes of a token account: mint, owner, amount (both token programs). */
export function decodeTokenAccount(data: Uint8Array): TokenAccount {
  const r = new Reader(data, 0);
  return { mint: r.pubkey(), owner: r.pubkey(), amount: r.u64() };
}

// --- PumpSwap Pool -------------------------------------------------------------------

export interface Pool {
  poolBump: number;
  index: number;
  /** pump's pool authority for the mint when pump created the pool. */
  creator: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  lpMint: PublicKey;
  poolBaseTokenAccount: PublicKey;
  poolQuoteTokenAccount: PublicKey;
  /** Fields below are absent on older, shorter pools; read as zero / false / default. */
  lpSupply: bigint;
  coinCreator: PublicKey;
  isMayhemMode: boolean;
  isCashbackCoin: boolean;
  /** Added to the quote balance to get the price's quote reserve. Can be negative. */
  virtualQuoteReserves: bigint;
  /** Bytes in the account. */
  dataLength: number;
}

/** End of `pool_quote_token_account`: the least `pump_swap.rs` `parse_pool` accepts. */
const POOL_MIN_LEN = 203;
const POOL_VIRTUAL_QUOTE_RESERVES = 245;

/**
 * Reads a PumpSwap `Pool` like `pump_swap.rs` `parse_pool`: `virtual_quote_reserves`
 * counts only when all 16 bytes are present, otherwise it is 0.
 */
export function decodePool(data: Uint8Array): Pool {
  if (!startsWith(data, POOL_DISCRIMINATOR)) throw new Error("not a PumpSwap Pool account");
  if (data.length < POOL_MIN_LEN) throw new Error(`PumpSwap Pool account too short (${data.length} bytes)`);
  const padded = new Uint8Array(Math.max(data.length, POOL_VIRTUAL_QUOTE_RESERVES + 16));
  padded.set(data);
  const r = new Reader(padded, 8);
  const pool = {
    poolBump: r.u8(),
    index: r.u16(),
    creator: r.pubkey(),
    baseMint: r.pubkey(),
    quoteMint: r.pubkey(),
    lpMint: r.pubkey(),
    poolBaseTokenAccount: r.pubkey(),
    poolQuoteTokenAccount: r.pubkey(),
    lpSupply: r.u64(),
    coinCreator: r.pubkey(),
    isMayhemMode: r.bool(),
    isCashbackCoin: r.bool(),
    virtualQuoteReserves: r.i128(),
    dataLength: data.length,
  };
  if (data.length < POOL_VIRTUAL_QUOTE_RESERVES + 16) pool.virtualQuoteReserves = 0n;
  return pool;
}

// --- PumpSwap GlobalConfig (only what the client needs) ------------------------------

export interface AmmGlobalConfig {
  lpFeeBasisPoints: bigint;
  protocolFeeBasisPoints: bigint;
  disableFlags: number;
  coinCreatorFeeBasisPoints: bigint;
  isCashbackEnabled: boolean;
  /** The eight wallets whose wrapped-SOL accounts may receive the buyback fee. */
  buybackFeeRecipients: PublicKey[];
  buybackBasisPoints: bigint;
}

/**
 * Offsets from the `GlobalConfig` field list in docs/pump-arayuz.md E (the
 * buyback basis points offset is the one real_pumpswap.rs T5 reads).
 */
const AMM_LP_FEE_BPS = 40;
const AMM_PROTOCOL_FEE_BPS = 48;
const AMM_DISABLE_FLAGS = 56;
const AMM_COIN_CREATOR_FEE_BPS = 313;
const AMM_IS_CASHBACK_ENABLED = 642;
const AMM_BUYBACK_RECIPIENTS = 643;
const AMM_BUYBACK_BPS = 899;

export function decodeAmmGlobalConfig(data: Uint8Array): AmmGlobalConfig {
  if (!startsWith(data, AMM_GLOBAL_CONFIG_DISCRIMINATOR)) throw new Error("not a PumpSwap GlobalConfig account");
  const at = (offset: number) => new Reader(data, offset);
  const recipients = at(AMM_BUYBACK_RECIPIENTS);
  return {
    lpFeeBasisPoints: at(AMM_LP_FEE_BPS).u64(),
    protocolFeeBasisPoints: at(AMM_PROTOCOL_FEE_BPS).u64(),
    disableFlags: at(AMM_DISABLE_FLAGS).u8(),
    coinCreatorFeeBasisPoints: at(AMM_COIN_CREATOR_FEE_BPS).u64(),
    isCashbackEnabled: at(AMM_IS_CASHBACK_ENABLED).bool(),
    buybackFeeRecipients: Array.from({ length: 8 }, () => recipients.pubkey()),
    buybackBasisPoints: at(AMM_BUYBACK_BPS).u64(),
  };
}
