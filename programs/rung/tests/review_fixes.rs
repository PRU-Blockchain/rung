//! Tests added after the independent security review, each written before
//! its fix: a ceiling on the SOL a buy may take from the vault, a sanity band
//! on the two quotes the client supplies, a fee budget that cannot leave a new
//! session key below rent exemption, and a lower maximum cap.

mod common;

use common::*;
use rung::{error::RungError, state::OrderStatus};
use solana_signer::Signer;

fn opened() -> Env {
    let mut env = Env::new();
    env.open_default();
    env
}

/// Makes the test double take extra lamports from the buyer (`global` byte 2).
fn set_overcharge(env: &mut Env) {
    let lamports = env.rent(1);
    env.put(&global_pda(), &PUMP, vec![2], lamports);
}

// --- The buy may not take more SOL than the order allows ---------------------

#[test]
fn buy_program_that_takes_more_sol_than_the_order_allows_is_rejected() {
    let mut env = opened();
    let user = env.user.pubkey();
    // The double delivers the full amount of tokens, so the token check
    // passes; only the SOL check can catch it.
    set_overcharge(&mut env);
    let before = env.state();
    assert_rung_err(&env.try_rung(0), RungError::BuyTookTooMuchSol);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));
    assert_eq!(env.order(&user).unwrap().status, OrderStatus::Open);
}

#[test]
fn honest_buy_stays_within_the_sol_ceiling() {
    let mut env = opened();
    let user = env.user.pubkey();
    assert_ok(&env.try_rung(0));
    let order = env.order(&user).unwrap();
    assert_eq!(order.status, OrderStatus::Filled);
    assert_eq!(order.lamports_spent, AMOUNT);
}

// --- The client's two quotes must agree with each other ----------------------

#[test]
fn expected_tokens_above_the_fee_free_quote_are_rejected() {
    // Fees only ever reduce a quote: the quote with fees cannot exceed the
    // quote without them.
    let mut env = Env::new();
    let mut spec = env.spec();
    spec.expected_tokens_seen = spec.raw_tokens_seen + 1;
    let before = env.state();
    assert_rung_err(&env.open_order(&spec), RungError::InvalidExpectedTokens);
    assert_eq!(env.state(), before.user_paid(SIG_FEE));
}

#[test]
fn expected_tokens_far_below_the_fee_free_quote_are_rejected() {
    // A quote with fees that is more than 10% under the fee-free quote is not
    // a fee: it would switch the protection off.
    let mut env = Env::new();
    let mut spec = env.spec();
    spec.expected_tokens_seen = spec.raw_tokens_seen / 100 * 89;
    let before = env.state();
    assert_rung_err(&env.open_order(&spec), RungError::InvalidExpectedTokens);
    assert_eq!(env.state(), before.user_paid(SIG_FEE));
}

#[test]
fn expected_tokens_of_one_are_rejected() {
    let mut env = Env::new();
    let mut spec = env.spec();
    spec.expected_tokens_seen = 1;
    assert_rung_err(&env.open_order(&spec), RungError::InvalidExpectedTokens);
}

#[test]
fn inflated_fee_free_quote_is_rejected() {
    // A huge `raw_tokens_seen` would shrink the ladder's start to almost zero.
    let mut env = Env::new();
    let mut spec = env.spec();
    spec.raw_tokens_seen = spec.raw_tokens_seen * 2;
    assert_rung_err(&env.open_order(&spec), RungError::InvalidExpectedTokens);
}

#[test]
fn quotes_at_the_edge_of_the_fee_band_are_accepted_and_keep_the_ladder_on() {
    let mut env = Env::new();
    let user = env.user.pubkey();
    let mut spec = env.spec();
    // Exactly 10% under the fee-free quote, rounded up.
    spec.expected_tokens_seen = (spec.raw_tokens_seen as u128 * 9_000).div_ceil(10_000) as u64;
    assert_ok(&env.open_order(&spec));
    let order = env.order(&user).unwrap();
    // The price did not move, so the ladder starts from the same quote: the
    // client's numbers cannot push it below 90% of what the chain shows.
    let raw_now = raw_quote(AMOUNT, VIRTUAL_TOKEN, VIRTUAL_QUOTE);
    assert_eq!(order.expected_tokens_start, spec.expected_tokens_seen);
    assert!(order.expected_tokens_start as u128 * 10_000 >= raw_now as u128 * 9_000 - 10_000);
}

// --- Fee budget and rent exemption -------------------------------------------

#[test]
fn fee_budget_that_leaves_a_new_session_key_below_rent_exemption_is_rejected() {
    // On mainnet a transfer that leaves a new account below the rent-exempt
    // minimum fails; LiteSVM does not enforce that, so the program checks.
    let mut env = Env::new();
    let mut spec = env.spec();
    spec.fee_budget = env.rent(0) - 1;
    let before = env.state();
    assert_rung_err(&env.open_order(&spec), RungError::FeeBudgetBelowRent);
    assert_eq!(env.state(), before.user_paid(SIG_FEE));
}

#[test]
fn fee_budget_equal_to_rent_exemption_is_accepted() {
    let mut env = Env::new();
    let mut spec = env.spec();
    spec.fee_budget = env.rent(0);
    assert_ok(&env.open_order(&spec));
    assert_eq!(env.balance(&env.session.pubkey()), env.rent(0));
}

#[test]
fn zero_fee_budget_is_accepted() {
    let mut env = Env::new();
    let mut spec = env.spec();
    spec.fee_budget = 0;
    assert_ok(&env.open_order(&spec));
    assert_eq!(env.balance(&env.session.pubkey()), 0);
}

#[test]
fn small_fee_budget_for_an_already_funded_session_key_is_accepted() {
    let mut env = Env::new();
    let session = env.session.pubkey();
    let funded = env.rent(0);
    env.put(&session, &SYSTEM, vec![], funded);
    let mut spec = env.spec();
    spec.fee_budget = 10_000;
    assert_ok(&env.open_order(&spec));
    assert_eq!(env.balance(&session), funded + 10_000);
}

// --- Maximum cap -------------------------------------------------------------

#[test]
fn maximum_cap_is_thirty_percent() {
    assert_eq!(rung::MAX_CAP_BPS, 3_000);
    let mut env = Env::new();
    let above = env.spec().with_rungs(&[1_000, 2_000, 3_001]);
    assert_rung_err(&env.open_order(&above), RungError::CapTooHigh);
    let at = env.spec().with_rungs(&[1_000, 2_000, 3_000]);
    assert_ok(&env.open_order(&at));
}
