import { PublicKey, SystemProgram } from "@solana/web3.js";

// --- Program ids ---------------------------------------------------------

export const RUNG_PROGRAM_ID = new PublicKey("Ej2bWTwgPULuni3RVS7Krg1cNYrm5Em5WqfMcUVJUhio");
export const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
export const PUMP_FEES_PROGRAM_ID = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
export const SYSTEM_PROGRAM_ID = SystemProgram.programId;
export const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey("ComputeBudget111111111111111111111111111111");
/** PumpSwap, pump.fun's AMM (programs/rung/src/pump_swap.rs). */
export const PUMP_SWAP_PROGRAM_ID = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
/** PumpSwap `GlobalConfig`, `["global_config"]` (docs/pump-arayuz.md 0, K1). */
export const AMM_GLOBAL_CONFIG = new PublicKey("ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw");
/** Pump Fees `fee_config` of PumpSwap, `["fee_config", PumpSwap id]` (docs/pump-arayuz.md 0, K1). */
export const AMM_FEE_CONFIG = new PublicKey("5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx");

// --- Venues -----------------------------------------------------------------

/** Where an order buys: pump's bonding curve, or the token's canonical PumpSwap pool. Borsh index = position. */
export type Venue = "Curve" | "PumpSwap";
export const VENUES: readonly Venue[] = ["Curve", "PumpSwap"];

// --- Seeds ----------------------------------------------------------------

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

export const ORDER_SEED = ascii("order");
export const VAULT_SEED = ascii("vault");
export const BONDING_CURVE_SEED = ascii("bonding-curve");
export const GLOBAL_SEED = ascii("global");
export const EVENT_AUTHORITY_SEED = ascii("__event_authority");
export const USER_VOLUME_ACCUMULATOR_SEED = ascii("user_volume_accumulator");
export const FEE_CONFIG_SEED = ascii("fee_config");
export const POOL_SEED = ascii("pool");
export const POOL_AUTHORITY_SEED = ascii("pool-authority");
export const GLOBAL_CONFIG_SEED = ascii("global_config");

// --- Limits (programs/rung/src/constants.rs; a test compares them) -----------

export const MAX_RUNGS = 5;
export const BPS_DENOMINATOR = 10_000n;
export const MAX_CAP_BPS = 3_000;
export const MAX_VENUE_FEE_BPS = 1_000n;
export const MAX_BUY_RENT_LAMPORTS = 2_500_000n;
export const MAX_ORDER_LAMPORTS = 500_000_000n;
export const MIN_ORDER_LAMPORTS = 1_000_000n;
export const MAX_RENT_RESERVE_LAMPORTS = 10_000_000n;
export const MAX_FEE_BUDGET_LAMPORTS = 2_000_000n;
export const MIN_WINDOW_SLOTS = 1n;
export const MAX_WINDOW_SLOTS = 16n;
export const MAX_LIFETIME_SLOTS = 300n;

// --- Modes ------------------------------------------------------------------

/** Rung slippages in basis points. The last rung is the cap. */
export const MODES = {
  tight: [100, 200, 300],
  normal: [200, 300, 500],
  fast: [500, 1000, 1500],
  launch: [1000, 2000, 3000],
} as const satisfies Record<string, readonly number[]>;

export type PresetMode = keyof typeof MODES;
/** `custom` takes its rungs from the user. */
export type Mode = PresetMode | "custom";

// --- Discriminators ---------------------------------------------------------

export const RUNG_IX = {
  openOrder: [206, 88, 88, 143, 38, 136, 50, 224],
  tryRung: [140, 95, 252, 49, 172, 11, 13, 236],
  refund: [2, 96, 183, 251, 63, 208, 46, 46],
  cancel: [232, 219, 223, 41, 219, 236, 220, 190],
} as const;

export const ORDER_DISCRIMINATOR = [134, 173, 223, 185, 77, 86, 28, 51] as const;

export const RUNG_EVENT = {
  OrderOpened: [2, 254, 197, 24, 41, 166, 225, 56],
  OrderFilled: [120, 124, 109, 66, 249, 116, 174, 30],
  OrderRefunded: [120, 155, 10, 169, 7, 98, 202, 187],
} as const;

export const PUMP_IX = {
  buyExactQuoteInV3: [225, 247, 80, 30, 213, 179, 132, 136],
  buyV3: [7, 5, 29, 196, 245, 23, 101, 80],
  buyExactQuoteInV2: [194, 171, 28, 70, 104, 77, 91, 47],
  buyV2: [184, 23, 238, 97, 103, 197, 211, 61],
  buyExactSolIn: [56, 252, 116, 8, 158, 223, 205, 95],
  buy: [102, 6, 61, 18, 1, 218, 235, 234],
} as const;

export const BONDING_CURVE_DISCRIMINATOR = [23, 183, 248, 55, 96, 216, 172, 96] as const;
export const PUMP_GLOBAL_DISCRIMINATOR = [167, 232, 232, 177, 200, 108, 114, 127] as const;
export const FEE_CONFIG_DISCRIMINATOR = [143, 52, 146, 187, 219, 123, 76, 155] as const;

/** PumpSwap's buy (idl/pump_amm.json; same bytes as pump's, told apart by the program id). */
export const PUMP_SWAP_IX = {
  buyExactQuoteInV2: [194, 171, 28, 70, 104, 77, 91, 47],
} as const;
export const POOL_DISCRIMINATOR = [241, 154, 109, 4, 17, 177, 109, 188] as const;
export const AMM_GLOBAL_CONFIG_DISCRIMINATOR = [149, 8, 156, 202, 160, 252, 176, 217] as const;

// --- Account sizes ------------------------------------------------------------

/** 8-byte discriminator + `Order::INIT_SPACE`. */
export const ORDER_ACCOUNT_LEN = 192;
/** pump's `UserVolumeAccumulator`, created on a buyer's first buy. */
export const USER_VOLUME_ACCUMULATOR_LEN = 137;
export const SPL_TOKEN_ACCOUNT_LEN = 165;
/** Token-2022 account with the ImmutableOwner extension the ATA program adds. */
export const TOKEN_2022_ACCOUNT_LEN = 170;

/** PumpSwap's `UserVolumeAccumulator`: 137 bytes as well (real_pumpswap.rs T1). */
export const AMM_USER_VOLUME_ACCUMULATOR_LEN = 137;

/** pump's slippage error `BuySlippageBelowMinTokensOut`. */
export const PUMP_SLIPPAGE_ERROR = 6042;
/** PumpSwap's slippage error `BuySlippageBelowMinBaseAmountOut`. Not the same code as pump's. */
export const PUMP_SWAP_SLIPPAGE_ERROR = 6040;

/** Lamports per signature, the base transaction fee. */
export const LAMPORTS_PER_SIGNATURE = 5_000n;
