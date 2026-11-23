use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::{
        self, get_associated_token_address_with_program_id, AssociatedToken, Create,
    },
    token_interface::{self, CloseAccount, Mint, TokenInterface, TransferChecked},
};

use crate::{
    constants::*,
    error::RungError,
    events::OrderFilled,
    math::min_tokens_for_rung,
    state::{Order, OrderStatus},
    vault::sweep_vault_to_user,
    venue::{buy_on_curve, check_curve_buy_accounts, CURVE_BUY_USER_VOLUME_ACCUMULATOR},
};

#[derive(Accounts)]
pub struct TryRung<'info> {
    /// Pays the transaction fee. Must be the session key written in the order.
    #[account(mut)]
    pub session_key: Signer<'info>,

    #[account(
        mut,
        seeds = [ORDER_SEED, user.key().as_ref()],
        bump = order.bump,
        has_one = user @ RungError::AccountMismatch,
        has_one = mint @ RungError::AccountMismatch,
    )]
    pub order: Account<'info, Order>,

    /// The wallet that opened the order. Receives the tokens and the SOL that
    /// is left. It does not sign here.
    #[account(mut)]
    pub user: SystemAccount<'info>,

    #[account(mut, seeds = [VAULT_SEED, user.key().as_ref()], bump = order.vault_bump)]
    pub vault: SystemAccount<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: the user's associated token account for `mint`; the handler
    /// creates it if missing (paid from the vault) and verifies its address.
    #[account(mut)]
    pub user_token_account: UncheckedAccount<'info>,

    /// CHECK: the vault's associated token account for `mint`; created for the
    /// buy and closed again in the same instruction. Address verified in the
    /// handler.
    #[account(mut)]
    pub vault_token_account: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    // Remaining accounts: the venue's buy instruction accounts, in its order.
}

pub fn handle_try_rung(ctx: Context<TryRung>, rung_index: u8) -> Result<()> {
    let order = &ctx.accounts.order;

    // --- The rules. The session key cannot loosen any of them. ---
    require_keys_eq!(
        ctx.accounts.session_key.key(),
        order.session_key,
        RungError::WrongSessionKey
    );
    match order.status {
        OrderStatus::Open => {}
        OrderStatus::Filled => return err!(RungError::OrderFilled),
        OrderStatus::Uninitialized => return err!(RungError::OrderNotOpen),
    }
    require!(rung_index < order.rung_count, RungError::RungAboveCap);
    let slot = Clock::get()?.slot;
    let due_slot = order.start_slot + rung_index as u64 * order.window_slots;
    require!(slot >= due_slot, RungError::RungNotDue);
    require!(slot < order.last_slot, RungError::OrderExpired);

    // --- The accounts the tokens and the SOL pass through. ---
    let user = ctx.accounts.user.key();
    let vault = ctx.accounts.vault.key();
    let mint = ctx.accounts.mint.key();
    let token_program = ctx.accounts.token_program.key();
    require_keys_eq!(
        ctx.accounts.user_token_account.key(),
        get_associated_token_address_with_program_id(&user, &mint, &token_program),
        RungError::AccountMismatch
    );
    require_keys_eq!(
        ctx.accounts.vault_token_account.key(),
        get_associated_token_address_with_program_id(&vault, &mint, &token_program),
        RungError::AccountMismatch
    );
    let buy_accounts = ctx.remaining_accounts;
    check_curve_buy_accounts(
        buy_accounts,
        &mint,
        &token_program,
        &vault,
        &ctx.accounts.vault_token_account.key(),
    )?;

    // --- The fewest tokens this rung may buy: computed here, from the order. ---
    let rung_bps = order.rungs_bps[rung_index as usize];
    let min_tokens_out = min_tokens_for_rung(
        order.expected_tokens_seen,
        order.expected_tokens_start,
        rung_bps,
        order.cap_bps(),
    )?;
    let amount = order.amount;
    let bump = [order.vault_bump];
    let vault_seeds: &[&[u8]] = &[VAULT_SEED, user.as_ref(), &bump];

    // --- Token accounts, paid from the vault's rent reserve. ---
    // The user's account stays (it will hold the tokens). The vault's account
    // only receives the buy and is closed again below.
    for (token_account, owner) in [
        (&ctx.accounts.user_token_account, ctx.accounts.user.to_account_info()),
        (&ctx.accounts.vault_token_account, ctx.accounts.vault.to_account_info()),
    ] {
        associated_token::create_idempotent(CpiContext::new_with_signer(
            ctx.accounts.associated_token_program.key(),
            Create {
                payer: ctx.accounts.vault.to_account_info(),
                associated_token: token_account.to_account_info(),
                authority: owner,
                mint: ctx.accounts.mint.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
            &[vault_seeds],
        ))?;
    }

    // --- The buy. If the price is outside the rung, pump fails the whole
    // transaction: nothing moves and the order stays open. ---
    let accumulator = &buy_accounts[CURVE_BUY_USER_VOLUME_ACCUMULATOR];
    let tokens_before = token_amount(&ctx.accounts.vault_token_account)?;
    let vault_before = ctx.accounts.vault.lamports();
    let accumulator_before = accumulator.lamports();

    buy_on_curve(buy_accounts, amount, min_tokens_out, vault_seeds)?;

    // --- Do not take pump's word for it: measure what arrived. Only the
    // increase counts, so tokens parked in the account beforehand cannot stand
    // in for the buy. ---
    let tokens_after = token_amount(&ctx.accounts.vault_token_account)?;
    let tokens_bought = tokens_after.saturating_sub(tokens_before);
    require!(
        tokens_bought >= min_tokens_out,
        RungError::BoughtLessThanMinimum
    );
    // What the trade itself cost: what left the vault, minus the rent pump
    // took for the buyer's volume account (created on the first buy).
    let accumulator_rent = accumulator.lamports().saturating_sub(accumulator_before);
    let lamports_spent = vault_before
        .saturating_sub(ctx.accounts.vault.lamports())
        .saturating_sub(accumulator_rent);

    // --- Everything to the user: the tokens, then the SOL that is left. ---
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program,
            TransferChecked {
                from: ctx.accounts.vault_token_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            &[vault_seeds],
        ),
        tokens_after,
        ctx.accounts.mint.decimals,
    )?;
    token_interface::close_account(CpiContext::new_with_signer(
        token_program,
        CloseAccount {
            account: ctx.accounts.vault_token_account.to_account_info(),
            destination: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        },
        &[vault_seeds],
    ))?;
    sweep_vault_to_user(
        &ctx.accounts.vault.to_account_info(),
        &ctx.accounts.user.to_account_info(),
        bump[0],
    )?;

    // --- One buy per order. ---
    let order = &mut ctx.accounts.order;
    order.status = OrderStatus::Filled;
    order.filled_rung = rung_index;
    order.tokens_bought = tokens_bought;
    order.lamports_spent = lamports_spent;

    emit!(OrderFilled {
        user: order.user,
        mint: order.mint,
        rung_index,
        rung_bps,
        tokens_bought,
        lamports_spent,
        expected_tokens_seen: order.expected_tokens_seen,
        expected_tokens_start: order.expected_tokens_start,
        slot,
    });
    Ok(())
}

/// Reads the balance of a token account: bytes 64..72 in both token programs.
fn token_amount(token_account: &UncheckedAccount) -> Result<u64> {
    let data = token_account.try_borrow_data()?;
    require!(data.len() >= 72, RungError::AccountMismatch);
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&data[64..72]);
    Ok(u64::from_le_bytes(bytes))
}
