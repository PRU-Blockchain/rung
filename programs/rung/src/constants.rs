use anchor_lang::prelude::*;

/// Seed of the per-user order account.
#[constant]
pub const ORDER_SEED: &[u8] = b"order";

/// Seed of the per-user vault: a system-owned account with no data that holds
/// the SOL of the open order and that the program signs for.
#[constant]
pub const VAULT_SEED: &[u8] = b"vault";

/// An order has between 1 and 5 rungs.
pub const MAX_RUNGS: usize = 5;

/// 100% in basis points.
pub const BPS_DENOMINATOR: u64 = 10_000;

/// The highest cap an order may set: 30%, the cap of Launch mode. The cap is
/// also the most a sandwich around the buy can take, so it is kept low.
pub const MAX_CAP_BPS: u16 = 3_000;

/// The quote with fees that the client supplies may be at most this far below
/// its fee-free quote: 10%. (Pump's fee was 1.25% in November 2026.) Without
/// this band a faulty client could sign away the protection unnoticed.
pub const MAX_VENUE_FEE_BPS: u64 = 1_000;

/// Most SOL the buy may take from the vault on top of the order amount: the
/// rent of the buyer's volume account that pump creates on a first buy, with
/// some room. Checked after the buy, whatever the called program did.
pub const MAX_BUY_RENT_LAMPORTS: u64 = 2_500_000;

/// Most SOL one order may spend: 0.5 SOL. The program is unaudited; large
/// amounts must not sit in it. Raising this is a team decision.
pub const MAX_ORDER_LAMPORTS: u64 = 500_000_000;

/// Least SOL one order may spend: 0.001 SOL.
pub const MIN_ORDER_LAMPORTS: u64 = 1_000_000;

/// Most SOL the vault may hold on top of the order amount to pay the rent of
/// accounts the buy creates. Everything unspent goes back to the user.
pub const MAX_RENT_RESERVE_LAMPORTS: u64 = 10_000_000;

/// Most SOL an order may hand to the session key for transaction fees.
/// This is all a stolen session key can ever spend.
pub const MAX_FEE_BUDGET_LAMPORTS: u64 = 2_000_000;

/// Slots between two rungs becoming due.
pub const MIN_WINDOW_SLOTS: u64 = 1;
pub const MAX_WINDOW_SLOTS: u64 = 16;

/// How long an order may stay open, in slots (about 64 s at 214 ms per slot).
pub const MAX_LIFETIME_SLOTS: u64 = 300;
