//! The two price references. The cap is measured against the quote the user
//! saw (`expected_tokens_seen`); the ladder is counted from the program's own
//! quote at open (`expected_tokens_start`). These tests move the price between
//! the app's quote and the open, and check both the stored start quote and
//! which rung can fill.

mod common;

use common::*;
use rung::{math::min_tokens_at, state::OrderStatus};
use solana_signer::Signer;

#[test]
fn cap_on_the_seen_price_binds_when_the_price_rose_before_open() {
    let mut env = Env::new();
    let user = env.user.pubkey();
    // The app quoted at the default reserves; by the time the order lands the
    // price is 5% higher.
    let spec = OrderSpec::quoted_at(AMOUNT, VIRTUAL_TOKEN, VIRTUAL_QUOTE).with_rungs(&[100, 200]);
    let vq_open = quote_reserves_up(VIRTUAL_QUOTE, 500);
    env.set_price(VIRTUAL_TOKEN, vq_open);
    assert_ok(&env.open_order(&spec));

    let order = env.order(&user).unwrap();
    let start = expected_start(spec.expected_tokens_seen, spec.raw_tokens_seen, AMOUNT, VIRTUAL_TOKEN, vq_open);
    assert_eq!(order.expected_tokens_seen, spec.expected_tokens_seen);
    assert_eq!(order.expected_tokens_start, start);
    assert!(start < spec.expected_tokens_seen);

    // The price stays where it was at open.
    let tokens_now = mock_quote(AMOUNT, VIRTUAL_TOKEN, vq_open);
    assert!(
        tokens_now >= min_tokens_at(start, 100).unwrap(),
        "precondition: against the on-chain start price the 1% rung would pass"
    );
    assert!(
        tokens_now < min_tokens_at(spec.expected_tokens_seen, 200).unwrap(),
        "precondition: against the seen price this is above the 2% cap"
    );

    for (rung, slot) in [(0u8, order.start_slot), (1, order.start_slot + WINDOW)] {
        env.warp(slot);
        let before = env.state();
        assert_code(&env.try_rung(rung), PUMP_SLIPPAGE);
        assert_eq!(env.state(), before.session_paid(SIG_FEE), "rung {rung}");
    }
    assert_eq!(env.order(&user).unwrap().status, OrderStatus::Open);
}

#[test]
fn rungs_count_from_the_lower_price_when_the_price_fell_before_open() {
    let mut env = Env::new();
    let user = env.user.pubkey();
    // The app quoted at the default reserves; at open the price is ~5% lower.
    let spec = OrderSpec::quoted_at(AMOUNT, VIRTUAL_TOKEN, VIRTUAL_QUOTE).with_rungs(&[100, 300]);
    let vq_open = VIRTUAL_QUOTE / 100 * 95;
    env.set_price(VIRTUAL_TOKEN, vq_open);
    assert_ok(&env.open_order(&spec));

    let order = env.order(&user).unwrap();
    let start = expected_start(spec.expected_tokens_seen, spec.raw_tokens_seen, AMOUNT, VIRTUAL_TOKEN, vq_open);
    assert_eq!(order.expected_tokens_start, start);
    assert!(start > spec.expected_tokens_seen);

    // Then the price rises 1.5% from the open price.
    let vq_try = quote_reserves_up(vq_open, 150);
    env.set_price(VIRTUAL_TOKEN, vq_try);
    let tokens_now = mock_quote(AMOUNT, VIRTUAL_TOKEN, vq_try);
    assert!(
        tokens_now >= spec.expected_tokens_seen,
        "precondition: still better than the price the user saw"
    );
    assert!(tokens_now < min_tokens(&order, 0), "precondition: 1% from the start price fails");
    assert!(tokens_now >= min_tokens(&order, 1), "precondition: 3% from the start price passes");

    let before = env.state();
    assert_code(&env.try_rung(0), PUMP_SLIPPAGE);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));

    env.warp(order.start_slot + WINDOW);
    assert_ok(&env.try_rung(1));
    let order = env.order(&user).unwrap();
    assert_eq!(order.status, OrderStatus::Filled);
    assert_eq!(order.filled_rung, 1);
    assert_eq!(env.tokens(&env.user_ata(&user)), Some(tokens_now));
}

#[test]
fn expected_tokens_start_equals_seen_when_the_price_did_not_move() {
    let mut env = Env::new();
    let spec = env.spec();
    assert_ok(&env.open_order(&spec));
    let order = env.order(&env.user.pubkey()).unwrap();
    assert_eq!(order.expected_tokens_start, spec.expected_tokens_seen);
}
