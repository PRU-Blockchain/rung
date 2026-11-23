use anchor_lang::prelude::*;

use crate::{constants::MAX_RUNGS, state::Venue};

#[event]
pub struct OrderOpened {
    pub user: Pubkey,
    pub session_key: Pubkey,
    pub mint: Pubkey,
    pub venue: Venue,
    pub amount: u64,
    pub rung_count: u8,
    pub rungs_bps: [u16; MAX_RUNGS],
    pub expected_tokens_seen: u64,
    pub expected_tokens_start: u64,
    pub start_slot: u64,
    pub window_slots: u64,
    pub last_slot: u64,
}

#[event]
pub struct OrderFilled {
    pub user: Pubkey,
    pub mint: Pubkey,
    /// Index of the rung that bought (0 is the tightest).
    pub rung_index: u8,
    pub rung_bps: u16,
    pub tokens_bought: u64,
    pub lamports_spent: u64,
    /// The two reference quotes, so a reader can compute the price paid
    /// against the price seen without any other data.
    pub expected_tokens_seen: u64,
    pub expected_tokens_start: u64,
    pub slot: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum RefundReason {
    /// Order ran out of time; anyone may trigger this.
    Expired,
    /// The session key gave up after its last rung failed.
    GaveUp,
    /// The user cancelled with their own wallet.
    Cancelled,
}

#[event]
pub struct OrderRefunded {
    pub user: Pubkey,
    pub mint: Pubkey,
    pub reason: RefundReason,
    /// Lamports sent back to the user from the vault.
    pub lamports_returned: u64,
    pub slot: u64,
}
