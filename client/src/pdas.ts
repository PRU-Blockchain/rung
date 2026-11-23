import { PublicKey } from "@solana/web3.js";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  BONDING_CURVE_SEED,
  EVENT_AUTHORITY_SEED,
  FEE_CONFIG_SEED,
  GLOBAL_CONFIG_SEED,
  GLOBAL_SEED,
  ORDER_SEED,
  POOL_AUTHORITY_SEED,
  POOL_SEED,
  PUMP_FEES_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  PUMP_SWAP_PROGRAM_ID,
  RUNG_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  USER_VOLUME_ACCUMULATOR_SEED,
  VAULT_SEED,
  WSOL_MINT,
} from "./constants";

const pda = (seeds: Uint8Array[], program: PublicKey) => PublicKey.findProgramAddressSync(seeds, program)[0];

/** Rung: `["order", user]`. */
export const orderPda = (user: PublicKey) => pda([ORDER_SEED, user.toBytes()], RUNG_PROGRAM_ID);
/** Rung: `["vault", user]`, the buyer in pump's eyes. */
export const vaultPda = (user: PublicKey) => pda([VAULT_SEED, user.toBytes()], RUNG_PROGRAM_ID);

/** pump: `["bonding-curve", mint]`. */
export const bondingCurvePda = (mint: PublicKey) => pda([BONDING_CURVE_SEED, mint.toBytes()], PUMP_PROGRAM_ID);
/** pump: `["user_volume_accumulator", buyer]`. */
export const userVolumeAccumulatorPda = (buyer: PublicKey) =>
  pda([USER_VOLUME_ACCUMULATOR_SEED, buyer.toBytes()], PUMP_PROGRAM_ID);
/** pump: `["global"]`. */
export const pumpGlobalPda = () => pda([GLOBAL_SEED], PUMP_PROGRAM_ID);
/** pump: `["__event_authority"]`. */
export const pumpEventAuthorityPda = () => pda([EVENT_AUTHORITY_SEED], PUMP_PROGRAM_ID);
/** Pump Fees: `["fee_config", pump program id]`. */
export const pumpFeeConfigPda = () => pda([FEE_CONFIG_SEED, PUMP_PROGRAM_ID.toBytes()], PUMP_FEES_PROGRAM_ID);

/** Associated token account: `[owner, token_program, mint]` under the ATA program. */
export const associatedTokenAddress = (owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey) =>
  pda([owner.toBytes(), tokenProgram.toBytes(), mint.toBytes()], ASSOCIATED_TOKEN_PROGRAM_ID);
/** `owner`'s wrapped-SOL associated token account (SPL Token). */
export const wsolAta = (owner: PublicKey) => associatedTokenAddress(owner, WSOL_MINT, TOKEN_PROGRAM_ID);

// --- PumpSwap (docs/pump-arayuz.md K1) ---------------------------------------------

/** pump: `["pool-authority", mint]`, the creator of the pool pump's migration opens. */
export const poolAuthorityPda = (mint: PublicKey) => pda([POOL_AUTHORITY_SEED, mint.toBytes()], PUMP_PROGRAM_ID);
/** PumpSwap: `["pool", index u16 LE, creator, base_mint, quote_mint]`. */
export const poolPda = (index: number, creator: PublicKey, baseMint: PublicKey, quoteMint: PublicKey) =>
  pda(
    [POOL_SEED, Uint8Array.of(index & 0xff, index >> 8), creator.toBytes(), baseMint.toBytes(), quoteMint.toBytes()],
    PUMP_SWAP_PROGRAM_ID,
  );
/** The one pool Rung buys from (`pump_swap.rs` `canonical_pool`): index 0, pump's pool authority, quote WSOL. */
export const canonicalPoolPda = (mint: PublicKey) => poolPda(0, poolAuthorityPda(mint), mint, WSOL_MINT);
/** PumpSwap: `["global_config"]`. */
export const ammGlobalConfigPda = () => pda([GLOBAL_CONFIG_SEED], PUMP_SWAP_PROGRAM_ID);
/** PumpSwap: `["__event_authority"]`. */
export const ammEventAuthorityPda = () => pda([EVENT_AUTHORITY_SEED], PUMP_SWAP_PROGRAM_ID);
/** PumpSwap: `["user_volume_accumulator", buyer]`; not the same account as pump's. */
export const ammUserVolumeAccumulatorPda = (buyer: PublicKey) =>
  pda([USER_VOLUME_ACCUMULATOR_SEED, buyer.toBytes()], PUMP_SWAP_PROGRAM_ID);
/** Pump Fees: `["fee_config", PumpSwap program id]`. */
export const ammFeeConfigPda = () => pda([FEE_CONFIG_SEED, PUMP_SWAP_PROGRAM_ID.toBytes()], PUMP_FEES_PROGRAM_ID);
