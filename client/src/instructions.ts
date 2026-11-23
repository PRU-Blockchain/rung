// Rung's four instructions, pump's and PumpSwap's 17 buy accounts, wrapped
// SOL, and compute budget. Account order and flags follow target/idl/rung.json;
// tests compare the bytes and metas with the Rust builders in
// programs/rung/tests/common.

import { AccountMeta, ComputeBudgetProgram, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

import { concat, toBuffer, u64, u8, vecU16 } from "./bytes";
import {
  AMM_FEE_CONFIG,
  AMM_GLOBAL_CONFIG,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  PUMP_IX,
  PUMP_PROGRAM_ID,
  PUMP_SWAP_IX,
  PUMP_SWAP_PROGRAM_ID,
  RUNG_IX,
  RUNG_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  VENUES,
  WSOL_MINT,
  type Venue,
} from "./constants";
import {
  ammEventAuthorityPda,
  ammUserVolumeAccumulatorPda,
  associatedTokenAddress,
  bondingCurvePda,
  canonicalPoolPda,
  orderPda,
  pumpEventAuthorityPda,
  pumpFeeConfigPda,
  pumpGlobalPda,
  userVolumeAccumulatorPda,
  vaultPda,
  wsolAta,
} from "./pdas";

const w = (pubkey: PublicKey, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable: true });
const r = (pubkey: PublicKey, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable: false });

function ix(programId: PublicKey, keys: AccountMeta[], data: Uint8Array): TransactionInstruction {
  return new TransactionInstruction({ programId, keys, data: toBuffer(data) });
}

/** A PumpSwap pool and its two token accounts, as written in the `Pool` account. */
export interface PoolAccounts {
  address: PublicKey;
  baseTokenAccount: PublicKey;
  quoteTokenAccount: PublicKey;
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
  const venue = VENUES.indexOf(a.venue);
  if (venue < 0) throw new Error(`unknown venue ${a.venue}`);
  return concat(
    u8(venue),
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

/**
 * `open_order`. The venue account is the bonding curve for `Curve`, the
 * canonical pool for `PumpSwap`; a PumpSwap order also passes the pool's base
 * and quote token accounts (read-only remaining accounts, in that order).
 */
export function openOrderIx(p: {
  user: PublicKey;
  sessionKey: PublicKey;
  mint: PublicKey;
  args: OpenOrderArgs;
  /** Required when `args.venue` is `PumpSwap`. */
  pool?: PoolAccounts;
}): TransactionInstruction {
  const keys = [
    w(p.user, true),
    w(p.sessionKey),
    r(p.mint),
    w(orderPda(p.user)),
    w(vaultPda(p.user)),
  ];
  if (p.args.venue === "PumpSwap") {
    const pool = requirePool(p.mint, p.pool);
    keys.push(r(pool.address), r(SYSTEM_PROGRAM_ID), r(pool.baseTokenAccount), r(pool.quoteTokenAccount));
  } else {
    keys.push(r(bondingCurvePda(p.mint)), r(SYSTEM_PROGRAM_ID));
  }
  return ix(RUNG_PROGRAM_ID, keys, concat(Uint8Array.from(RUNG_IX.openOrder), encodeOpenOrderArgs(p.args)));
}

function requirePool(mint: PublicKey, pool: PoolAccounts | undefined): PoolAccounts {
  if (!pool) throw new Error("a PumpSwap order needs the pool's accounts");
  if (!pool.address.equals(canonicalPoolPda(mint))) throw new Error("pool is not the canonical PumpSwap pool of this mint");
  return pool;
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

// --- PumpSwap buy_exact_quote_in_v2 accounts (docs/pump-arayuz.md B2, K2) ------------

/**
 * The 17 accounts of PumpSwap's `buy_exact_quote_in_v2` for `buyer`, whose
 * base and wrapped-SOL accounts are its associated token accounts.
 * `buybackWsolAccount` is the wrapped-SOL account of one of the eight wallets
 * in `GlobalConfig.buyback_fee_recipients`; it must exist (6027 otherwise),
 * and an unlisted wallet's account fails with 6053 (real_pumpswap.rs T8).
 */
export function pumpSwapBuyAccounts(p: {
  buyer: PublicKey;
  mint: PublicKey;
  tokenProgram: PublicKey;
  pool: PoolAccounts;
  buybackWsolAccount: PublicKey;
  buyerSigns: boolean;
}): AccountMeta[] {
  return [
    w(p.pool.address), // 0 pool
    w(p.buyer, p.buyerSigns), // 1 user
    r(AMM_GLOBAL_CONFIG), // 2 global_config
    r(p.mint), // 3 base_mint
    r(WSOL_MINT), // 4 quote_mint
    w(associatedTokenAddress(p.buyer, p.mint, p.tokenProgram)), // 5 user_base_token_account
    w(wsolAta(p.buyer)), // 6 user_quote_token_account
    w(p.pool.baseTokenAccount), // 7 pool_base_token_account
    w(p.pool.quoteTokenAccount), // 8 pool_quote_token_account
    r(p.tokenProgram), // 9 base_token_program
    r(TOKEN_PROGRAM_ID), // 10 quote_token_program
    r(SYSTEM_PROGRAM_ID), // 11 system_program
    w(ammUserVolumeAccumulatorPda(p.buyer)), // 12 user_volume_accumulator
    r(AMM_FEE_CONFIG), // 13 fee_config
    w(p.buybackWsolAccount), // 14 buyback_fee_recipient
    r(ammEventAuthorityPda()), // 15 event_authority
    r(PUMP_SWAP_PROGRAM_ID), // 16 program
  ];
}

/**
 * A direct PumpSwap buy: spend `spendable` of the buyer's wrapped SOL, receive
 * at least `minTokensOut`. Both of the buyer's token accounts must exist.
 */
export function pumpSwapBuyExactQuoteInV2Ix(p: {
  buyer: PublicKey;
  mint: PublicKey;
  tokenProgram: PublicKey;
  pool: PoolAccounts;
  buybackWsolAccount: PublicKey;
  spendable: bigint;
  minTokensOut: bigint;
}): TransactionInstruction {
  return ix(
    PUMP_SWAP_PROGRAM_ID,
    pumpSwapBuyAccounts({ ...p, buyerSigns: true }),
    concat(Uint8Array.from(PUMP_SWAP_IX.buyExactQuoteInV2), u64(p.spendable), u64(p.minTokensOut)),
  );
}

// --- token accounts and wrapped SOL ---------------------------------------------------

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

/** SPL Token `SyncNative` (tag 17). */
export const syncNativeIx = (account: PublicKey) => ix(TOKEN_PROGRAM_ID, [w(account)], Uint8Array.of(17));

/** Token `CloseAccount` (tag 9): lamports to `destination`, signed by `owner`. */
export const closeTokenAccountIx = (p: {
  account: PublicKey;
  destination: PublicKey;
  owner: PublicKey;
  tokenProgram: PublicKey;
}) => ix(p.tokenProgram, [w(p.account), w(p.destination), r(p.owner, true)], Uint8Array.of(9));

/** Wraps `lamports` into `owner`'s wrapped-SOL ATA (created if missing). */
export function wrapSolIxs(owner: PublicKey, lamports: bigint): TransactionInstruction[] {
  const account = wsolAta(owner);
  return [
    createAtaIdempotentIx({ payer: owner, owner, mint: WSOL_MINT, tokenProgram: TOKEN_PROGRAM_ID }),
    SystemProgram.transfer({ fromPubkey: owner, toPubkey: account, lamports }),
    syncNativeIx(account),
  ];
}

// --- try_rung -----------------------------------------------------------------------

/**
 * `try_rung`. The remaining accounts are the venue's 17 buy accounts with the
 * vault as the buyer (it signs inside the program, not in the transaction).
 * `buybackRecipient`: for `Curve`, one of pump's eight buyback wallets; for
 * `PumpSwap`, the wrapped-SOL account of one of PumpSwap's eight (see
 * `findBuybackWsolAccounts`).
 */
export function tryRungIx(p: {
  sessionKey: PublicKey;
  user: PublicKey;
  mint: PublicKey;
  tokenProgram: PublicKey;
  buybackRecipient: PublicKey;
  rungIndex: number;
  /** The order's venue; `Curve` when omitted. */
  venue?: Venue;
  /** Required for `PumpSwap`. */
  pool?: PoolAccounts;
}): TransactionInstruction {
  const vault = vaultPda(p.user);
  const buy =
    p.venue === "PumpSwap"
      ? pumpSwapBuyAccounts({
          buyer: vault,
          mint: p.mint,
          tokenProgram: p.tokenProgram,
          pool: requirePool(p.mint, p.pool),
          buybackWsolAccount: p.buybackRecipient,
          buyerSigns: false,
        })
      : pumpBuyAccounts({
          buyer: vault,
          mint: p.mint,
          tokenProgram: p.tokenProgram,
          buybackRecipient: p.buybackRecipient,
          buyerSigns: false,
        });
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
      ...buy,
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
