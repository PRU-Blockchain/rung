//! TEST DOUBLE. NEVER DEPLOYED. NOT PUMP'S CODE.
//!
//! An imitation of the interface of PumpSwap's `buy_exact_quote_in_v2` only:
//! the 17 accounts in PumpSwap's order with its writable/signer flags, the
//! instruction discriminator, the argument layout, the `Pool` account layout
//! and the error codes Rung's tests rely on (see `docs/pump-arayuz.md`,
//! sections B2, E, G and K). Rung's tests load it at PumpSwap's address in
//! LiteSVM. Everything it does beyond that interface is an assumption; the
//! real program is exercised by `programs/rung/tests/real_pumpswap.rs`.
//!
//! Behaviour:
//! - reads the `Pool` account (owned by this program) by hand and requires
//!   `base_mint`, `quote_mint` and the two pool token accounts to match it;
//! - rejects cashback pools with 6079 and accepts mayhem pools, as the real
//!   program did in `real_pumpswap.rs` T6;
//! - prices against `pool_base_token_account.amount` and the effective quote
//!   reserves `pool_quote_token_account.amount + Pool.virtual_quote_reserves`,
//!   with one fixed total fee of `FEE_BPS` (see `quote_base_out`);
//! - fails with 6040 if the quote is below `min_base_amount_out`;
//! - creates the buyer's `user_volume_accumulator` (`USER_VOLUME_ACCUMULATOR_LEN`
//!   bytes) if it has no lamports, paid by `user`;
//! - moves `spendable_quote_in` from `user_quote_token_account` to the pool's
//!   quote account (the user signs) and the tokens from the pool's base account
//!   to `user_base_token_account` (the pool PDA signs).
//!
//! Cheat switches (tests only), first data byte of `global_config`:
//! 1 = skip the slippage check and deliver half of the quoted tokens;
//! 2 = deliver honestly but also take `OVERCHARGE_LAMPORTS` from `user`.

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token_interface::{self, Mint, TokenInterface, TransferChecked};

declare_id!("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");

/// Fixed total fee of the double (lp + protocol + creator in one; the buyback
/// share is part of the protocol fee). 120 bps is what the real program
/// charged on the canonical pool of the 2026-11-23 fixture (fee_config tier
/// lp 20 + protocol 5 + creator 95; `real_pumpswap.rs` T5). The real rate
/// depends on the pool's market cap; this is a test choice, not a schedule.
pub const FEE_BPS: u64 = 120;

/// Extra lamports the double takes from the buyer when cheat switch 2 is on.
pub const OVERCHARGE_LAMPORTS: u64 = 2_000_000;

pub const POOL_SEED: &[u8] = b"pool";
pub const GLOBAL_CONFIG_SEED: &[u8] = b"global_config";
pub const USER_VOLUME_ACCUMULATOR_SEED: &[u8] = b"user_volume_accumulator";
pub const EVENT_AUTHORITY_SEED: &[u8] = b"__event_authority";

/// PumpSwap's `Pool` account discriminator (IDL).
pub const POOL_DISCRIMINATOR: [u8; 8] = [241, 154, 109, 4, 17, 177, 109, 188];
/// PumpSwap's `UserVolumeAccumulator` discriminator (IDL).
pub const USER_VOLUME_ACCUMULATOR_DISCRIMINATOR: [u8; 8] = [86, 255, 112, 14, 102, 53, 154, 250];
/// Size the real program gives a new accumulator (measured, real_pumpswap.rs T1).
pub const USER_VOLUME_ACCUMULATOR_LEN: usize = 137;

/// Byte offsets in the `Pool` account (IDL field order, after the discriminator).
pub mod pool_offsets {
    pub const POOL_BUMP: usize = 8;
    pub const INDEX: usize = 9;
    pub const CREATOR: usize = 11;
    pub const BASE_MINT: usize = 43;
    pub const QUOTE_MINT: usize = 75;
    pub const LP_MINT: usize = 107;
    pub const POOL_BASE_TOKEN_ACCOUNT: usize = 139;
    pub const POOL_QUOTE_TOKEN_ACCOUNT: usize = 171;
    pub const LP_SUPPLY: usize = 203;
    pub const COIN_CREATOR: usize = 211;
    pub const IS_MAYHEM_MODE: usize = 243;
    pub const IS_CASHBACK_COIN: usize = 244;
    pub const VIRTUAL_QUOTE_RESERVES: usize = 245;
    pub const CREATOR_FEE_BPS: usize = 261;
    pub const CAN_EDIT_CREATOR_FEE: usize = 269;
    pub const IS_HOLDER_REWARD: usize = 270;
    pub const PROTOCOL_FEES: usize = 271;
    pub const CREATOR_FEES: usize = 279;
    /// Length of the current layout.
    pub const LEN: usize = 287;
}

/// Tokens the double gives for `spendable` quote: the steps the real program
/// follows (`real_pumpswap.rs` T5), with one fee instead of three:
/// 1. `net = floor(spendable * 10_000 / (10_000 + FEE_BPS))`
/// 2. `fee = ceil(net * FEE_BPS / 10_000)`; if `net + fee > spendable`, lower `net` by the excess
/// 3. `out = floor((net - 1) * base_reserve / (quote_reserve + net - 1))`
pub fn quote_base_out(spendable: u64, base_reserve: u64, quote_reserve: u64) -> Option<u64> {
    let s = spendable as u128;
    let mut net = s * 10_000 / (10_000 + FEE_BPS as u128);
    let fee = (net * FEE_BPS as u128).div_ceil(10_000);
    if net + fee > s {
        net -= net + fee - s;
    }
    if net <= 1 {
        return None;
    }
    u64::try_from((net - 1) * base_reserve as u128 / (quote_reserve as u128 + net - 1)).ok()
}

#[program]
pub mod mock_pump_amm {
    use super::*;

    pub fn buy_exact_quote_in_v2(
        ctx: Context<BuyExactQuoteInV2>,
        spendable_quote_in: u64,
        min_base_amount_out: u64,
    ) -> Result<()> {
        let a = &ctx.accounts;
        require!(min_base_amount_out > 0, MockAmmError::ZeroBaseAmount);

        // 1. The pool.
        let (index, creator, pool_bump, virtual_quote) = {
            let d = a.pool.try_borrow_data()?;
            require!(
                d.len() >= pool_offsets::IS_CASHBACK_COIN + 1 && d[..8] == POOL_DISCRIMINATOR,
                ErrorCode::AccountDidNotDeserialize
            );
            let key = |o: usize| Pubkey::new_from_array(d[o..o + 32].try_into().unwrap());
            require_keys_eq!(key(pool_offsets::BASE_MINT), a.base_mint.key(), MockAmmError::InvalidBaseMint);
            require_keys_eq!(key(pool_offsets::QUOTE_MINT), a.quote_mint.key(), MockAmmError::InvalidQuoteMint);
            require_keys_eq!(
                key(pool_offsets::POOL_BASE_TOKEN_ACCOUNT),
                a.pool_base_token_account.key(),
                MockAmmError::InvalidPoolBaseTokenAccount
            );
            require_keys_eq!(
                key(pool_offsets::POOL_QUOTE_TOKEN_ACCOUNT),
                a.pool_quote_token_account.key(),
                MockAmmError::InvalidPoolQuoteTokenAccount
            );
            require!(d[pool_offsets::IS_CASHBACK_COIN] == 0, MockAmmError::CashbackCoinNotSupported);
            let virtual_quote = if d.len() >= pool_offsets::VIRTUAL_QUOTE_RESERVES + 16 {
                i128::from_le_bytes(
                    d[pool_offsets::VIRTUAL_QUOTE_RESERVES..pool_offsets::VIRTUAL_QUOTE_RESERVES + 16]
                        .try_into()
                        .unwrap(),
                )
            } else {
                0
            };
            (
                u16::from_le_bytes([d[pool_offsets::INDEX], d[pool_offsets::INDEX + 1]]),
                key(pool_offsets::CREATOR),
                d[pool_offsets::POOL_BUMP],
                virtual_quote,
            )
        };

        // 2. Reserves and quote.
        let base_reserve = a.pool_base_token_account.amount;
        let quote_reserve = u64::try_from(a.pool_quote_token_account.amount as i128 + virtual_quote)
            .map_err(|_| MockAmmError::Overflow)?;
        let tokens_out = quote_base_out(spendable_quote_in, base_reserve, quote_reserve)
            .ok_or(MockAmmError::ZeroQuoteAmount)?;
        let cheat = a.global_config.try_borrow_data()?.first().copied().unwrap_or(0);
        let delivered = if cheat == 1 {
            tokens_out / 2
        } else {
            require!(
                tokens_out >= min_base_amount_out,
                MockAmmError::BuySlippageBelowMinBaseAmountOut
            );
            tokens_out
        };

        // 3. user_volume_accumulator: created if missing, paid by `user`.
        if a.user_volume_accumulator.lamports() == 0 {
            let user_key = a.user.key();
            let bump = [ctx.bumps.user_volume_accumulator];
            let seeds: &[&[u8]] = &[USER_VOLUME_ACCUMULATOR_SEED, user_key.as_ref(), &bump];
            system_program::create_account(
                CpiContext::new_with_signer(
                    a.system_program.key(),
                    system_program::CreateAccount {
                        from: a.user.to_account_info(),
                        to: a.user_volume_accumulator.to_account_info(),
                    },
                    &[seeds],
                ),
                Rent::get()?.minimum_balance(USER_VOLUME_ACCUMULATOR_LEN),
                USER_VOLUME_ACCUMULATOR_LEN as u64,
                &crate::ID,
            )?;
            let mut data = a.user_volume_accumulator.try_borrow_mut_data()?;
            data[..8].copy_from_slice(&USER_VOLUME_ACCUMULATOR_DISCRIMINATOR);
            data[8..40].copy_from_slice(user_key.as_ref());
        }

        // 4. Quote from the user's (wrapped SOL) account to the pool; the user signs.
        token_interface::transfer_checked(
            CpiContext::new(
                a.quote_token_program.key(),
                TransferChecked {
                    from: a.user_quote_token_account.to_account_info(),
                    mint: a.quote_mint.to_account_info(),
                    to: a.pool_quote_token_account.to_account_info(),
                    authority: a.user.to_account_info(),
                },
            ),
            spendable_quote_in,
            a.quote_mint.decimals,
        )?;

        // Cheat 2 (tests only): take extra lamports from the buyer.
        if cheat == 2 {
            system_program::transfer(
                CpiContext::new(
                    a.system_program.key(),
                    system_program::Transfer {
                        from: a.user.to_account_info(),
                        to: a.pool.to_account_info(),
                    },
                ),
                OVERCHARGE_LAMPORTS,
            )?;
        }

        // 5. Tokens from the pool to the user; the pool PDA signs.
        let base_mint = a.base_mint.key();
        let quote_mint = a.quote_mint.key();
        let index_bytes = index.to_le_bytes();
        let bump = [pool_bump];
        let pool_seeds: &[&[u8]] = &[
            POOL_SEED,
            &index_bytes,
            creator.as_ref(),
            base_mint.as_ref(),
            quote_mint.as_ref(),
            &bump,
        ];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                a.base_token_program.key(),
                TransferChecked {
                    from: a.pool_base_token_account.to_account_info(),
                    mint: a.base_mint.to_account_info(),
                    to: a.user_base_token_account.to_account_info(),
                    authority: a.pool.to_account_info(),
                },
                &[pool_seeds],
            ),
            delivered,
            a.base_mint.decimals,
        )?;
        Ok(())
    }
}

/// The 17 accounts of `buy_exact_quote_in_v2`, in PumpSwap's order and with
/// its writable/signer flags (`docs/pump-arayuz.md` B2). Accounts the double
/// does not use are unchecked.
#[derive(Accounts)]
pub struct BuyExactQuoteInV2<'info> {
    /// CHECK: 0. Parsed by hand; owned by this program.
    #[account(mut, owner = crate::ID)]
    pub pool: UncheckedAccount<'info>,
    /// 1. Transaction signer and trader.
    #[account(mut)]
    pub user: Signer<'info>,
    /// CHECK: 2. Only read for the cheat switches; may not exist.
    #[account(seeds = [GLOBAL_CONFIG_SEED], bump)]
    pub global_config: UncheckedAccount<'info>,
    /// 3.
    pub base_mint: InterfaceAccount<'info, Mint>,
    /// 4.
    pub quote_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: 5. Must exist; the token program checks its mint on transfer.
    #[account(mut)]
    pub user_base_token_account: UncheckedAccount<'info>,
    /// CHECK: 6. Must exist; the token program checks mint and owner on transfer.
    #[account(mut)]
    pub user_quote_token_account: UncheckedAccount<'info>,
    /// 7.
    #[account(mut)]
    pub pool_base_token_account: InterfaceAccount<'info, anchor_spl::token_interface::TokenAccount>,
    /// 8.
    #[account(mut)]
    pub pool_quote_token_account: InterfaceAccount<'info, anchor_spl::token_interface::TokenAccount>,
    /// 9.
    pub base_token_program: Interface<'info, TokenInterface>,
    /// 10.
    pub quote_token_program: Interface<'info, TokenInterface>,
    /// 11.
    pub system_program: Program<'info, System>,
    /// CHECK: 12. Created here if it has no lamports.
    #[account(mut, seeds = [USER_VOLUME_ACCUMULATOR_SEED, user.key().as_ref()], bump)]
    pub user_volume_accumulator: UncheckedAccount<'info>,
    /// CHECK: 13. Unused by the double.
    pub fee_config: UncheckedAccount<'info>,
    /// CHECK: 14. Unused by the double.
    #[account(mut)]
    pub buyback_fee_recipient: UncheckedAccount<'info>,
    /// CHECK: 15. Unused by the double beyond its address.
    #[account(seeds = [EVENT_AUTHORITY_SEED], bump)]
    pub event_authority: UncheckedAccount<'info>,
    /// CHECK: 16. This program.
    #[account(address = crate::ID)]
    pub program: UncheckedAccount<'info>,
}

/// Codes copied from PumpSwap's IDL (`docs/pump-arayuz.md` G). Offset 0 so
/// each variant carries its full code.
#[error_code(offset = 0)]
pub enum MockAmmError {
    ZeroBaseAmount = 6001,
    ZeroQuoteAmount = 6002,
    InvalidBaseMint = 6008,
    InvalidQuoteMint = 6009,
    InvalidPoolBaseTokenAccount = 6014,
    InvalidPoolQuoteTokenAccount = 6015,
    Overflow = 6023,
    #[msg("buy: slippage - would buy less tokens than expected min_base_amount_out")]
    BuySlippageBelowMinBaseAmountOut = 6040,
    #[msg("v2 trades do not support cashback coins; use the v1 instructions")]
    CashbackCoinNotSupported = 6079,
}
