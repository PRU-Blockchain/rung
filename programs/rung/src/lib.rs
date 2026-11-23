//! Rung: an order program for buying a token on pump.fun with rising
//! slippage rungs.
//!
//! The user signs one transaction (`open_order`). It writes the rules of the
//! order on chain, moves the SOL into a vault the program controls, and names
//! a one-time session key. Only that key may call `try_rung`, and every call
//! is checked against the rules again: the rung must be due, must not be above
//! the cap, the order must not have expired, and it must not have bought yet.
//! The buy itself is a CPI into the pump program with the vault as buyer.
//! Whatever is left always goes back to the user, never anywhere else.

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod math;
pub mod pump_swap;
pub mod state;
pub mod vault;
pub mod venue;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("Ej2bWTwgPULuni3RVS7Krg1cNYrm5Em5WqfMcUVJUhio");

#[program]
pub mod rung {
    use super::*;

    /// The one transaction the user's wallet signs. Opens the order, funds the
    /// vault and hands the session key its fee budget.
    pub fn open_order(ctx: Context<OpenOrder>, args: OpenOrderArgs) -> Result<()> {
        instructions::open_order::handle_open_order(ctx, args)
    }

    /// Session key only. Tries rung `rung_index`; buys at most once per order.
    /// The venue's own accounts are passed as remaining accounts, in the order
    /// the venue's buy instruction expects them.
    pub fn try_rung<'info>(
        ctx: Context<'info, TryRung<'info>>,
        rung_index: u8,
    ) -> Result<()> {
        instructions::try_rung::handle_try_rung(ctx, rung_index)
    }

    /// Returns what is left to the user and closes the order. Anyone may call
    /// it once the order has expired; the session key may call it earlier.
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        instructions::refund::handle_refund(ctx)
    }

    /// User only. Ends an open order at once and returns the SOL.
    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        instructions::cancel::handle_cancel(ctx)
    }
}
