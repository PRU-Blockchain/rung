// Rung's four instructions, pump's 17 buy accounts, and compute budget.
// Account order and flags follow target/idl/rung.json; tests compare the
// bytes and metas with the Rust builders in programs/rung/tests/common.

import { AccountMeta, ComputeBudgetProgram, PublicKey, TransactionInstruction } from "@solana/web3.js";

import type { Venue } from "./accounts";
import { VENUES } from "./accounts";
import { concat, toBuffer, u64, u8, vecU16 } from "./bytes";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  PUMP_IX,
  PUMP_PROGRAM_ID,
  RUNG_IX,
  RUNG_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  WSOL_MINT,
} from "./constants";
import {
  associatedTokenAddress,
  bondingCurvePda,
  orderPda,
  pumpEventAuthorityPda,
  pumpFeeConfigPda,
  pumpGlobalPda,
  userVolumeAccumulatorPda,
  vaultPda,
} from "./pdas";

const w = (pubkey: PublicKey, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable: true });
const r = (pubkey: PublicKey, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable: false });

function ix(programId: PublicKey, keys: AccountMeta[], data: Uint8Array): TransactionInstruction {
  return new TransactionInstruction({ programId, keys, data: toBuffer(data) });
}

// --- open_order -----------------------------------------------------------------

export interface OpenOrderArgs {
  venue: Venue;
  rungsBps: number[];
  amount: bigint;
  rentReserve: bigint;
  feeBudget: bigint;
  expectedTokensSeen: bigint;
  rawTokensSeen: bigint;
  windowSlots: bigint;
  lifetimeSlots: bigint;
}

/** Borsh `OpenOrderArgs`, in the struct's field order. */
export function encodeOpenOrderArgs(a: OpenOrderArgs): Uint8Array {
  return concat(
    u8(VENUES.indexOf(a.venue)),
    vecU16(a.rungsBps),
    u64(a.amount),
    u64(a.rentReserve),
    u64(a.feeBudget),
    u64(a.expectedTokensSeen),
    u64(a.rawTokensSeen),
    u64(a.windowSlots),
    u64(a.lifetimeSlots),
  );
}

export function openOrderIx(p: {
  user: PublicKey;
  sessionKey: PublicKey;
  mint: PublicKey;
  args: OpenOrderArgs;
}): TransactionInstruction {
  return ix(
    RUNG_PROGRAM_ID,
    [
      w(p.user, true),
      w(p.sessionKey),
      r(p.mint),
      w(orderPda(p.user)),
      w(vaultPda(p.user)),
      r(bondingCurvePda(p.mint)), // venue_state
      r(SYSTEM_PROGRAM_ID),
    ],
    concat(Uint8Array.from(RUNG_IX.openOrder), encodeOpenOrderArgs(p.args)),
  );
}

// --- pump buy_exact_quote_in_v3 accounts (docs/pump-arayuz.md A3) --------------------

/**
 * The 17 accounts of pump's `buy_exact_quote_in_v3` / `buy_v3` for `buyer`
 * buying `mint` on a SOL-paired curve. `buybackRecipient` is one of the eight
 * in pump's `Global.buyback_fee_recipients`.
 */
export function pumpBuyAccounts(p: {
  buyer: PublicKey;
  mint: PublicKey;
  tokenProgram: PublicKey;
  buybackRecipient: PublicKey;
  buyerSigns: boolean;
}): AccountMeta[] {
  const curve = bondingCurvePda(p.mint);
  return [
    r(pumpGlobalPda()), // 0 global
    r(p.mint), // 1 base_mint
    r(WSOL_MINT), // 2 quote_mint
    r(p.tokenProgram), // 3 base_token_program
    r(TOKEN_PROGRAM_ID), // 4 quote_token_program
    w(curve), // 5 bonding_curve
    w(associatedTokenAddress(curve, p.mint, p.tokenProgram)), // 6 associated_base_bonding_curve
    w(associatedTokenAddress(curve, WSOL_MINT, TOKEN_PROGRAM_ID)), // 7 associated_quote_bonding_curve
    w(p.buyer, p.buyerSigns), // 8 user
    w(associatedTokenAddress(p.buyer, p.mint, p.tokenProgram)), // 9 associated_base_user
    w(associatedTokenAddress(p.buyer, WSOL_MINT, TOKEN_PROGRAM_ID)), // 10 associated_quote_user
    w(userVolumeAccumulatorPda(p.buyer)), // 11 user_volume_accumulator
    r(pumpFeeConfigPda()), // 12 fee_config
    w(p.buybackRecipient), // 13 buyback_fee_recipient
    r(SYSTEM_PROGRAM_ID), // 14 system_program
    r(pumpEventAuthorityPda()), // 15 event_authority
    r(PUMP_PROGRAM_ID), // 16 program
  ];
}

/** A direct pump buy (used for simulation): spend `spendable`, receive at least `minTokensOut`. */
export function pumpBuyExactQuoteInV3Ix(p: {
  buyer: PublicKey;
  mint: PublicKey;
  tokenProgram: PublicKey;
  buybackRecipient: PublicKey;
  spendable: bigint;
  minTokensOut: bigint;
}): TransactionInstruction {
  return ix(
    PUMP_PROGRAM_ID,
    pumpBuyAccounts({ ...p, buyerSigns: true }),
    concat(Uint8Array.from(PUMP_IX.buyExactQuoteInV3), u64(p.spendable), u64(p.minTokensOut), u8(0)),
  );
}

/** Associated Token Program `CreateIdempotent`. */
export function createAtaIdempotentIx(p: {
  payer: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
  tokenProgram: PublicKey;
}): TransactionInstruction {
  return ix(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    [
      w(p.payer, true),
      w(associatedTokenAddress(p.owner, p.mint, p.tokenProgram)),
      r(p.owner),
      r(p.mint),
      r(SYSTEM_PROGRAM_ID),
      r(p.tokenProgram),
    ],
    Uint8Array.of(1),
  );
}

// --- try_rung -----------------------------------------------------------------------

export function tryRungIx(p: {
  sessionKey: PublicKey;
  user: PublicKey;
  mint: PublicKey;
  tokenProgram: PublicKey;
  buybackRecipient: PublicKey;
  rungIndex: number;
}): TransactionInstruction {
  const vault = vaultPda(p.user);
  return ix(
    RUNG_PROGRAM_ID,
    [
      w(p.sessionKey, true),
      w(orderPda(p.user)),
      w(p.user),
      w(vault),
      r(p.mint),
      w(associatedTokenAddress(p.user, p.mint, p.tokenProgram)), // user_token_account
      w(associatedTokenAddress(vault, p.mint, p.tokenProgram)), // vault_token_account
      r(p.tokenProgram),
      r(ASSOCIATED_TOKEN_PROGRAM_ID),
      r(SYSTEM_PROGRAM_ID),
      // Remaining accounts: pump's buy, with the vault as the buyer. The vault
      // signs inside the program (invoke_signed), not in the transaction.
      ...pumpBuyAccounts({
        buyer: vault,
        mint: p.mint,
        tokenProgram: p.tokenProgram,
        buybackRecipient: p.buybackRecipient,
        buyerSigns: false,
      }),
    ],
    concat(Uint8Array.from(RUNG_IX.tryRung), u8(p.rungIndex)),
  );
}

// --- refund / cancel --------------------------------------------------------------------

/** Anyone after expiry; the session key at any time. SOL always goes to `user`. */
export function refundIx(p: { caller: PublicKey; user: PublicKey }): TransactionInstruction {
  return ix(
    RUNG_PROGRAM_ID,
    [r(p.caller, true), w(orderPda(p.user)), w(p.user), w(vaultPda(p.user)), r(SYSTEM_PROGRAM_ID)],
    Uint8Array.from(RUNG_IX.refund),
  );
}

/** User only: ends an open order and returns the SOL. */
export function cancelIx(p: { user: PublicKey }): TransactionInstruction {
  return ix(
    RUNG_PROGRAM_ID,
    [w(p.user, true), w(orderPda(p.user)), w(vaultPda(p.user)), r(SYSTEM_PROGRAM_ID)],
    Uint8Array.from(RUNG_IX.cancel),
  );
}

// --- compute budget ----------------------------------------------------------------------

export const computeUnitLimitIx = (units: number) => ComputeBudgetProgram.setComputeUnitLimit({ units });

export const computeUnitPriceIx = (microLamports: bigint) =>
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports });
