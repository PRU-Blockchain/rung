//! Checks of the pump test double on its own, without Rung: a plain wallet
//! buys through it, its quote matches the harness copy, its slippage and
//! "curve complete" errors carry pump's codes, and its discriminator equals
//! the one in pump's IDL. These must pass before Rung's tests mean anything.

mod common;

use anchor_lang::Discriminator;
use common::*;
use solana_signer::Signer;

#[test]
fn discriminator_equals_pump_idl_value() {
    let idl_value: [u8; 8] = [225, 247, 80, 30, 213, 179, 132, 136];
    assert_eq!(mock_pump::instruction::BuyExactQuoteInV3::DISCRIMINATOR, &idl_value);
    assert_eq!(rung::venue::BUY_EXACT_QUOTE_IN_V3_DISCRIMINATOR, idl_value);
}

#[test]
fn error_codes_equal_pump_idl_values() {
    assert_eq!(u32::from(mock_pump::MockPumpError::BuySlippageBelowMinTokensOut), 6042);
    assert_eq!(u32::from(mock_pump::MockPumpError::BondingCurveComplete), 6005);
    assert_eq!(PUMP_SLIPPAGE, 6042);
}

#[test]
fn harness_quote_matches_the_double() {
    for (amount, vt, vq) in [
        (AMOUNT, VIRTUAL_TOKEN, VIRTUAL_QUOTE),
        (1_000_000, VIRTUAL_TOKEN, VIRTUAL_QUOTE),
        (500_000_000, 900_000_000_000_000, 45_000_000_000),
        (12_345, 1_000_000, 30_000),
    ] {
        assert_eq!(mock_quote(amount, vt, vq), mock_pump::quote_tokens_out(amount, vt, vq).unwrap());
    }
}

#[test]
fn wallet_buys_directly_and_receives_the_quoted_tokens() {
    let mut env = Env::new();
    let buyer = env.new_funded_keypair(1_000_000_000);
    let buyer_ata = ata(&buyer.pubkey(), &env.mint, &TOKEN);
    env.create_token_account(&buyer_ata, &env.mint.clone(), &buyer.pubkey(), 0, TOKEN);
    let quoted = mock_quote(AMOUNT, VIRTUAL_TOKEN, VIRTUAL_QUOTE);
    let net = AMOUNT as u128 * 10_000 / (10_000 + mock_pump::FEE_BPS as u128);
    let curve = curve_pda(&env.mint);
    let curve_lamports = env.balance(&curve);
    let buyer_lamports = env.balance(&buyer.pubkey());

    let ix = mock_buy_ix(&buyer.pubkey(), &env.mint, &TOKEN, AMOUNT, quoted);
    assert_ok(&env.send(&[ix], &buyer, &[]));

    assert_eq!(env.tokens(&buyer_ata), Some(quoted));
    assert_eq!(env.tokens(&ata(&curve, &env.mint, &TOKEN)), Some(CURVE_TOKENS - quoted));
    assert_eq!(env.balance(&curve), curve_lamports + AMOUNT);
    assert_eq!(env.reserves(), (VIRTUAL_TOKEN - quoted, VIRTUAL_QUOTE + net as u64));
    // The accumulator is created at 137 bytes and paid by the buyer.
    let acc = env.svm.get_account(&accumulator_pda(&buyer.pubkey())).unwrap();
    assert_eq!(acc.data.len(), 137);
    assert_eq!(acc.owner, PUMP);
    assert_eq!(acc.lamports, env.rent(137));
    assert_eq!(env.balance(&buyer.pubkey()), buyer_lamports - SIG_FEE - AMOUNT - env.rent(137));
}

#[test]
fn second_buy_does_not_pay_for_the_accumulator_again() {
    let mut env = Env::new();
    let buyer = env.new_funded_keypair(1_000_000_000);
    let buyer_ata = ata(&buyer.pubkey(), &env.mint, &TOKEN);
    env.create_token_account(&buyer_ata, &env.mint.clone(), &buyer.pubkey(), 0, TOKEN);
    let ix = mock_buy_ix(&buyer.pubkey(), &env.mint, &TOKEN, AMOUNT, 0);
    assert_ok(&env.send(&[ix], &buyer, &[]));
    let before = env.balance(&buyer.pubkey());
    let ix = mock_buy_ix(&buyer.pubkey(), &env.mint, &TOKEN, AMOUNT, 0);
    assert_ok(&env.send(&[ix], &buyer, &[]));
    assert_eq!(env.balance(&buyer.pubkey()), before - SIG_FEE - AMOUNT);
}

#[test]
fn min_tokens_out_one_above_the_quote_fails_with_6042() {
    let mut env = Env::new();
    let buyer = env.new_funded_keypair(1_000_000_000);
    let buyer_ata = ata(&buyer.pubkey(), &env.mint, &TOKEN);
    env.create_token_account(&buyer_ata, &env.mint.clone(), &buyer.pubkey(), 0, TOKEN);
    let quoted = mock_quote(AMOUNT, VIRTUAL_TOKEN, VIRTUAL_QUOTE);

    let ix = mock_buy_ix(&buyer.pubkey(), &env.mint, &TOKEN, AMOUNT, quoted + 1);
    assert_code(&env.send(&[ix], &buyer, &[]), PUMP_SLIPPAGE);
    assert_eq!(env.tokens(&buyer_ata), Some(0));
    assert_eq!(env.reserves(), (VIRTUAL_TOKEN, VIRTUAL_QUOTE));
}

#[test]
fn complete_curve_fails_with_6005() {
    let mut env = Env::new();
    let mint = env.mint;
    env.create_curve(&mint, VIRTUAL_TOKEN, VIRTUAL_QUOTE, true);
    let buyer = env.new_funded_keypair(1_000_000_000);
    let buyer_ata = ata(&buyer.pubkey(), &env.mint, &TOKEN);
    env.create_token_account(&buyer_ata, &mint, &buyer.pubkey(), 0, TOKEN);
    let ix = mock_buy_ix(&buyer.pubkey(), &env.mint, &TOKEN, AMOUNT, 0);
    assert_code(&env.send(&[ix], &buyer, &[]), 6005);
}

#[test]
fn cheat_switch_ignores_min_tokens_out_and_delivers_half() {
    let mut env = Env::new();
    env.set_cheat(true);
    let buyer = env.new_funded_keypair(1_000_000_000);
    let buyer_ata = ata(&buyer.pubkey(), &env.mint, &TOKEN);
    env.create_token_account(&buyer_ata, &env.mint.clone(), &buyer.pubkey(), 0, TOKEN);
    let quoted = mock_quote(AMOUNT, VIRTUAL_TOKEN, VIRTUAL_QUOTE);

    let ix = mock_buy_ix(&buyer.pubkey(), &env.mint, &TOKEN, AMOUNT, quoted);
    assert_ok(&env.send(&[ix], &buyer, &[]));
    assert_eq!(env.tokens(&buyer_ata), Some(quoted / 2));

    env.set_cheat(false);
    let (vt, vq) = env.reserves();
    let next = mock_quote(AMOUNT, vt, vq);
    let ix = mock_buy_ix(&buyer.pubkey(), &env.mint, &TOKEN, AMOUNT, next + 1);
    assert_code(&env.send(&[ix], &buyer, &[]), PUMP_SLIPPAGE);
}

#[test]
fn token_2022_wallet_buy_works() {
    let mut env = Env::with_token_program(TOKEN_2022);
    let buyer = env.new_funded_keypair(1_000_000_000);
    let buyer_ata = ata(&buyer.pubkey(), &env.mint, &TOKEN_2022);
    env.create_token_account(&buyer_ata, &env.mint.clone(), &buyer.pubkey(), 0, TOKEN_2022);
    let quoted = mock_quote(AMOUNT, VIRTUAL_TOKEN, VIRTUAL_QUOTE);
    let ix = mock_buy_ix(&buyer.pubkey(), &env.mint, &TOKEN_2022, AMOUNT, quoted);
    assert_ok(&env.send(&[ix], &buyer, &[]));
    assert_eq!(env.tokens(&buyer_ata), Some(quoted));
}
