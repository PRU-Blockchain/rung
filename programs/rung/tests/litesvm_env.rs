//! Facts about the LiteSVM 0.10 environment that the other tests rely on:
//! which SPL programs are preloaded, that failed transactions still pay the
//! fee, how a fee payer runs out, and that `warp_to_slot` moves the clock.
//! None of these touch Rung.

mod common;

use common::*;
use litesvm::LiteSVM;
use solana_signer::Signer;
use solana_transaction_error::TransactionError;

#[test]
fn spl_token_token_2022_and_ata_programs_are_preloaded() {
    let svm = LiteSVM::new();
    for program in [TOKEN, TOKEN_2022, ATA_PROGRAM] {
        let account = svm.get_account(&program).expect("program is loaded");
        assert!(account.executable, "{program} is not executable");
    }
}

#[test]
fn warp_to_slot_moves_the_clock() {
    let mut env = Env::new();
    assert_eq!(env.slot(), START_SLOT);
    env.warp(START_SLOT + 7);
    assert_eq!(env.slot(), START_SLOT + 7);
}

#[test]
fn failed_transaction_still_pays_the_fee() {
    let mut env = Env::new();
    let payer = env.new_funded_keypair(1_000_000_000);
    let buyer_ata = ata(&payer.pubkey(), &env.mint, &TOKEN);
    env.create_token_account(&buyer_ata, &env.mint.clone(), &payer.pubkey(), 0, TOKEN);
    let before = env.balance(&payer.pubkey());
    let ix = mock_buy_ix(&payer.pubkey(), &env.mint, &TOKEN, AMOUNT, u64::MAX);
    assert_code(&env.send(&[ix], &payer, &[]), PUMP_SLIPPAGE);
    assert_eq!(env.balance(&payer.pubkey()), before - SIG_FEE);
}

/// A fee payer may not drop from rent-exempt to below the rent-exempt minimum
/// of an empty account (890,880 lamports). A session key funded with
/// `fee_budget` therefore can pay `floor((fee_budget - 890,880) / 5,000)`
/// fees, and the next transaction is rejected before it runs.
#[test]
fn fee_payer_cannot_drop_below_rent_exemption() {
    let mut env = Env::new();
    let min = env.rent(0);
    assert_eq!(min, 890_880);
    let payer = env.new_funded_keypair(min + SIG_FEE);
    let other = solana_keypair::Keypair::new().pubkey();

    // First fee fits exactly (balance ends at the minimum).
    assert_ok(&env.transfer(&payer, &other, 0));
    assert_eq!(env.balance(&payer.pubkey()), min);

    let res = env.transfer(&payer, &other, 0);
    assert_eq!(
        res.unwrap_err().err,
        TransactionError::InsufficientFundsForRent { account_index: 0 }
    );
    assert_eq!(env.balance(&payer.pubkey()), min, "a rejected transaction charges nothing");
}

/// LiteSVM 0.10 checks rent-state transitions only for accounts that hold
/// data (and for the fee payer); see `check_accounts_rent` in its `lib.rs`.
/// So funding a fresh, data-less account (a session key, the vault) with less
/// than 890,880 lamports passes here. The real runtime rejects the same
/// transaction with `InsufficientFundsForRent`, so these tests cannot catch a
/// `fee_budget` (or vault balance) below that minimum; the tests use amounts
/// above it.
#[test]
fn litesvm_does_not_check_rent_of_data_less_accounts() {
    let mut env = Env::new();
    let payer = env.new_funded_keypair(1_000_000_000);
    let fresh = solana_keypair::Keypair::new().pubkey();
    assert_ok(&env.transfer(&payer, &fresh, 10_000));
    assert_eq!(env.balance(&fresh), 10_000);
}
