//! KT1 scenario tests (a)-(i) and (ek) from docs/is-listesi.md: the ladder
//! fills on a later rung, at most one buy, rung timing and cap, who may try,
//! refund, cancel, per-order limits, the session key's fee budget, and
//! pre-funded order and vault addresses. Every rejection checks the exact
//! error code and that nothing else moved.

mod common;

use common::*;
use rung::{error::RungError, state::OrderStatus};
use solana_signer::Signer;

/// Opens the default order (1% then 3%) and returns the user's balance right after.
fn open(env: &mut Env) -> u64 {
    env.open_default();
    env.balance(&env.user.pubkey())
}

// (a) ------------------------------------------------------------------------

#[test]
fn second_rung_fills_after_first_rung_fails() {
    let mut env = Env::new();
    let user = env.user.pubkey();
    let session = env.session.pubkey();
    let vault = vault_pda(&user);
    let curve = curve_pda(&env.mint);
    let u0 = env.balance(&user);

    let u1 = open(&mut env);
    let order_rent = env.order_rent();
    assert_eq!(u1, u0 - SIG_FEE - order_rent - AMOUNT - RENT_RESERVE - FEE_BUDGET);
    assert_eq!(env.balance(&vault), AMOUNT + RENT_RESERVE);
    assert_eq!(env.balance(&session), FEE_BUDGET);
    let order = env.order(&user).unwrap();

    // The price rises 2% after the order was opened.
    let vq_up = quote_reserves_up(VIRTUAL_QUOTE, 200);
    env.set_price(VIRTUAL_TOKEN, vq_up);
    let tokens_now = mock_quote(AMOUNT, VIRTUAL_TOKEN, vq_up);
    assert!(tokens_now < min_tokens(&order, 0), "precondition: the 1% rung must fail");
    assert!(tokens_now >= min_tokens(&order, 1), "precondition: the 3% rung must pass");

    // Rung 0: pump rejects with its slippage error; the whole try is undone.
    let before = env.state();
    assert_code(&env.try_rung(0), PUMP_SLIPPAGE);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));
    assert_eq!(env.order(&user).unwrap().status, OrderStatus::Open);

    // Rung 1 when it becomes due.
    env.warp(order.start_slot + WINDOW);
    let curve_before = env.balance(&curve);
    assert_ok(&env.try_rung(1));

    let user_ata = env.user_ata(&user);
    assert_eq!(env.tokens(&user_ata), Some(tokens_now));
    assert_eq!(env.balance(&vault), 0);
    assert!(!env.exists(&env.vault_ata(&user)), "vault token account is closed");
    let user_ata_rent = env.balance(&user_ata);
    let accumulator_rent = env.balance(&accumulator_pda(&vault));
    assert_eq!(user_ata_rent, env.rent(165));
    assert_eq!(accumulator_rent, env.rent(137));
    // Everything the vault did not spend on the buy and the two new accounts
    // is back with the user, to the lamport.
    assert_eq!(env.balance(&user), u1 + RENT_RESERVE - user_ata_rent - accumulator_rent);
    assert_eq!(env.balance(&curve), curve_before + AMOUNT);
    assert_eq!(env.balance(&session), FEE_BUDGET - 2 * SIG_FEE);

    let filled = env.order(&user).unwrap();
    assert_eq!(filled.status, OrderStatus::Filled);
    assert_eq!(filled.filled_rung, 1);
    assert_eq!(filled.tokens_bought, tokens_now);
    // Assumption: `lamports_spent` is what went to pump for the buy (`amount`),
    // not the rent of the accounts the buy created.
    assert_eq!(filled.lamports_spent, AMOUNT);
}

// (b) ------------------------------------------------------------------------

#[test]
fn try_after_fill_is_rejected_with_order_filled() {
    let mut env = Env::new();
    open(&mut env);
    let order = env.order(&env.user.pubkey()).unwrap();
    assert_ok(&env.try_rung(0));

    env.warp(order.start_slot + WINDOW);
    let before = env.state();
    assert_rung_err(&env.try_rung(1), RungError::OrderFilled);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));
    let before = env.state();
    assert_rung_err(&env.try_rung(0), RungError::OrderFilled);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));
}

#[test]
fn stranger_on_a_filled_order_gets_wrong_session_key_first() {
    // Check order: the signer is checked before the status.
    let mut env = Env::new();
    open(&mut env);
    assert_ok(&env.try_rung(0));
    let stranger = env.new_funded_keypair(1_000_000_000);
    let accounts = env.try_accounts_for(&stranger.pubkey(), &env.user.pubkey());
    let before = env.state();
    assert_rung_err(&env.try_rung_with(&stranger, &accounts, 0), RungError::WrongSessionKey);
    assert_eq!(env.state(), before);
}

// (c) ------------------------------------------------------------------------

#[test]
fn rung_above_cap_is_rejected() {
    let mut env = Env::new();
    open(&mut env);
    let order = env.order(&env.user.pubkey()).unwrap();
    assert_eq!(order.rung_count, 2);
    // Late enough that a third rung would be due if it existed.
    env.warp(order.start_slot + 2 * WINDOW);
    for index in [2u8, 4, 5, 255] {
        let before = env.state();
        assert_rung_err(&env.try_rung(index), RungError::RungAboveCap);
        assert_eq!(env.state(), before.session_paid(SIG_FEE));
    }
}

#[test]
fn rung_above_cap_is_reported_before_rung_not_due() {
    let mut env = Env::new();
    open(&mut env);
    // At the start slot rung 2 is neither in the order nor due.
    let before = env.state();
    assert_rung_err(&env.try_rung(2), RungError::RungAboveCap);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));
}

// (d) ------------------------------------------------------------------------

#[test]
fn rung_not_due_is_rejected_until_its_exact_slot() {
    let mut env = Env::new();
    let spec = env.spec().with_rungs(&[100, 300, 500]);
    assert_ok(&env.open_order(&spec));
    let user = env.user.pubkey();
    let start = env.order(&user).unwrap().start_slot;
    assert_eq!(start, START_SLOT);

    for (slot, index) in [(start, 1u8), (start + WINDOW - 1, 1), (start + WINDOW, 2), (start + 2 * WINDOW - 1, 2)] {
        env.warp(slot);
        let before = env.state();
        assert_rung_err(&env.try_rung(index), RungError::RungNotDue);
        assert_eq!(env.state(), before.session_paid(SIG_FEE), "slot {slot}, rung {index}");
    }

    // Exactly at `start + 1 * window` rung 1 is due and fills.
    env.warp(start + WINDOW);
    assert_ok(&env.try_rung(1));
    let order = env.order(&user).unwrap();
    assert_eq!(order.status, OrderStatus::Filled);
    assert_eq!(order.filled_rung, 1);
}

// (e) ------------------------------------------------------------------------

#[test]
fn other_key_is_rejected_with_wrong_session_key() {
    let mut env = Env::new();
    open(&mut env);
    let other = env.new_funded_keypair(1_000_000_000);
    let accounts = env.try_accounts_for(&other.pubkey(), &env.user.pubkey());
    let before = env.state();
    let other_before = env.balance(&other.pubkey());
    assert_rung_err(&env.try_rung_with(&other, &accounts, 0), RungError::WrongSessionKey);
    assert_eq!(env.state(), before);
    assert_eq!(env.balance(&other.pubkey()), other_before - SIG_FEE);
    // The user, though not the key, cannot try either.
    let user = env.user.insecure_clone();
    let accounts = env.try_accounts_for(&user.pubkey(), &user.pubkey());
    let before = env.state();
    assert_rung_err(&env.try_rung_with(&user, &accounts, 0), RungError::WrongSessionKey);
    assert_eq!(env.state(), before.user_paid(SIG_FEE));
}

// (f) ------------------------------------------------------------------------

#[test]
fn third_party_refund_after_expiry_pays_the_user_only() {
    let mut env = Env::new();
    let user = env.user.pubkey();
    let u1 = open(&mut env);
    let order = env.order(&user).unwrap();
    let order_rent = env.order_rent();
    let stranger = env.new_funded_keypair(1_000_000_000);
    let stranger_before = env.balance(&stranger.pubkey());

    env.warp(order.last_slot);
    assert_ok(&env.refund(&stranger, &user));

    assert_eq!(env.balance(&user), u1 + AMOUNT + RENT_RESERVE + order_rent);
    assert_eq!(env.balance(&vault_pda(&user)), 0);
    assert!(!env.exists(&order_pda(&user)), "order account is closed");
    assert_eq!(env.balance(&stranger.pubkey()), stranger_before - SIG_FEE);
}

#[test]
fn third_party_refund_before_expiry_is_rejected() {
    let mut env = Env::new();
    let user = env.user.pubkey();
    open(&mut env);
    let order = env.order(&user).unwrap();
    let stranger = env.new_funded_keypair(1_000_000_000);
    for slot in [order.start_slot, order.last_slot - 1] {
        env.warp(slot);
        let before = env.state();
        assert_rung_err(&env.refund(&stranger, &user), RungError::OrderNotExpired);
        assert_eq!(env.state(), before, "slot {slot}");
    }
}

// (g) ------------------------------------------------------------------------

#[test]
fn only_the_user_can_cancel() {
    let mut env = Env::new();
    let user = env.user.pubkey();
    let u1 = open(&mut env);
    let order_rent = env.order_rent();

    // An attacker signs as `user` with the victim's order and vault. The
    // order's seeds are derived from the signer, so Anchor's seeds constraint
    // rejects it before `has_one = user` (WrongUser) is reached.
    let attacker = env.new_funded_keypair(1_000_000_000);
    let ix = cancel_ix_with(&attacker.pubkey(), &order_pda(&user), &vault_pda(&user));
    let before = env.state();
    let res = env.send(&[ix], &attacker, &[]);
    assert_anchor_err(&res, anchor_lang::error::ErrorCode::ConstraintSeeds);
    assert_eq!(env.state(), before);

    // The session key cannot cancel either (same constraint).
    let session = env.session.insecure_clone();
    let ix = cancel_ix_with(&session.pubkey(), &order_pda(&user), &vault_pda(&user));
    let before = env.state();
    assert_anchor_err(&env.send(&[ix], &session, &[]), anchor_lang::error::ErrorCode::ConstraintSeeds);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));

    // The user can.
    let user_kp = env.user.insecure_clone();
    assert_ok(&env.cancel(&user_kp));
    assert_eq!(env.balance(&user), u1 - SIG_FEE + AMOUNT + RENT_RESERVE + order_rent);
    assert_eq!(env.balance(&vault_pda(&user)), 0);
    assert!(!env.exists(&order_pda(&user)));
}

#[test]
fn cancel_of_a_filled_order_is_rejected_with_order_not_open() {
    let mut env = Env::new();
    open(&mut env);
    assert_ok(&env.try_rung(0));
    let user = env.user.insecure_clone();
    let before = env.state();
    assert_rung_err(&env.cancel(&user), RungError::OrderNotOpen);
    assert_eq!(env.state(), before.user_paid(SIG_FEE));
}

// (h) ------------------------------------------------------------------------

#[test]
fn amount_one_above_per_order_limit_is_rejected() {
    let mut env = Env::new();
    let (vt, vq) = env.reserves();
    let spec = OrderSpec::quoted_at(rung::MAX_ORDER_LAMPORTS + 1, vt, vq);
    let before = env.state();
    assert_rung_err(&env.open_order(&spec), RungError::AmountAboveLimit);
    assert_eq!(env.state(), before.user_paid(SIG_FEE));
}

#[test]
fn amount_at_per_order_limit_is_accepted() {
    let mut env = Env::new();
    let (vt, vq) = env.reserves();
    let spec = OrderSpec::quoted_at(rung::MAX_ORDER_LAMPORTS, vt, vq);
    assert_ok(&env.open_order(&spec));
    let user = env.user.pubkey();
    assert_eq!(env.order(&user).unwrap().amount, rung::MAX_ORDER_LAMPORTS);
    assert_eq!(env.balance(&vault_pda(&user)), rung::MAX_ORDER_LAMPORTS + RENT_RESERVE);
}

// (i) ------------------------------------------------------------------------

#[test]
fn fee_budget_one_above_limit_is_rejected() {
    let mut env = Env::new();
    let mut spec = env.spec();
    spec.fee_budget = rung::MAX_FEE_BUDGET_LAMPORTS + 1;
    let before = env.state();
    assert_rung_err(&env.open_order(&spec), RungError::FeeBudgetAboveLimit);
    assert_eq!(env.state(), before.user_paid(SIG_FEE));
}

#[test]
fn fee_budget_at_limit_is_accepted() {
    let mut env = Env::new();
    let mut spec = env.spec();
    spec.fee_budget = rung::MAX_FEE_BUDGET_LAMPORTS;
    assert_ok(&env.open_order(&spec));
    assert_eq!(env.balance(&env.session.pubkey()), rung::MAX_FEE_BUDGET_LAMPORTS);
}

/// The key holds only its fee budget. Once fees would take it below the
/// rent-exempt minimum the runtime rejects its transactions before they run,
/// and the vault never pays for them.
#[test]
fn session_key_can_spend_only_its_fee_budget() {
    let mut env = Env::new();
    let user = env.user.pubkey();
    let session = env.session.pubkey();
    open(&mut env);
    let vault_before = env.balance(&vault_pda(&user));
    let user_before = env.balance(&user);

    // Rung 1 is not due at the start slot: every try fails but costs a fee.
    let affordable = (FEE_BUDGET - env.rent(0)) / SIG_FEE;
    for _ in 0..affordable {
        assert_rung_err(&env.try_rung(1), RungError::RungNotDue);
    }
    assert_eq!(env.balance(&session), FEE_BUDGET - affordable * SIG_FEE);

    let before = env.state();
    let res = env.try_rung(1);
    assert_eq!(
        res.unwrap_err().err,
        solana_transaction_error::TransactionError::InsufficientFundsForRent { account_index: 0 }
    );
    assert_eq!(env.state(), before, "a rejected-for-fee transaction moves nothing");
    assert_eq!(env.balance(&vault_pda(&user)), vault_before);
    assert_eq!(env.balance(&user), user_before);
}

/// No instruction lets the key move vault lamports to itself: when it ends
/// the order early, everything goes to the user.
#[test]
fn session_key_refund_sends_everything_to_the_user() {
    let mut env = Env::new();
    let user = env.user.pubkey();
    let u1 = open(&mut env);
    let order_rent = env.order_rent();
    let session = env.session.insecure_clone();
    let key_before = env.balance(&session.pubkey());

    assert_ok(&env.refund(&session, &user));
    assert_eq!(env.balance(&user), u1 + AMOUNT + RENT_RESERVE + order_rent);
    assert_eq!(env.balance(&session.pubkey()), key_before - SIG_FEE);
    assert_eq!(env.balance(&vault_pda(&user)), 0);
    assert!(!env.exists(&order_pda(&user)));
}

// (ek) -----------------------------------------------------------------------

fn assert_open_on_prefunded_order(prefund: u64) {
    let mut env = Env::new();
    let user = env.user.pubkey();
    let attacker = env.new_funded_keypair(1_000_000_000);
    assert_ok(&env.transfer(&attacker, &order_pda(&user), prefund));
    let order_rent = env.order_rent();
    let u0 = env.balance(&user);

    let spec = env.spec();
    assert_ok(&env.open_order(&spec));
    let order = env.order(&user).expect("order is created on the pre-funded address");
    assert_eq!(order.status, OrderStatus::Open);
    assert_eq!(order.user, user);
    // Anchor's `init` tops a pre-funded address up to rent exemption only.
    let topped_up = order_rent.saturating_sub(prefund);
    assert_eq!(env.balance(&order_pda(&user)), prefund.max(order_rent));
    assert_eq!(env.balance(&user), u0 - SIG_FEE - topped_up - AMOUNT - RENT_RESERVE - FEE_BUDGET);

    // Cancelling returns the whole order account, pre-funding included, to the user.
    let u1 = env.balance(&user);
    let user_kp = env.user.insecure_clone();
    assert_ok(&env.cancel(&user_kp));
    assert_eq!(env.balance(&user), u1 - SIG_FEE + AMOUNT + RENT_RESERVE + prefund.max(order_rent));
}

#[test]
fn open_order_works_on_order_address_prefunded_below_rent() {
    assert_open_on_prefunded_order(1_000_000);
}

#[test]
fn open_order_works_on_order_address_prefunded_above_rent() {
    assert_open_on_prefunded_order(5_000_000);
}

#[test]
fn prefunded_vault_lamports_return_to_the_user_on_cancel() {
    let mut env = Env::new();
    let user = env.user.pubkey();
    let extra = 3_000_000;
    let attacker = env.new_funded_keypair(1_000_000_000);
    assert_ok(&env.transfer(&attacker, &vault_pda(&user), extra));
    let u0 = env.balance(&user);

    open(&mut env);
    assert_eq!(env.balance(&vault_pda(&user)), extra + AMOUNT + RENT_RESERVE);
    let user_kp = env.user.insecure_clone();
    assert_ok(&env.cancel(&user_kp));
    assert_eq!(env.balance(&vault_pda(&user)), 0);
    // Net: two fees and the session key's budget; the attacker's lamports are the user's now.
    assert_eq!(env.balance(&user), u0 - 2 * SIG_FEE - FEE_BUDGET + extra);
}

#[test]
fn prefunded_vault_lamports_return_to_the_user_on_fill() {
    let mut env = Env::new();
    let user = env.user.pubkey();
    let extra = 3_000_000;
    let attacker = env.new_funded_keypair(1_000_000_000);
    assert_ok(&env.transfer(&attacker, &vault_pda(&user), extra));

    let u1 = open(&mut env);
    assert_ok(&env.try_rung(0));
    let vault = vault_pda(&user);
    assert_eq!(env.balance(&vault), 0);
    let user_ata_rent = env.balance(&env.user_ata(&user));
    let accumulator_rent = env.balance(&accumulator_pda(&vault));
    assert_eq!(env.balance(&user), u1 + extra + RENT_RESERVE - user_ata_rent - accumulator_rent);
    // The buy spent `amount`, not the extra lamports.
    assert_eq!(env.order(&user).unwrap().lamports_spent, AMOUNT);
}
