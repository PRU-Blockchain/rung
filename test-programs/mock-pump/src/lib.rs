//! TEST DOUBLE. NEVER DEPLOYED.
//!
//! This is not pump's real code; it is only an imitation of the interface of
//! pump's `buy_exact_quote_in_v3`: the account order and flags, the instruction
//! discriminator, the argument layout and the error codes Rung's tests rely on
//! (see `docs/pump-arayuz.md`, sections A3, A1, E and G). Rung's tests load it
//! at pump's address in LiteSVM. Everything it does beyond that interface is an
//! assumption, to be verified against the real program.
//!
//! Behaviour:
//! - reads the reserves from the `bonding_curve` account (owned by this program);
//! - quotes with the formula from pump's IDL docs and a fixed fee of `FEE_BPS`;
//! - fails with 6042 if the quote is below `min_tokens_out`;
//! - creates the buyer's `user_volume_accumulator` (137 bytes) if it has no
//!   lamports, paid by `user`;
//! - moves `spendable_quote_in` lamports from `user` to the curve and the
//!   tokens from the curve's token account to `associated_base_user`.
//!
//! Cheat switch (tests only): if the first data byte of the `global` account is
//! 1, the slippage check is skipped and only half of the quoted tokens are
//! delivered. This lets the tests check Rung's own after-the-fact check.

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token_interface::{self, Mint, TokenInterface, TransferChecked};

declare_id!("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

/// Fixed total fee of the double. The real fee comes from pump's fee config;
/// this value is only a test choice.
pub const FEE_BPS: u64 = 125;

pub const BONDING_CURVE_SEED: &[u8] = b"bonding-curve";
pub const GLOBAL_SEED: &[u8] = b"global";
pub const USER_VOLUME_ACCUMULATOR_SEED: &[u8] = b"user_volume_accumulator";
pub const EVENT_AUTHORITY_SEED: &[u8] = b"__event_authority";

/// pump's `BondingCurve` account discriminator (IDL).
pub const BONDING_CURVE_DISCRIMINATOR: [u8; 8] = [23, 183, 248, 55, 96, 216, 172, 96];
/// pump's `UserVolumeAccumulator` account discriminator (IDL).
pub const USER_VOLUME_ACCUMULATOR_DISCRIMINATOR: [u8; 8] = [86, 255, 112, 14, 102, 53, 154, 250];
/// "Rent for a 137-byte account if missing" (pump TRADE_V3 docs).
pub const USER_VOLUME_ACCUMULATOR_LEN: usize = 137;

/// Byte offsets in the `BondingCurve` account.
const VIRTUAL_TOKEN_RESERVES: usize = 8;
const VIRTUAL_QUOTE_RESERVES: usize = 16;
const COMPLETE: usize = 8 + 5 * 8;

/// IDL: `OptionBool` is `{"kind":"struct","fields":["bool"]}`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct OptionBool(pub bool);

/// Tokens the double gives for `spendable` lamports (pump IDL formula with a
/// single fee of `FEE_BPS`, steps 1 and 4).
pub fn quote_tokens_out(spendable: u64, virtual_token: u64, virtual_quote: u64) -> Option<u64> {
    let net = (spendable as u128) * 10_000 / (10_000 + FEE_BPS as u128);
    if net <= 1 {
        return None;
    }
    let tokens = (net - 1) * virtual_token as u128 / (virtual_quote as u128 + net - 1);
    u64::try_from(tokens).ok()
}

/// Same as `quote_tokens_out`, also returning the net lamports added to the
/// quote reserve.
fn quote_with_net(spendable: u64, virtual_token: u64, virtual_quote: u64) -> Option<(u64, u64)> {
    let net = (spendable as u128) * 10_000 / (10_000 + FEE_BPS as u128);
    let tokens = quote_tokens_out(spendable, virtual_token, virtual_quote)?;
    Some((tokens, u64::try_from(net).ok()?))
}

#[program]
pub mod mock_pump {
    use super::*;

    pub fn buy_exact_quote_in_v3(
        ctx: Context<BuyExactQuoteInV3>,
        spendable_quote_in: u64,
        min_tokens_out: u64,
        partial_fill: OptionBool,
    ) -> Result<()> {
        // Only meaningful for mayhem coins on the real program; ignored here.
        let _ = partial_fill;
        let accounts = &ctx.accounts;

        // 1. Reserves.
        let (virtual_token, virtual_quote) = {
            let data = accounts.bonding_curve.try_borrow_data()?;
            require!(
                data.len() > COMPLETE && data[..8] == BONDING_CURVE_DISCRIMINATOR,
                ErrorCode::AccountDidNotDeserialize
            );
            require!(data[COMPLETE] == 0, MockPumpError::BondingCurveComplete);
            (read_u64(&data, VIRTUAL_TOKEN_RESERVES), read_u64(&data, VIRTUAL_QUOTE_RESERVES))
        };

        // 2. Quote and slippage check (skipped when the cheat switch is on).
        let (tokens_out, net) = quote_with_net(spendable_quote_in, virtual_token, virtual_quote)
            .ok_or(MockPumpError::BuyZeroAmount)?;
        let cheat = {
            let data = accounts.global.try_borrow_data()?;
            data.first() == Some(&1)
        };
        let delivered = if cheat {
            tokens_out / 2
        } else {
            require!(
                tokens_out >= min_tokens_out,
                MockPumpError::BuySlippageBelowMinTokensOut
            );
            tokens_out
        };

        // 3. user_volume_accumulator: created if missing, paid by `user`.
        if accounts.user_volume_accumulator.lamports() == 0 {
            let user_key = accounts.user.key();
            let bump = [ctx.bumps.user_volume_accumulator];
            let seeds: &[&[u8]] = &[USER_VOLUME_ACCUMULATOR_SEED, user_key.as_ref(), &bump];
            system_program::create_account(
                CpiContext::new_with_signer(
                    accounts.system_program.key(),
                    system_program::CreateAccount {
                        from: accounts.user.to_account_info(),
                        to: accounts.user_volume_accumulator.to_account_info(),
                    },
                    &[seeds],
                ),
                Rent::get()?.minimum_balance(USER_VOLUME_ACCUMULATOR_LEN),
                USER_VOLUME_ACCUMULATOR_LEN as u64,
                &crate::ID,
            )?;
            let mut data = accounts.user_volume_accumulator.try_borrow_mut_data()?;
            data[..8].copy_from_slice(&USER_VOLUME_ACCUMULATOR_DISCRIMINATOR);
            data[8..40].copy_from_slice(user_key.as_ref());
        }

        // 4. SOL from the buyer to the curve.
        system_program::transfer(
            CpiContext::new(
                accounts.system_program.key(),
                system_program::Transfer {
                    from: accounts.user.to_account_info(),
                    to: accounts.bonding_curve.to_account_info(),
                },
            ),
            spendable_quote_in,
        )?;

        // 5. Tokens from the curve to the buyer's token account; the curve PDA signs.
        let mint_key = accounts.base_mint.key();
        let curve_bump = [ctx.bumps.bonding_curve];
        let curve_seeds: &[&[u8]] = &[BONDING_CURVE_SEED, mint_key.as_ref(), &curve_bump];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                accounts.base_token_program.key(),
                TransferChecked {
                    from: accounts.associated_base_bonding_curve.to_account_info(),
                    mint: accounts.base_mint.to_account_info(),
                    to: accounts.associated_base_user.to_account_info(),
                    authority: accounts.bonding_curve.to_account_info(),
                },
                &[curve_seeds],
            ),
            delivered,
            accounts.base_mint.decimals,
        )?;

        // 6. New reserves.
        let mut data = accounts.bonding_curve.try_borrow_mut_data()?;
        let new_token = virtual_token
            .checked_sub(tokens_out)
            .ok_or(MockPumpError::BuyZeroAmount)?;
        let new_quote = virtual_quote
            .checked_add(net)
            .ok_or(MockPumpError::BuyZeroAmount)?;
        data[VIRTUAL_TOKEN_RESERVES..VIRTUAL_TOKEN_RESERVES + 8]
            .copy_from_slice(&new_token.to_le_bytes());
        data[VIRTUAL_QUOTE_RESERVES..VIRTUAL_QUOTE_RESERVES + 8]
            .copy_from_slice(&new_quote.to_le_bytes());
        Ok(())
    }
}

fn read_u64(data: &[u8], offset: usize) -> u64 {
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&data[offset..offset + 8]);
    u64::from_le_bytes(bytes)
}

/// The 17 accounts of `buy_exact_quote_in_v3`, in pump's order and with pump's
/// writable/signer flags (`docs/pump-arayuz.md` A3). Accounts the double does
/// not use are unchecked.
#[derive(Accounts)]
pub struct BuyExactQuoteInV3<'info> {
    /// CHECK: 0. Only read for the cheat switch; may not exist.
    #[account(seeds = [GLOBAL_SEED], bump)]
    pub global: UncheckedAccount<'info>,
    /// 1.
    pub base_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: 2. Unused by the double.
    pub quote_mint: UncheckedAccount<'info>,
    /// 3.
    pub base_token_program: Interface<'info, TokenInterface>,
    /// CHECK: 4. Unused by the double.
    pub quote_token_program: UncheckedAccount<'info>,
    /// CHECK: 5. Parsed by hand; must be this program's curve PDA of `base_mint`.
    #[account(mut, seeds = [BONDING_CURVE_SEED, base_mint.key().as_ref()], bump, owner = crate::ID)]
    pub bonding_curve: UncheckedAccount<'info>,
    /// CHECK: 6. The token program checks mint and authority on transfer.
    #[account(mut)]
    pub associated_base_bonding_curve: UncheckedAccount<'info>,
    /// CHECK: 7. Unused by the double.
    #[account(mut)]
    pub associated_quote_bonding_curve: UncheckedAccount<'info>,
    /// 8. Transaction signer and trader.
    #[account(mut)]
    pub user: Signer<'info>,
    /// CHECK: 9. Must exist; the token program checks its mint on transfer.
    #[account(mut)]
    pub associated_base_user: UncheckedAccount<'info>,
    /// CHECK: 10. Unused by the double.
    #[account(mut)]
    pub associated_quote_user: UncheckedAccount<'info>,
    /// CHECK: 11. Created here if it has no lamports.
    #[account(mut, seeds = [USER_VOLUME_ACCUMULATOR_SEED, user.key().as_ref()], bump)]
    pub user_volume_accumulator: UncheckedAccount<'info>,
    /// CHECK: 12. Unused by the double.
    pub fee_config: UncheckedAccount<'info>,
    /// CHECK: 13. Unused by the double.
    #[account(mut)]
    pub buyback_fee_recipient: UncheckedAccount<'info>,
    /// 14.
    pub system_program: Program<'info, System>,
    /// CHECK: 15. Unused by the double beyond its address.
    #[account(seeds = [EVENT_AUTHORITY_SEED], bump)]
    pub event_authority: UncheckedAccount<'info>,
    /// CHECK: 16. This program.
    #[account(address = crate::ID)]
    pub program: UncheckedAccount<'info>,
}

/// Codes copied from pump's IDL (`docs/pump-arayuz.md` G). Offset 0 so each
/// variant carries its full code.
#[error_code(offset = 0)]
pub enum MockPumpError {
    #[msg("The bonding curve has completed and liquidity migrated to raydium.")]
    BondingCurveComplete = 6005,
    #[msg("Buy zero amount")]
    BuyZeroAmount = 6020,
    #[msg("Slippage: Would buy less tokens than expected min_tokens_out")]
    BuySlippageBelowMinTokensOut = 6042,
}
