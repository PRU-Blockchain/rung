//! Scenario (a) with a Token-2022 mint: the ladder, the buy CPI, the token
//! transfer to the user and the closing of the vault's token account must work
//! for both token programs.

mod common;

use common::*;
use rung::state::OrderStatus;
use solana_signer::Signer;

#[test]
fn token_2022_second_rung_fills_after_first_rung_fails() {
    let mut env = Env::with_token_program(TOKEN_2022);
    let user = env.user.pubkey();
    let vault = vault_pda(&user);
    env.open_default();
    let u1 = env.balance(&user);
    let order = env.order(&user).unwrap();

    let vq_up = quote_reserves_up(VIRTUAL_QUOTE, 200);
    env.set_price(VIRTUAL_TOKEN, vq_up);
    let tokens_now = mock_quote(AMOUNT, VIRTUAL_TOKEN, vq_up);
    assert!(tokens_now < min_tokens(&order, 0));
    assert!(tokens_now >= min_tokens(&order, 1));

    let before = env.state();
    assert_code(&env.try_rung(0), PUMP_SLIPPAGE);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));

    env.warp(order.start_slot + WINDOW);
    assert_ok(&env.try_rung(1));

    let user_ata = env.user_ata(&user);
    let account = env.svm.get_account(&user_ata).unwrap();
    assert_eq!(account.owner, TOKEN_2022);
    assert_eq!(env.tokens(&user_ata), Some(tokens_now));
    assert!(!env.exists(&env.vault_ata(&user)));
    assert_eq!(env.balance(&vault), 0);
    // Token-2022 token accounts are larger (extensions), so read the rent back.
    let user_ata_rent = account.lamports;
    assert_eq!(user_ata_rent, env.rent(account.data.len()));
    let accumulator_rent = env.balance(&accumulator_pda(&vault));
    assert_eq!(env.balance(&user), u1 + RENT_RESERVE - user_ata_rent - accumulator_rent);

    let filled = env.order(&user).unwrap();
    assert_eq!(filled.status, OrderStatus::Filled);
    assert_eq!(filled.filled_rung, 1);
    assert_eq!(filled.tokens_bought, tokens_now);
}
