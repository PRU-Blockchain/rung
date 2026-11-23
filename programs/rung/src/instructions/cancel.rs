use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::RungError,
    events::{OrderRefunded, RefundReason},
    state::{Order, OrderStatus},
    vault::sweep_vault_to_user,
};

#[derive(Accounts)]
pub struct Cancel<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    /// Closed here; its rent goes to the user.
    #[account(
        mut,
        close = user,
        seeds = [ORDER_SEED, user.key().as_ref()],
        bump = order.bump,
        has_one = user @ RungError::WrongUser,
    )]
    pub order: Account<'info, Order>,

    #[account(mut, seeds = [VAULT_SEED, user.key().as_ref()], bump = order.vault_bump)]
    pub vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_cancel(ctx: Context<Cancel>) -> Result<()> {
    let order = &ctx.accounts.order;
    require!(order.status == OrderStatus::Open, RungError::OrderNotOpen);

    let lamports_returned = sweep_vault_to_user(
        &ctx.accounts.vault.to_account_info(),
        &ctx.accounts.user.to_account_info(),
        order.vault_bump,
    )?;
    emit!(OrderRefunded {
        user: order.user,
        mint: order.mint,
        reason: RefundReason::Cancelled,
        lamports_returned,
        slot: Clock::get()?.slot,
    });
    // `close = user` on the order account returns its rent to the user.
    Ok(())
}
