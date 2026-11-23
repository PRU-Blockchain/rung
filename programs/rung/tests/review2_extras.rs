//! Tests suggested by the second independent review (2026-11-24). They pin
//! behaviour the earlier files did not reach:
//! - an AMM that misuses the buyer's signature it receives through the CPI
//!   (takes more wrapped SOL than asked, closes the vault's wrapped SOL
//!   account, takes over the vault's system account);
//! - a vault token account that carries a delegate;
//! - a try that runs out of compute units;
//! - the largest rent reserve a pool buy needs, to the lamport;
//! - refund and cancel while a wrapped SOL account of the vault exists;
//! - a new order on the other venue after a fill.
//! Every rejection also checks that no balance or account changed, apart from
//! the fee the signer paid.

mod common;

use anchor_lang::prelude::Pubkey;
use common::{amm::*, *};
use rung::{error::RungError, state::OrderStatus, Venue};
use solana_keypair::Keypair;
use solana_signer::Signer;

fn opened() -> AmmEnv {
    let mut env = AmmEnv::new();
    env.open_default();
    env
}

/// A try that failed for a reason outside Rung's own error list: any error,
/// and nothing but the session key's fee moved.
#[track_caller]
fn assert_try_failed_and_changed_nothing(env: &mut AmmEnv, rung_index: u8) -> String {
    let before = env.state();
    let res = env.try_rung(rung_index);
    let err = match &res {
        Ok(_) => panic!("the try went through"),
        Err(failed) => format!("{:?}", failed.err),
    };
    assert_eq!(env.state(), before.session_paid(SIG_FEE));
    assert_eq!(env.order(&env.user.pubkey()).unwrap().status, OrderStatus::Open);
    err
}

// --- An AMM that misuses the vault's signature ----------------------------------

/// Wrapped SOL parked in the vault's account beforehand must not become
/// spendable: the buy may take the order amount of wrapped SOL and no more.
#[test]
fn amm_that_overdraws_a_prefilled_wsol_account_is_rejected() {
    let mut env = opened();
    let user = env.user.pubkey();
    let vault_wsol = env.vault_wsol_ata(&user);
    env.set_quote_account(&vault_wsol, &vault_pda(&user), 5_000_000);
    assert!(mock_pump_amm::OVERDRAW_WSOL <= 5_000_000, "precondition: the overdraw is there to take");
    env.set_amm_cheat(3);
    let before = env.state();
    assert_rung_err(&env.try_rung(0), RungError::BuyTookTooMuchSol);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));
    assert_eq!(env.tokens(&vault_wsol), Some(5_000_000));
}

/// Without anything parked there the account holds exactly the order amount,
/// so an overdraw cannot even be paid: the token program refuses the transfer.
#[test]
fn amm_that_overdraws_an_exact_wsol_account_cannot_be_paid() {
    let mut env = opened();
    env.set_amm_cheat(3);
    let err = assert_try_failed_and_changed_nothing(&mut env, 0);
    // SPL Token `InsufficientFunds`.
    assert!(err.contains("Custom(1)"), "{err}");
}

/// The AMM closes the vault's wrapped SOL account and keeps what was in it.
/// Rung reads that account after the buy; a closed account fails the try.
#[test]
fn amm_that_closes_the_vaults_wsol_account_is_rejected() {
    let mut env = opened();
    env.set_amm_cheat(4);
    let before = env.state();
    assert_rung_err(&env.try_rung(0), RungError::AccountMismatch);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));
}

/// Same with wrapped SOL parked in the account beforehand.
#[test]
fn amm_that_closes_a_prefilled_wsol_account_is_rejected() {
    let mut env = opened();
    let user = env.user.pubkey();
    let vault_wsol = env.vault_wsol_ata(&user);
    env.set_quote_account(&vault_wsol, &vault_pda(&user), 5_000_000);
    env.set_amm_cheat(4);
    let before = env.state();
    assert_rung_err(&env.try_rung(0), RungError::AccountMismatch);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));
    assert_eq!(env.tokens(&vault_wsol), Some(5_000_000));
}

/// The AMM assigns the vault's system account to itself. Rung then cannot move
/// the vault's lamports to the user, so the whole try fails and the vault
/// stays a system account.
#[test]
fn amm_that_takes_over_the_vault_account_is_rejected() {
    let mut env = opened();
    let vault = vault_pda(&env.user.pubkey());
    env.set_amm_cheat(5);
    let err = assert_try_failed_and_changed_nothing(&mut env, 0);
    assert!(!err.contains("Custom"), "expected a runtime error, got {err}");
    assert_eq!(env.svm.get_account(&vault).unwrap().owner, SYSTEM);
    // The order still fills once the AMM behaves.
    env.set_amm_cheat(0);
    assert_ok(&env.try_rung(0));
}

// --- A vault token account with a delegate ---------------------------------------

/// Token account data with `delegate` approved for `delegated_amount`.
fn pack_delegated_token_account(mint: &Pubkey, owner: &Pubkey, amount: u64, delegate: &Pubkey, delegated_amount: u64) -> Vec<u8> {
    let mut d = pack_token_account(mint, owner, amount);
    d[72..76].copy_from_slice(&1u32.to_le_bytes()); // delegate: Some
    d[76..108].copy_from_slice(delegate.as_ref());
    d[121..129].copy_from_slice(&delegated_amount.to_le_bytes());
    d
}

/// Only the vault can approve a delegate on its own token account and it never
/// does, so this state cannot arise on chain. If it did: the user still gets
/// every token and the account is closed, on both venues.
#[test]
fn a_delegate_on_the_vault_token_account_gets_nothing() {
    for pool_order in [false, true] {
        let mut env = AmmEnv::new();
        if pool_order {
            env.open_default();
        } else {
            env.env.open_default();
        }
        let user = env.user.pubkey();
        let vault = vault_pda(&user);
        let (vault_ata, mint) = (env.vault_ata(&user), env.mint);
        let delegate = Keypair::new().pubkey();
        let pre = 777_000;
        let lamports = env.rent(165);
        env.put(&vault_ata, &TOKEN, pack_delegated_token_account(&mint, &vault, pre, &delegate, u64::MAX), lamports);

        let res = if pool_order { env.try_rung(0) } else { env.env.try_rung(0) };
        assert_ok(&res);
        let bought = env.order(&user).unwrap().tokens_bought;
        assert!(bought > 0);
        assert_eq!(env.tokens(&env.user_ata(&user)), Some(pre + bought), "pool order: {pool_order}");
        assert!(!env.exists(&vault_ata));
        assert_eq!(env.balance(&vault), 0);
    }
}

// --- Out of compute units ----------------------------------------------------------

/// A try that runs out of compute units part-way (after the token accounts
/// were created) leaves nothing behind.
#[test]
fn a_try_that_runs_out_of_compute_units_changes_nothing() {
    for (pool_order, limit) in [(false, 60_000u32), (true, 60_000), (true, 120_000)] {
        let mut env = AmmEnv::new();
        let accounts = if pool_order {
            env.open_default();
            env.try_accounts()
        } else {
            env.env.open_default();
            env.env.try_accounts()
        };
        let session = env.session.insecure_clone();
        let before = env.state();
        let res = env.send(&[cu_limit_ix(limit), accounts.ix(0)], &session, &[]);
        let err = format!("{:?}", res.as_ref().err().expect("the try went through").err);
        assert!(
            err.contains("ProgramFailedToComplete") || err.contains("ComputationalBudgetExceeded"),
            "pool order {pool_order}, limit {limit}: {err}"
        );
        assert_eq!(env.state(), before.session_paid(SIG_FEE), "pool order {pool_order}, limit {limit}");
        // The same try with room to run still fills.
        assert_ok(&env.try_rung_with(&session, &accounts, 0));
    }
}

// --- The rent reserve a pool buy needs -----------------------------------------------

/// Lamports a first pool buy takes from the rent reserve at its highest point:
/// the user's token account, the vault's token account, the vault's wrapped
/// SOL account and the buyer's volume account all exist at once.
fn pool_buy_rent_peak(token_program: Pubkey) -> u64 {
    let mut env = AmmEnv::with_token_program(token_program);
    env.open_default();
    let user = env.user.pubkey();
    assert_ok(&env.try_rung(0));
    let token_account_rent = env.balance(&env.user_ata(&user));
    let accumulator_rent = env.balance(&amm_accumulator_pda(&vault_pda(&user)));
    assert!(token_account_rent > 0 && accumulator_rent > 0);
    2 * token_account_rent + env.rent(165) + accumulator_rent
}

#[test]
fn pool_buy_needs_exactly_the_peak_rent_and_the_limit_covers_it() {
    for token_program in [TOKEN, TOKEN_2022] {
        let peak = pool_buy_rent_peak(token_program);
        assert!(peak <= rung::MAX_RENT_RESERVE_LAMPORTS, "peak {peak} above the reserve limit");

        // One lamport short: the buy cannot pay for the volume account.
        let mut env = AmmEnv::with_token_program(token_program);
        let mut spec = env.spec();
        spec.rent_reserve = peak - 1;
        assert_ok(&env.open_order(&spec));
        let before = env.state();
        assert_code(&env.try_rung(0), SYSTEM_NOT_ENOUGH_LAMPORTS);
        assert_eq!(env.state(), before.session_paid(SIG_FEE));
        assert_eq!(env.order(&env.user.pubkey()).unwrap().status, OrderStatus::Open);

        // Exactly the peak: it fills and the vault ends empty.
        let mut env = AmmEnv::with_token_program(token_program);
        let mut spec = env.spec();
        spec.rent_reserve = peak;
        assert_ok(&env.open_order(&spec));
        assert_ok(&env.try_rung(0));
        let user = env.user.pubkey();
        assert_eq!(env.order(&user).unwrap().status, OrderStatus::Filled);
        assert_eq!(env.balance(&vault_pda(&user)), 0);
    }
}

// --- Refund and cancel while a wrapped SOL account of the vault exists -----------------

/// Anyone can open the vault's wrapped SOL account and put SOL in it. Refund
/// and cancel return the order's SOL in full and do not touch that account;
/// the next pool buy hands its content to the user.
#[test]
fn refund_and_cancel_ignore_a_donated_wsol_account() {
    for cancel in [false, true] {
        let mut env = opened();
        let user = env.user.pubkey();
        let vault = vault_pda(&user);
        let vault_wsol = env.vault_wsol_ata(&user);
        let donated = 5_000_000;
        env.set_quote_account(&vault_wsol, &vault, donated);
        let wsol_before = env.state().vault_wsol;
        let wsol_lamports = env.balance(&vault_wsol);
        let order_rent = env.balance(&order_pda(&user));
        let u1 = env.balance(&user);

        if cancel {
            let user_kp = env.user.insecure_clone();
            assert_ok(&env.cancel(&user_kp));
            assert_eq!(env.balance(&user), u1 + AMOUNT + AMM_RENT_RESERVE + order_rent - SIG_FEE);
        } else {
            let session = env.session.insecure_clone();
            assert_ok(&env.refund(&session, &user));
            assert_eq!(env.balance(&user), u1 + AMOUNT + AMM_RENT_RESERVE + order_rent);
        }
        assert!(env.order(&user).is_none());
        assert_eq!(env.balance(&vault), 0);
        assert_eq!(env.state().vault_wsol, wsol_before, "cancel: {cancel}");

        // A later pool order: the donated SOL ends with the user.
        env.open_default();
        let u2 = env.balance(&user);
        assert_ok(&env.try_rung(0));
        let user_ata_rent = env.balance(&env.user_ata(&user));
        let accumulator_rent = env.balance(&amm_accumulator_pda(&vault));
        assert_eq!(env.balance(&user), u2 + AMM_RENT_RESERVE - user_ata_rent - accumulator_rent + wsol_lamports);
        assert!(!env.exists(&vault_wsol));
    }
}

// --- A new order on the other venue ---------------------------------------------------

/// After a pool fill the same user opens a curve order: the order account is
/// rewritten, the pool's accounts no longer pass, and the curve buy fills.
#[test]
fn a_curve_order_after_a_pool_fill_starts_clean() {
    let mut env = opened();
    let user = env.user.pubkey();
    assert_ok(&env.try_rung(0));
    let from_pool = env.order(&user).unwrap().tokens_bought;
    assert_eq!(env.order(&user).unwrap().venue, Venue::PumpSwap);

    env.env.open_default();
    let order = env.order(&user).unwrap();
    assert_eq!((order.venue, order.status), (Venue::Curve, OrderStatus::Open));
    assert_eq!((order.tokens_bought, order.lamports_spent, order.filled_rung), (0, 0, 0));

    let session = env.session.insecure_clone();
    let pool_accounts = env.try_accounts();
    let before = env.state();
    assert_rung_err(&env.try_rung_with(&session, &pool_accounts, 0), RungError::WrongBuyProgram);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));

    assert_ok(&env.env.try_rung(0));
    let order = env.order(&user).unwrap();
    assert_eq!(order.status, OrderStatus::Filled);
    assert_eq!(env.tokens(&env.user_ata(&user)), Some(from_pool + order.tokens_bought));
    assert_eq!(env.balance(&vault_pda(&user)), 0);
}

/// The other way round: a pool order after a curve fill.
#[test]
fn a_pool_order_after_a_curve_fill_starts_clean() {
    let mut env = AmmEnv::new();
    let user = env.user.pubkey();
    env.env.open_default();
    assert_ok(&env.env.try_rung(0));
    let from_curve = env.order(&user).unwrap().tokens_bought;
    assert_eq!(env.order(&user).unwrap().venue, Venue::Curve);

    env.open_default();
    let order = env.order(&user).unwrap();
    assert_eq!((order.venue, order.status), (Venue::PumpSwap, OrderStatus::Open));
    assert_eq!((order.tokens_bought, order.lamports_spent, order.filled_rung), (0, 0, 0));

    let session = env.session.insecure_clone();
    let curve_accounts = env.env.try_accounts();
    let before = env.state();
    assert_rung_err(&env.try_rung_with(&session, &curve_accounts, 0), RungError::WrongBuyProgram);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));

    assert_ok(&env.try_rung(0));
    let order = env.order(&user).unwrap();
    assert_eq!(order.status, OrderStatus::Filled);
    assert_eq!(env.tokens(&env.user_ata(&user)), Some(from_curve + order.tokens_bought));
    assert_eq!(env.balance(&vault_pda(&user)), 0);
}

/// An open order cannot be replaced by one on the other venue.
#[test]
fn an_open_order_cannot_be_reopened_on_the_other_venue() {
    let mut env = opened();
    let spec = env.env.spec();
    let before = env.state();
    assert_rung_err(&env.env.open_order(&spec), RungError::OrderAlreadyOpen);
    assert_eq!(env.state(), before.user_paid(SIG_FEE));
    assert_eq!(env.order(&env.user.pubkey()).unwrap().venue, Venue::PumpSwap);
}
