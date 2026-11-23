use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::RungError,
    events::{OrderRefunded, RefundReason},
    state::{Order, OrderStatus},
    vault::sweep_vault_to_user,
};

#[derive(Accounts)]
pub struct Refund<'info> {
    /// Anyone. The handler decides what this caller may do.
    pub caller: Signer<'info>,

    /// Closed here; its rent goes to the user.
    #[account(
        mut,
        close = user,
        seeds = [ORDER_SEED, user.key().as_ref()],
        bump = order.bump,
        has_one = user @ RungError::AccountMismatch,
    )]
    pub order: Account<'info, Order>,

    /// The only place SOL can go.
    #[account(mut)]
    pub user: SystemAccount<'info>,

    #[account(mut, seeds = [VAULT_SEED, user.key().as_ref()], bump = order.vault_bump)]
    pub vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_refund(ctx: Context<Refund>) -> Result<()> {
    let order = &ctx.accounts.order;
    let slot = Clock::get()?.slot;
    let expired = slot >= order.last_slot;

    match order.status {
        OrderStatus::Open => {
            // Before expiry only the session key may give up. It gains nothing:
            // the SOL goes to the user either way.
            let by_session_key = ctx.accounts.caller.key() == order.session_key;
            require!(expired || by_session_key, RungError::OrderNotExpired);

            let lamports_returned = sweep_vault_to_user(
                &ctx.accounts.vault.to_account_info(),
                &ctx.accounts.user.to_account_info(),
                order.vault_bump,
            )?;
            emit!(OrderRefunded {
                user: order.user,
                mint: order.mint,
                reason: if expired {
                    RefundReason::Expired
                } else {
                    RefundReason::GaveUp
                },
                lamports_returned,
                slot,
            });
        }
        OrderStatus::Filled => {
            // Nothing to refund: the order bought. After expiry anyone may
            // close the record so that its rent returns to the user.
            require!(expired, RungError::OrderNotExpired);
            sweep_vault_to_user(
                &ctx.accounts.vault.to_account_info(),
                &ctx.accounts.user.to_account_info(),
                order.vault_bump,
            )?;
        }
        OrderStatus::Uninitialized => return err!(RungError::OrderNotOpen),
    }
    // `close = user` on the order account returns its rent to the user.
    Ok(())
}
