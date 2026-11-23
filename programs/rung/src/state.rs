use anchor_lang::prelude::*;

use crate::constants::MAX_RUNGS;

/// Where the buy happens.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum Venue {
    /// pump.fun bonding curve.
    Curve,
    /// PumpSwap pool (tokens that graduated from the curve).
    PumpSwap,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum OrderStatus {
    /// A freshly created account, before `open_order` has written to it.
    /// It is the zero value on purpose: empty data can never read as `Open`.
    Uninitialized,
    /// Rungs may be tried.
    Open,
    /// One buy happened. No further buy is possible.
    Filled,
}

/// One order per user. The account is created by `open_order`, closed by
/// `refund` and `cancel`, and kept after a fill so that a late try fails with
/// `OrderFilled` instead of a missing account. The next `open_order` of the
/// same user reuses it.
#[account]
#[derive(InitSpace)]
pub struct Order {
    /// Wallet that opened the order. Tokens and every refund go here.
    pub user: Pubkey,
    /// One-time key generated on the phone for this order. Only it may try rungs.
    pub session_key: Pubkey,
    /// Token being bought.
    pub mint: Pubkey,
    pub venue: Venue,
    pub status: OrderStatus,
    /// Number of rungs in use (1..=5).
    pub rung_count: u8,
    /// Slippage of each rung in basis points, strictly increasing.
    /// The last one in use is the cap.
    pub rungs_bps: [u16; MAX_RUNGS],
    /// Lamports the buy may spend.
    pub amount: u64,
    /// Extra lamports in the vault for the rent of accounts the buy creates.
    pub rent_reserve: u64,
    /// Reference 1: tokens the app quoted for `amount` at the price the user
    /// saw and signed. No buy may be worse than the cap against this.
    pub expected_tokens_seen: u64,
    /// Reference 2: tokens the program quoted for `amount` from the venue
    /// account in the slot the order was opened. Rungs are counted from this.
    pub expected_tokens_start: u64,
    /// Slot in which the order was opened.
    pub start_slot: u64,
    /// Rung `i` is due from `start_slot + i * window_slots`.
    pub window_slots: u64,
    /// The order can be tried while `slot < last_slot`.
    pub last_slot: u64,
    /// Filled orders only: which rung bought, how many tokens, for how much SOL.
    pub filled_rung: u8,
    pub tokens_bought: u64,
    pub lamports_spent: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Order {
    /// The cap: the highest slippage this order accepts.
    pub fn cap_bps(&self) -> u16 {
        self.rungs_bps[self.rung_count as usize - 1]
    }
}
