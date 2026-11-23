import { PublicKey } from "@solana/web3.js";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  BONDING_CURVE_SEED,
  EVENT_AUTHORITY_SEED,
  FEE_CONFIG_SEED,
  GLOBAL_SEED,
  ORDER_SEED,
  PUMP_FEES_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  RUNG_PROGRAM_ID,
  USER_VOLUME_ACCUMULATOR_SEED,
  VAULT_SEED,
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
