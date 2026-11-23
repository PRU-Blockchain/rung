//! Events: `OrderOpened`, `OrderFilled` and `OrderRefunded` (all three
//! reasons) appear in the logs once, with the values the order holds.

mod common;

use common::*;
use rung::{
    events::{OrderFilled, OrderOpened, OrderRefunded, RefundReason},
    Venue,
};
use solana_signer::Signer;

#[test]
fn open_order_emits_order_opened() {
    let mut env = Env::new();
    let spec = env.spec();
    let meta = assert_ok(&env.open_order(&spec));
    let order = env.order(&env.user.pubkey()).unwrap();

    let opened = events::<OrderOpened>(&meta.logs);
    assert_eq!(opened.len(), 1);
    let e = &opened[0];
    assert_eq!(e.user, env.user.pubkey());
    assert_eq!(e.session_key, env.session.pubkey());
    assert_eq!(e.mint, env.mint);
    assert_eq!(e.venue, Venue::Curve);
    assert_eq!(e.amount, AMOUNT);
    assert_eq!(e.rung_count, 2);
    assert_eq!(&e.rungs_bps[..2], &[100, 300]);
    assert_eq!(e.expected_tokens_seen, spec.expected_tokens_seen);
    assert_eq!(e.expected_tokens_start, order.expected_tokens_start);
    assert_eq!(e.start_slot, START_SLOT);
    assert_eq!(e.window_slots, WINDOW);
    assert_eq!(e.last_slot, START_SLOT + LIFETIME);
}

#[test]
fn fill_emits_order_filled() {
    let mut env = Env::new();
    let spec = env.spec();
    assert_ok(&env.open_order(&spec));
    let start = env.order(&env.user.pubkey()).unwrap().expected_tokens_start;
    env.warp(START_SLOT + WINDOW);
    let bought = mock_quote(AMOUNT, VIRTUAL_TOKEN, VIRTUAL_QUOTE);
    let meta = assert_ok(&env.try_rung(1));

    let filled = events::<OrderFilled>(&meta.logs);
    assert_eq!(filled.len(), 1);
    let e = &filled[0];
    assert_eq!(e.user, env.user.pubkey());
    assert_eq!(e.mint, env.mint);
    assert_eq!(e.rung_index, 1);
    assert_eq!(e.rung_bps, 300);
    assert_eq!(e.tokens_bought, bought);
    assert_eq!(e.lamports_spent, AMOUNT);
    assert_eq!(e.expected_tokens_seen, spec.expected_tokens_seen);
    assert_eq!(e.expected_tokens_start, start);
    assert_eq!(e.slot, START_SLOT + WINDOW);
}

fn assert_refunded(logs: &[String], env: &Env, reason: RefundReason, slot: u64) {
    let refunded = events::<OrderRefunded>(logs);
    assert_eq!(refunded.len(), 1);
    let e = &refunded[0];
    assert_eq!(e.user, env.user.pubkey());
    assert_eq!(e.mint, env.mint);
    assert_eq!(e.reason, reason);
    assert_eq!(e.lamports_returned, AMOUNT + RENT_RESERVE);
    assert_eq!(e.slot, slot);
}

#[test]
fn expired_refund_emits_order_refunded_expired() {
    let mut env = Env::new();
    env.open_default();
    let last = START_SLOT + LIFETIME;
    env.warp(last);
    let stranger = env.new_funded_keypair(1_000_000_000);
    let meta = assert_ok(&env.refund(&stranger, &env.user.pubkey()));
    assert_refunded(&meta.logs, &env, RefundReason::Expired, last);
}

#[test]
fn early_refund_by_session_key_emits_order_refunded_gave_up() {
    let mut env = Env::new();
    env.open_default();
    env.warp(START_SLOT + 5);
    let session = env.session.insecure_clone();
    let meta = assert_ok(&env.refund(&session, &env.user.pubkey()));
    assert_refunded(&meta.logs, &env, RefundReason::GaveUp, START_SLOT + 5);
}

#[test]
fn cancel_emits_order_refunded_cancelled() {
    let mut env = Env::new();
    env.open_default();
    let user = env.user.insecure_clone();
    let meta = assert_ok(&env.cancel(&user));
    assert_refunded(&meta.logs, &env, RefundReason::Cancelled, START_SLOT);
}

#[test]
fn rejected_try_emits_no_event() {
    let mut env = Env::new();
    env.open_default();
    let res = env.try_rung(1);
    assert_rung_err(&res, rung::error::RungError::RungNotDue);
    let logs = &res.unwrap_err().meta.logs;
    assert!(events::<OrderFilled>(logs).is_empty());
}
