//! Security tests: forged buy accounts, token and SOL redirection, a pump that
//! cheats, stale keys and closed orders, refund and cancel targets, and the
//! rent the vault must cover. Each rejection checks the exact error and that
//! no balance or account changed (apart from the signer's fee).

mod common;

use anchor_lang::error::ErrorCode as AnchorError;
use anchor_lang::prelude::AccountMeta;
use common::*;
use rung::{error::RungError, state::OrderStatus};
use solana_keypair::Keypair;
use solana_signer::Signer;

fn opened() -> Env {
    let mut env = Env::new();
    env.open_default();
    env
}

/// Sends `accounts` as the default session key, expects `code`, and checks
/// that only the key's fee moved.
#[track_caller]
fn assert_try_rejected(env: &mut Env, accounts: &TryRungAccounts, code: u32) {
    let session = env.session.insecure_clone();
    let before = env.state();
    let res = env.try_rung_with(&session, accounts, 0);
    assert_code(&res, code);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));
    assert_eq!(env.order(&env.user.pubkey()).unwrap().status, OrderStatus::Open);
}

// --- forged buy accounts (remaining accounts) --------------------------------

#[test]
fn fake_pump_program_is_rejected_with_wrong_buy_program() {
    let mut env = opened();
    // A copy of the double at another address: same code, not pump.
    let fake = Keypair::new().pubkey();
    env.svm
        .add_program_from_file(fake, concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/mock_pump.so"))
        .unwrap();
    let mut accounts = env.try_accounts();
    accounts.remaining[16] = AccountMeta::new_readonly(fake, false);
    assert_try_rejected(&mut env, &accounts, rung_code(RungError::WrongBuyProgram));

    // Any other program too.
    accounts.remaining[16] = AccountMeta::new_readonly(TOKEN, false);
    assert_try_rejected(&mut env, &accounts, rung_code(RungError::WrongBuyProgram));
}

#[test]
fn buyer_other_than_vault_is_rejected() {
    let mut env = opened();
    let attacker = env.new_funded_keypair(1_000_000_000);
    // Only position 8 changes, so the check on 9 cannot hide a missing check on 8.
    let mut accounts = env.try_accounts();
    accounts.remaining[8] = AccountMeta::new(attacker.pubkey(), false);
    assert_try_rejected(&mut env, &accounts, rung_code(RungError::AccountMismatch));
    // Both 8 and 9 pointing at the attacker.
    accounts.remaining[9] = AccountMeta::new(ata(&attacker.pubkey(), &env.mint, &TOKEN), false);
    assert_try_rejected(&mut env, &accounts, rung_code(RungError::AccountMismatch));
}

#[test]
fn buyer_token_account_other_than_vault_ata_is_rejected() {
    let mut env = opened();
    let attacker = env.new_funded_keypair(1_000_000_000);
    let attacker_ata = ata(&attacker.pubkey(), &env.mint, &TOKEN);
    env.create_token_account(&attacker_ata, &env.mint.clone(), &attacker.pubkey(), 0, TOKEN);
    let mut accounts = env.try_accounts();
    accounts.remaining[9] = AccountMeta::new(attacker_ata, false);
    assert_try_rejected(&mut env, &accounts, rung_code(RungError::AccountMismatch));
}

#[test]
fn other_mint_in_buy_accounts_is_rejected() {
    let mut env = opened();
    let other_mint = Keypair::new().pubkey();
    env.create_mint(&other_mint, TOKEN);
    env.create_curve(&other_mint, VIRTUAL_TOKEN, VIRTUAL_QUOTE, false);
    let vault = vault_pda(&env.user.pubkey());
    let mut accounts = env.try_accounts();
    // A full, consistent account list for the other mint.
    accounts.remaining = buy_accounts(&vault, &other_mint, &TOKEN, false);
    assert_try_rejected(&mut env, &accounts, rung_code(RungError::AccountMismatch));
    // Only position 1 swapped.
    let mut accounts = env.try_accounts();
    accounts.remaining[1] = AccountMeta::new_readonly(other_mint, false);
    assert_try_rejected(&mut env, &accounts, rung_code(RungError::AccountMismatch));
}

#[test]
fn other_token_program_in_buy_accounts_is_rejected() {
    let mut env = opened();
    let mut accounts = env.try_accounts();
    accounts.remaining[3] = AccountMeta::new_readonly(TOKEN_2022, false);
    assert_try_rejected(&mut env, &accounts, rung_code(RungError::AccountMismatch));
}

#[test]
fn other_curve_in_buy_accounts_is_rejected() {
    let mut env = opened();
    let other_mint = Keypair::new().pubkey();
    env.create_mint(&other_mint, TOKEN);
    env.create_curve(&other_mint, VIRTUAL_TOKEN, VIRTUAL_QUOTE, false);
    let mut accounts = env.try_accounts();
    accounts.remaining[5] = AccountMeta::new(curve_pda(&other_mint), false);
    assert_try_rejected(&mut env, &accounts, rung_code(RungError::AccountMismatch));
}

#[test]
fn sixteen_buy_accounts_are_rejected() {
    let mut env = opened();
    let mut accounts = env.try_accounts();
    accounts.remaining.remove(13);
    assert_eq!(accounts.remaining.len(), 16);
    assert_try_rejected(&mut env, &accounts, rung_code(RungError::AccountMismatch));
}

#[test]
fn eighteen_buy_accounts_are_rejected() {
    let mut env = opened();
    let mut accounts = env.try_accounts();
    accounts.remaining.push(AccountMeta::new_readonly(Keypair::new().pubkey(), false));
    assert_eq!(accounts.remaining.len(), 18);
    assert_try_rejected(&mut env, &accounts, rung_code(RungError::AccountMismatch));
}

// --- token and SOL redirection ----------------------------------------------

#[test]
fn attacker_token_account_as_user_token_account_is_rejected() {
    let mut env = opened();
    let attacker = env.new_funded_keypair(1_000_000_000);
    let attacker_ata = ata(&attacker.pubkey(), &env.mint, &TOKEN);
    env.create_token_account(&attacker_ata, &env.mint.clone(), &attacker.pubkey(), 0, TOKEN);
    let mut accounts = env.try_accounts();
    accounts.user_token_account = attacker_ata;
    assert_try_rejected(&mut env, &accounts, rung_code(RungError::AccountMismatch));
    assert_eq!(env.tokens(&attacker_ata), Some(0));
}

#[test]
fn wrong_vault_token_account_is_rejected() {
    let mut env = opened();
    let attacker = env.new_funded_keypair(1_000_000_000);
    let mut accounts = env.try_accounts();
    accounts.vault_token_account = ata(&attacker.pubkey(), &env.mint, &TOKEN);
    assert_try_rejected(&mut env, &accounts, rung_code(RungError::AccountMismatch));
}

#[test]
fn other_mint_account_is_rejected_by_has_one() {
    let mut env = opened();
    let other_mint = Keypair::new().pubkey();
    env.create_mint(&other_mint, TOKEN);
    let mut accounts = env.try_accounts();
    accounts.mint = other_mint;
    // `has_one = mint @ AccountMismatch` on the order.
    assert_try_rejected(&mut env, &accounts, rung_code(RungError::AccountMismatch));
}

#[test]
fn try_rung_with_another_wallet_as_user_is_rejected_by_order_seeds() {
    let mut env = opened();
    let attacker = env.new_funded_keypair(1_000_000_000);
    let mut accounts = env.try_accounts();
    accounts.user = attacker.pubkey();
    accounts.user_token_account = ata(&attacker.pubkey(), &env.mint, &TOKEN);
    // The order PDA is derived from `user`; Anchor checks seeds before has_one.
    assert_try_rejected(&mut env, &accounts, anchor_code(AnchorError::ConstraintSeeds));
}

#[test]
fn try_rung_with_another_users_vault_is_rejected_by_vault_seeds() {
    let mut env = opened();
    let attacker = env.new_funded_keypair(1_000_000_000);
    let attacker_vault = vault_pda(&attacker.pubkey());
    let mut accounts = env.try_accounts();
    accounts.vault = attacker_vault;
    accounts.vault_token_account = ata(&attacker_vault, &env.mint, &TOKEN);
    accounts.remaining = buy_accounts(&attacker_vault, &env.mint, &TOKEN, false);
    assert_try_rejected(&mut env, &accounts, anchor_code(AnchorError::ConstraintSeeds));
}

#[test]
fn session_key_of_one_order_cannot_try_another_users_order() {
    let mut env = opened();
    // A second user with their own order and key.
    let user_b = env.new_funded_keypair(USER_AIRDROP);
    let key_b = Keypair::new();
    let spec = env.spec();
    assert_ok(&env.open_order_as(&user_b, &key_b.pubkey(), &spec));

    // Key B on A's order.
    let accounts = env.try_accounts_for(&key_b.pubkey(), &env.user.pubkey());
    let before_a = env.state();
    let res = env.try_rung_with(&key_b, &accounts, 0);
    assert_rung_err(&res, RungError::WrongSessionKey);
    assert_eq!(env.state(), before_a);

    // Key B with `user = B` but A's order account.
    let mut accounts = env.try_accounts_for(&key_b.pubkey(), &user_b.pubkey());
    accounts.order = order_pda(&env.user.pubkey());
    let before_a = env.state();
    let before_b = env.state_of(&user_b.pubkey(), &key_b.pubkey());
    let res = env.try_rung_with(&key_b, &accounts, 0);
    assert_anchor_err(&res, AnchorError::ConstraintSeeds);
    assert_eq!(env.state(), before_a);
    assert_eq!(env.state_of(&user_b.pubkey(), &key_b.pubkey()), before_b.session_paid(SIG_FEE));
}

// --- refund and cancel targets ----------------------------------------------

#[test]
fn refund_to_another_wallet_is_rejected_by_order_seeds() {
    let mut env = opened();
    let user = env.user.pubkey();
    let last = env.order(&user).unwrap().last_slot;
    env.warp(last);
    let attacker = env.new_funded_keypair(1_000_000_000);
    let ix = refund_ix_with(&attacker.pubkey(), &order_pda(&user), &attacker.pubkey(), &vault_pda(&user));
    let before = env.state();
    assert_anchor_err(&env.send(&[ix], &attacker, &[]), AnchorError::ConstraintSeeds);
    assert_eq!(env.state(), before);
}

#[test]
fn refund_with_another_users_vault_is_rejected_by_vault_seeds() {
    let mut env = opened();
    let user = env.user.pubkey();
    let last = env.order(&user).unwrap().last_slot;
    env.warp(last);
    let attacker = env.new_funded_keypair(1_000_000_000);
    let ix = refund_ix_with(&attacker.pubkey(), &order_pda(&user), &user, &vault_pda(&attacker.pubkey()));
    let before = env.state();
    assert_anchor_err(&env.send(&[ix], &attacker, &[]), AnchorError::ConstraintSeeds);
    assert_eq!(env.state(), before);
}

#[test]
fn session_key_cannot_refund_to_itself() {
    let mut env = opened();
    let user = env.user.pubkey();
    let session = env.session.insecure_clone();
    let ix = refund_ix_with(&session.pubkey(), &order_pda(&user), &session.pubkey(), &vault_pda(&user));
    let before = env.state();
    assert_anchor_err(&env.send(&[ix], &session, &[]), AnchorError::ConstraintSeeds);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));
}

#[test]
fn cancel_with_another_users_vault_is_rejected_by_vault_seeds() {
    let mut env = opened();
    let victim = env.user.pubkey();
    let attacker = env.new_funded_keypair(USER_AIRDROP);
    let spec = env.spec();
    assert_ok(&env.open_order_as(&attacker, &Keypair::new().pubkey(), &spec));
    // The attacker cancels its own order but names the victim's vault.
    let ix = cancel_ix_with(&attacker.pubkey(), &order_pda(&attacker.pubkey()), &vault_pda(&victim));
    let before = env.state();
    assert_anchor_err(&env.send(&[ix], &attacker, &[]), AnchorError::ConstraintSeeds);
    assert_eq!(env.state(), before);
}

// --- a pump that cheats -------------------------------------------------------

#[test]
fn short_delivery_is_rejected_with_bought_less_than_minimum() {
    let mut env = opened();
    env.set_cheat(true);
    let before = env.state();
    assert_rung_err(&env.try_rung(0), RungError::BoughtLessThanMinimum);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));
    assert_eq!(env.order(&env.user.pubkey()).unwrap().status, OrderStatus::Open);
}

#[test]
fn short_delivery_into_prefilled_vault_ata_is_still_rejected() {
    let mut env = opened();
    let user = env.user.pubkey();
    let order = env.order(&user).unwrap();
    let min = min_tokens(&order, 0);
    // The vault's token account already holds more than the minimum, so only
    // the increase can tell the short delivery apart.
    let vault_ata = env.vault_ata(&user);
    env.create_token_account(&vault_ata, &env.mint.clone(), &vault_pda(&user), min + 1, TOKEN);
    env.set_cheat(true);
    let delivered = mock_quote(AMOUNT, VIRTUAL_TOKEN, VIRTUAL_QUOTE) / 2;
    assert!(delivered < min, "precondition: the cheat delivers less than the minimum");

    let before = env.state();
    assert_rung_err(&env.try_rung(0), RungError::BoughtLessThanMinimum);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));
    assert_eq!(env.tokens(&vault_ata), Some(min + 1));
}

#[test]
fn prefilled_vault_ata_with_honest_pump_gives_the_user_everything() {
    let mut env = opened();
    let user = env.user.pubkey();
    let vault = vault_pda(&user);
    let u1 = env.balance(&user);
    let pre = 777_000;
    let vault_ata = env.vault_ata(&user);
    env.create_token_account(&vault_ata, &env.mint.clone(), &vault, pre, TOKEN);
    let vault_ata_rent = env.balance(&vault_ata);
    let bought = mock_quote(AMOUNT, VIRTUAL_TOKEN, VIRTUAL_QUOTE);

    assert_ok(&env.try_rung(0));
    assert_eq!(env.tokens(&env.user_ata(&user)), Some(pre + bought));
    assert!(!env.exists(&vault_ata));
    let order = env.order(&user).unwrap();
    // Assumption: `tokens_bought` is the measured increase, not the amount moved.
    assert_eq!(order.tokens_bought, bought);
    let user_ata_rent = env.balance(&env.user_ata(&user));
    let accumulator_rent = env.balance(&accumulator_pda(&vault));
    assert_eq!(
        env.balance(&user),
        u1 + RENT_RESERVE - user_ata_rent - accumulator_rent + vault_ata_rent
    );
    assert_eq!(env.balance(&vault), 0);
}

// --- stale keys and closed orders -------------------------------------------

#[test]
fn old_session_key_is_rejected_after_the_user_reopens() {
    let mut env = opened();
    assert_ok(&env.try_rung(0));
    let old_key = env.session.insecure_clone();
    let new_key = Keypair::new();
    let user = env.user.insecure_clone();
    let spec = env.spec();
    assert_ok(&env.open_order_as(&user, &new_key.pubkey(), &spec));

    let accounts = env.try_accounts_for(&old_key.pubkey(), &user.pubkey());
    let before = env.state_of(&user.pubkey(), &new_key.pubkey());
    let res = env.try_rung_with(&old_key, &accounts, 0);
    assert_rung_err(&res, RungError::WrongSessionKey);
    assert_eq!(env.state_of(&user.pubkey(), &new_key.pubkey()), before);
}

#[test]
fn second_open_order_while_open_is_rejected() {
    let mut env = opened();
    let spec = env.spec();
    let before = env.state();
    let order_before = env.order(&env.user.pubkey()).unwrap();
    let res = env.open_order(&spec);
    assert_rung_err(&res, RungError::OrderAlreadyOpen);
    assert_eq!(env.state(), before.user_paid(SIG_FEE));
    assert_eq!(env.order(&env.user.pubkey()).unwrap().start_slot, order_before.start_slot);
}

#[test]
fn second_refund_fails_with_account_not_initialized() {
    let mut env = opened();
    let session = env.session.insecure_clone();
    let user = env.user.pubkey();
    assert_ok(&env.refund(&session, &user));
    let before = env.state();
    assert_anchor_err(&env.refund(&session, &user), AnchorError::AccountNotInitialized);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));
}

#[test]
fn try_rung_after_refund_fails_with_account_not_initialized() {
    let mut env = opened();
    let session = env.session.insecure_clone();
    let user = env.user.pubkey();
    assert_ok(&env.refund(&session, &user));
    let before = env.state();
    assert_anchor_err(&env.try_rung(0), AnchorError::AccountNotInitialized);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));
}

#[test]
fn try_rung_after_cancel_fails_with_account_not_initialized() {
    let mut env = opened();
    let user = env.user.insecure_clone();
    assert_ok(&env.cancel(&user));
    let before = env.state();
    assert_anchor_err(&env.try_rung(0), AnchorError::AccountNotInitialized);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));
}

#[test]
fn try_rung_on_expired_order_is_rejected_with_order_expired() {
    let mut env = opened();
    let order = env.order(&env.user.pubkey()).unwrap();
    for slot in [order.last_slot, order.last_slot + 1_000] {
        env.warp(slot);
        let before = env.state();
        assert_rung_err(&env.try_rung(0), RungError::OrderExpired);
        assert_eq!(env.state(), before.session_paid(SIG_FEE));
    }
    // One slot earlier the same try goes through.
    env.warp(order.last_slot - 1);
    assert_ok(&env.try_rung(1));
}

#[test]
fn session_key_early_refund_returns_everything_to_the_user() {
    let mut env = Env::new();
    let user = env.user.pubkey();
    env.open_default();
    let u1 = env.balance(&user);
    let order_rent = env.order_rent();
    let session = env.session.insecure_clone();
    assert_ok(&env.refund(&session, &user));
    assert_eq!(env.balance(&user), u1 + AMOUNT + RENT_RESERVE + order_rent);
    assert_eq!(env.balance(&vault_pda(&user)), 0);
    assert!(!env.exists(&order_pda(&user)));
}

#[test]
fn filled_order_refund_before_expiry_is_rejected() {
    let mut env = opened();
    assert_ok(&env.try_rung(0));
    let user = env.user.pubkey();
    let stranger = env.new_funded_keypair(1_000_000_000);
    let session = env.session.insecure_clone();
    let before = env.state();
    assert_rung_err(&env.refund(&stranger, &user), RungError::OrderNotExpired);
    assert_eq!(env.state(), before);
    // Not even the session key may close a filled order early.
    assert_rung_err(&env.refund(&session, &user), RungError::OrderNotExpired);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));
}

#[test]
fn filled_order_refund_after_expiry_closes_the_order_and_pays_rent_to_the_user() {
    let mut env = opened();
    let user = env.user.pubkey();
    assert_ok(&env.try_rung(0));
    let order_lamports = env.balance(&order_pda(&user));
    let u2 = env.balance(&user);
    let last = env.order(&user).unwrap().last_slot;
    env.warp(last);
    let stranger = env.new_funded_keypair(1_000_000_000);
    let res = env.refund(&stranger, &user);
    let meta = assert_ok(&res);
    assert!(!env.exists(&order_pda(&user)));
    assert_eq!(env.balance(&user), u2 + order_lamports);
    assert!(
        events::<rung::events::OrderRefunded>(&meta.logs).is_empty(),
        "closing a filled order emits no refund event"
    );
}

#[test]
fn user_can_reopen_after_fill_and_fill_again() {
    let mut env = opened();
    let user = env.user.insecure_clone();
    assert_ok(&env.try_rung(0));
    let first = env.tokens(&env.user_ata(&user.pubkey())).unwrap();

    let new_key = Keypair::new();
    env.session = new_key.insecure_clone();
    env.warp(START_SLOT + 10);
    let spec = env.spec();
    assert_ok(&env.open_order(&spec));
    let order = env.order(&user.pubkey()).unwrap();
    assert_eq!(order.status, OrderStatus::Open);
    assert_eq!(order.session_key, new_key.pubkey());
    assert_eq!(order.start_slot, START_SLOT + 10);
    // Expectation, not stated in the spec: reopening clears the old fill data.
    assert_eq!(order.tokens_bought, 0, "fill data of the old order is cleared");
    let u1 = env.balance(&user.pubkey());

    let (vt, vq) = env.reserves();
    let second = mock_quote(AMOUNT, vt, vq);
    assert_ok(&env.try_rung(0));
    assert_eq!(env.tokens(&env.user_ata(&user.pubkey())), Some(first + second));
    // Token account and accumulator exist already: the whole reserve comes back.
    assert_eq!(env.balance(&user.pubkey()), u1 + RENT_RESERVE);
    assert_eq!(env.balance(&vault_pda(&user.pubkey())), 0);
    let order = env.order(&user.pubkey()).unwrap();
    assert_eq!(order.status, OrderStatus::Filled);
    assert_eq!(order.tokens_bought, second);
}

// --- rent the vault must cover ----------------------------------------------

/// With no rent reserve the vault holds exactly `amount`, which cannot also
/// pay for the user's and the vault's token accounts and the buyer's volume
/// accumulator. Pinned: the system program's `ResultWithNegativeLamports`
/// (custom error 1) when the last lamport move fails. If the handler adds its
/// own check before the CPI, update this pin to that error.
#[test]
fn zero_rent_reserve_fails_the_try_and_keeps_the_order_open() {
    let mut env = Env::new();
    let mut spec = env.spec();
    spec.rent_reserve = 0;
    assert_ok(&env.open_order(&spec));
    let before = env.state();
    assert_code(&env.try_rung(0), SYSTEM_NOT_ENOUGH_LAMPORTS);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));
    assert_eq!(env.order(&env.user.pubkey()).unwrap().status, OrderStatus::Open);
}
