//! Input limits of `open_order`: one test per rejection, each breaking exactly
//! one rule of an otherwise valid order, plus the accepted boundary values.
//! A rejected open must leave no order, an empty vault and an unfunded key.
//! (Amount above the limit and fee budget above the limit are in scenarios.rs.)

mod common;

use common::*;
use rung::{error::RungError, state::OrderStatus, Venue};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[track_caller]
fn assert_rejected(env: &mut Env, spec: &OrderSpec, e: RungError) {
    let before = env.state();
    assert_eq!(before.order, None);
    assert_rung_err(&env.open_order(spec), e);
    assert_eq!(env.state(), before.user_paid(SIG_FEE));
}

#[track_caller]
fn assert_accepted(env: &mut Env, spec: &OrderSpec) {
    assert_ok(&env.open_order(spec));
    let order = env.order(&env.user.pubkey()).unwrap();
    assert_eq!(order.status, OrderStatus::Open);
    assert_eq!(order.rung_count as usize, spec.rungs_bps.len());
    assert_eq!(&order.rungs_bps[..spec.rungs_bps.len()], spec.rungs_bps.as_slice());
    assert_eq!(order.amount, spec.amount);
    assert_eq!(order.rent_reserve, spec.rent_reserve);
    assert_eq!(order.window_slots, spec.window_slots);
    assert_eq!(order.last_slot, order.start_slot + spec.lifetime_slots);
}

fn spec_with(f: impl FnOnce(&mut OrderSpec)) -> (Env, OrderSpec) {
    let env = Env::new();
    let mut spec = env.spec();
    f(&mut spec);
    (env, spec)
}

// --- rungs --------------------------------------------------------------------

#[test]
fn zero_rungs_are_rejected() {
    let (mut env, spec) = spec_with(|s| s.rungs_bps = vec![]);
    assert_rejected(&mut env, &spec, RungError::InvalidRungCount);
}

#[test]
fn six_rungs_are_rejected() {
    let (mut env, spec) = spec_with(|s| s.rungs_bps = vec![100, 200, 300, 400, 500, 600]);
    assert_rejected(&mut env, &spec, RungError::InvalidRungCount);
}

#[test]
fn one_and_five_rungs_are_accepted() {
    let (mut env, spec) = spec_with(|s| s.rungs_bps = vec![300]);
    assert_accepted(&mut env, &spec);
    let (mut env, spec) = spec_with(|s| s.rungs_bps = vec![100, 200, 300, 400, 500]);
    assert_accepted(&mut env, &spec);
}

#[test]
fn zero_rung_is_rejected() {
    let (mut env, spec) = spec_with(|s| s.rungs_bps = vec![0, 100]);
    assert_rejected(&mut env, &spec, RungError::RungsNotIncreasing);
    let (mut env, spec) = spec_with(|s| s.rungs_bps = vec![0]);
    assert_rejected(&mut env, &spec, RungError::RungsNotIncreasing);
}

#[test]
fn decreasing_rungs_are_rejected() {
    let (mut env, spec) = spec_with(|s| s.rungs_bps = vec![300, 100]);
    assert_rejected(&mut env, &spec, RungError::RungsNotIncreasing);
}

#[test]
fn equal_rungs_are_rejected() {
    let (mut env, spec) = spec_with(|s| s.rungs_bps = vec![100, 100, 200]);
    assert_rejected(&mut env, &spec, RungError::RungsNotIncreasing);
}

#[test]
fn cap_above_max_is_rejected() {
    let (mut env, spec) = spec_with(|s| s.rungs_bps = vec![100, rung::MAX_CAP_BPS + 1]);
    assert_rejected(&mut env, &spec, RungError::CapTooHigh);
}

#[test]
fn cap_at_max_is_accepted() {
    let (mut env, spec) = spec_with(|s| s.rungs_bps = vec![100, rung::MAX_CAP_BPS]);
    assert_accepted(&mut env, &spec);
}

// --- amounts ------------------------------------------------------------------

#[test]
fn amount_below_min_is_rejected() {
    let env = Env::new();
    let (vt, vq) = env.reserves();
    let spec = OrderSpec::quoted_at(rung::MIN_ORDER_LAMPORTS - 1, vt, vq);
    let mut env = env;
    assert_rejected(&mut env, &spec, RungError::AmountTooSmall);
}

#[test]
fn amount_at_min_is_accepted() {
    let env = Env::new();
    let (vt, vq) = env.reserves();
    let spec = OrderSpec::quoted_at(rung::MIN_ORDER_LAMPORTS, vt, vq);
    let mut env = env;
    assert_accepted(&mut env, &spec);
}

#[test]
fn rent_reserve_above_limit_is_rejected() {
    let (mut env, spec) = spec_with(|s| s.rent_reserve = rung::MAX_RENT_RESERVE_LAMPORTS + 1);
    assert_rejected(&mut env, &spec, RungError::RentReserveAboveLimit);
}

#[test]
fn rent_reserve_at_limit_is_accepted() {
    let (mut env, spec) = spec_with(|s| s.rent_reserve = rung::MAX_RENT_RESERVE_LAMPORTS);
    assert_accepted(&mut env, &spec);
}

// --- window and lifetime --------------------------------------------------------

#[test]
fn window_zero_is_rejected() {
    let (mut env, spec) = spec_with(|s| s.window_slots = 0);
    assert_rejected(&mut env, &spec, RungError::InvalidWindow);
}

#[test]
fn window_seventeen_is_rejected() {
    let (mut env, spec) = spec_with(|s| s.window_slots = rung::MAX_WINDOW_SLOTS + 1);
    assert_rejected(&mut env, &spec, RungError::InvalidWindow);
}

#[test]
fn window_one_and_sixteen_are_accepted() {
    let (mut env, spec) = spec_with(|s| s.window_slots = rung::MIN_WINDOW_SLOTS);
    assert_accepted(&mut env, &spec);
    let (mut env, spec) = spec_with(|s| s.window_slots = rung::MAX_WINDOW_SLOTS);
    assert_accepted(&mut env, &spec);
}

#[test]
fn lifetime_zero_is_rejected() {
    let (mut env, spec) = spec_with(|s| s.lifetime_slots = 0);
    assert_rejected(&mut env, &spec, RungError::InvalidLifetime);
}

#[test]
fn lifetime_above_max_is_rejected() {
    let (mut env, spec) = spec_with(|s| s.lifetime_slots = rung::MAX_LIFETIME_SLOTS + 1);
    assert_rejected(&mut env, &spec, RungError::InvalidLifetime);
}

#[test]
fn lifetime_at_max_is_accepted() {
    let (mut env, spec) = spec_with(|s| s.lifetime_slots = rung::MAX_LIFETIME_SLOTS);
    assert_accepted(&mut env, &spec);
}

#[test]
fn lifetime_that_ends_before_the_last_rung_is_due_is_rejected() {
    // Three rungs, window 4: the last rung is due at start + 8.
    let (mut env, spec) = spec_with(|s| {
        s.rungs_bps = vec![100, 200, 300];
        s.window_slots = 4;
        s.lifetime_slots = 8;
    });
    assert_rejected(&mut env, &spec, RungError::InvalidLifetime);
}

#[test]
fn lifetime_one_slot_past_the_last_rung_is_accepted() {
    let (mut env, spec) = spec_with(|s| {
        s.rungs_bps = vec![100, 200, 300];
        s.window_slots = 4;
        s.lifetime_slots = 9;
    });
    assert_accepted(&mut env, &spec);
}

// --- quotes ---------------------------------------------------------------------

#[test]
fn zero_expected_tokens_are_rejected() {
    let (mut env, spec) = spec_with(|s| s.expected_tokens_seen = 0);
    assert_rejected(&mut env, &spec, RungError::InvalidExpectedTokens);
}

#[test]
fn zero_raw_tokens_are_rejected() {
    let (mut env, spec) = spec_with(|s| s.raw_tokens_seen = 0);
    assert_rejected(&mut env, &spec, RungError::InvalidExpectedTokens);
}

// --- venue ----------------------------------------------------------------------

#[test]
fn pumpswap_venue_is_rejected_for_now() {
    let (mut env, spec) = spec_with(|s| s.venue = Venue::PumpSwap);
    assert_rejected(&mut env, &spec, RungError::VenueNotSupported);
}

#[track_caller]
fn assert_open_with_venue_state_rejected(env: &mut Env, venue_state: &anchor_lang::prelude::Pubkey, e: RungError) {
    // Quoted at the default reserves: the curve account may be unreadable here.
    let spec = OrderSpec::quoted_at(AMOUNT, VIRTUAL_TOKEN, VIRTUAL_QUOTE);
    let user = env.user.insecure_clone();
    let session = env.session.pubkey();
    let mint = env.mint;
    let before = env.state();
    assert_rung_err(&env.open_order_full(&user, &session, &mint, venue_state, &spec), e);
    assert_eq!(env.state(), before.user_paid(SIG_FEE));
}

#[test]
fn curve_of_another_mint_is_rejected() {
    let mut env = Env::new();
    let other_mint = Keypair::new().pubkey();
    env.create_mint(&other_mint, TOKEN);
    env.create_curve(&other_mint, VIRTUAL_TOKEN, VIRTUAL_QUOTE, false);
    assert_open_with_venue_state_rejected(&mut env, &curve_pda(&other_mint), RungError::InvalidVenueAccount);
}

#[test]
fn curve_not_owned_by_pump_is_rejected() {
    let mut env = Env::new();
    let curve = curve_pda(&env.mint);
    let data = pack_curve(VIRTUAL_TOKEN, VIRTUAL_QUOTE, false);
    let lamports = env.rent(data.len());
    // Right address and data, wrong owner.
    env.put(&curve, &Keypair::new().pubkey(), data, lamports);
    assert_open_with_venue_state_rejected(&mut env, &curve, RungError::InvalidVenueAccount);
}

#[test]
fn curve_with_unreadable_data_is_rejected() {
    let mut env = Env::new();
    let curve = curve_pda(&env.mint);
    let mut data = pack_curve(VIRTUAL_TOKEN, VIRTUAL_QUOTE, false);
    data[0] ^= 0xff; // wrong discriminator
    let lamports = env.rent(data.len());
    env.put(&curve, &PUMP, data, lamports);
    assert_open_with_venue_state_rejected(&mut env, &curve, RungError::InvalidVenueAccount);
}

#[test]
fn complete_curve_is_rejected() {
    let mut env = Env::new();
    let mint = env.mint;
    env.create_curve(&mint, VIRTUAL_TOKEN, VIRTUAL_QUOTE, true);
    assert_open_with_venue_state_rejected(&mut env, &curve_pda(&mint), RungError::CurveComplete);
}

// --- the stored order -----------------------------------------------------------

#[test]
fn accepted_order_stores_every_field() {
    let mut env = Env::new();
    let spec = env.spec().with_rungs(&[50, 150, 400]);
    assert_ok(&env.open_order(&spec));
    let user = env.user.pubkey();
    let order = env.order(&user).unwrap();
    let (order_bump, vault_bump) = order_bumps(&user);
    assert_eq!(order.user, user);
    assert_eq!(order.session_key, env.session.pubkey());
    assert_eq!(order.mint, env.mint);
    assert_eq!(order.venue, Venue::Curve);
    assert_eq!(order.status, OrderStatus::Open);
    assert_eq!(order.rung_count, 3);
    assert_eq!(&order.rungs_bps[..3], &[50, 150, 400]);
    assert_eq!(order.cap_bps(), 400);
    assert_eq!(order.amount, AMOUNT);
    assert_eq!(order.rent_reserve, RENT_RESERVE);
    assert_eq!(order.expected_tokens_seen, spec.expected_tokens_seen);
    assert_eq!(
        order.expected_tokens_start,
        expected_start(spec.expected_tokens_seen, spec.raw_tokens_seen, AMOUNT, VIRTUAL_TOKEN, VIRTUAL_QUOTE)
    );
    assert_eq!(order.start_slot, START_SLOT);
    assert_eq!(order.window_slots, WINDOW);
    assert_eq!(order.last_slot, START_SLOT + LIFETIME);
    assert_eq!(order.bump, order_bump);
    assert_eq!(order.vault_bump, vault_bump);
    assert_eq!(env.balance(&vault_pda(&user)), AMOUNT + RENT_RESERVE);
    assert_eq!(env.balance(&env.session.pubkey()), FEE_BUDGET);
}
