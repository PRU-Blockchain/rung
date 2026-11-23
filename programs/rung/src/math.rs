//! Rung arithmetic. Pure functions, no accounts.

use anchor_lang::prelude::*;

use crate::{constants::BPS_DENOMINATOR, error::RungError};

/// Fewest tokens a buy may return to be at most `slippage_bps` above a quote.
///
/// Paying `s` above a price means receiving `expected / (1 + s)` tokens for
/// the same SOL. Rounded up, so the limit is never looser than `slippage_bps`.
pub fn min_tokens_at(expected_tokens: u64, slippage_bps: u16) -> Result<u64> {
    let numerator = (expected_tokens as u128)
        .checked_mul(BPS_DENOMINATOR as u128)
        .ok_or(RungError::MathOverflow)?;
    let denominator = (BPS_DENOMINATOR as u128)
        .checked_add(slippage_bps as u128)
        .ok_or(RungError::MathOverflow)?;
    let rounded_up = numerator
        .checked_add(denominator - 1)
        .ok_or(RungError::MathOverflow)?
        / denominator;
    u64::try_from(rounded_up).map_err(|_| RungError::MathOverflow.into())
}

/// Fewest tokens rung `rung_bps` may buy: the stricter of two references.
///
/// 1. The absolute cap: never worse than `cap_bps` above the price the user saw.
/// 2. The ladder: `rung_bps` above the price the program read when the order
///    was opened.
pub fn min_tokens_for_rung(
    expected_tokens_seen: u64,
    expected_tokens_start: u64,
    rung_bps: u16,
    cap_bps: u16,
) -> Result<u64> {
    let cap_floor = min_tokens_at(expected_tokens_seen, cap_bps)?;
    let rung_floor = min_tokens_at(expected_tokens_start, rung_bps)?;
    Ok(cap_floor.max(rung_floor))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_percent_above_the_quote() {
        // 1,000,000 tokens expected, 1% slippage: 1,000,000 / 1.01 = 990,099.0099 -> 990,100.
        assert_eq!(min_tokens_at(1_000_000, 100).unwrap(), 990_100);
    }

    #[test]
    fn zero_slippage_keeps_the_quote() {
        assert_eq!(min_tokens_at(123_456_789, 0).unwrap(), 123_456_789);
    }

    #[test]
    fn rounds_up_so_the_limit_is_never_looser() {
        // 10 / 1.01 = 9.90 -> 10: with 9 tokens the buyer would pay 11% more.
        assert_eq!(min_tokens_at(10, 100).unwrap(), 10);
    }

    #[test]
    fn largest_inputs_do_not_overflow() {
        assert!(min_tokens_at(u64::MAX, u16::MAX).is_ok());
        assert_eq!(min_tokens_at(u64::MAX, 0).unwrap(), u64::MAX);
    }

    #[test]
    fn ladder_reference_wins_when_the_price_did_not_move() {
        // Same quote on both references: a 1% rung is stricter than a 3% cap.
        let min = min_tokens_for_rung(1_000_000, 1_000_000, 100, 300).unwrap();
        assert_eq!(min, min_tokens_at(1_000_000, 100).unwrap());
    }

    #[test]
    fn cap_reference_wins_when_the_price_rose_before_the_order_landed() {
        // Seen: 1,000,000 tokens. At open the venue only gives 950,000 (price +5.3%).
        // A 3% rung on the start quote would allow 922,331 tokens, which is
        // 8.4% above the price the user saw. The 3% cap on the seen quote holds.
        let min = min_tokens_for_rung(1_000_000, 950_000, 300, 300).unwrap();
        assert_eq!(min, min_tokens_at(1_000_000, 300).unwrap());
        assert!(min > min_tokens_at(950_000, 300).unwrap());
    }

    #[test]
    fn ladder_reference_wins_when_the_price_fell_before_the_order_landed() {
        // At open the venue gives more tokens than the user saw: rungs are
        // counted from the better price.
        let min = min_tokens_for_rung(1_000_000, 1_100_000, 100, 300).unwrap();
        assert_eq!(min, min_tokens_at(1_100_000, 100).unwrap());
    }
}
