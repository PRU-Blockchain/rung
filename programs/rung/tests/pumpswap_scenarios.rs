//! PumpSwap counterparts of the curve scenarios: the ladder fills on a later
//! rung through the AMM double, the rules shared with the curve (one buy,
//! timing, cap, expiry, session key) hold for a PumpSwap order, refund and
//! cancel, the two price references on pool reserves, effective quote
//! reserves, and a Token-2022 base mint. Rejections check the exact error and
//! that nothing else moved. Written before Rung's PumpSwap path exists.

mod common;

use common::{amm::*, *};
use rung::{error::RungError, math::min_tokens_at, state::OrderStatus, Venue};
use solana_signer::Signer;

fn opened() -> AmmEnv {
    let mut env = AmmEnv::new();
    env.open_default();
    env
}

// --- the ladder ---------------------------------------------------------------

#[test]
fn pumpswap_second_rung_fills_after_first_rung_fails() {
    let mut env = AmmEnv::new();
    let user = env.user.pubkey();
    let session = env.session.pubkey();
    let vault = vault_pda(&user);
    let u0 = env.balance(&user);

    let spec = env.open_default();
    let u1 = env.balance(&user);
    let order_rent = env.order_rent();
    assert_eq!(u1, u0 - SIG_FEE - order_rent - AMOUNT - AMM_RENT_RESERVE - FEE_BUDGET);
    assert_eq!(env.balance(&vault), AMOUNT + AMM_RENT_RESERVE);
    assert_eq!(env.balance(&session), FEE_BUDGET);
    let order = env.order(&user).unwrap();
    assert_eq!(order.venue, Venue::PumpSwap);
    assert_eq!(order.mint, env.mint);
    assert_eq!(order.expected_tokens_seen, spec.expected_tokens_seen);
    assert_eq!(order.expected_tokens_start, spec.expected_tokens_seen, "the price did not move");

    // The price rises 2% after the order was opened.
    let q_up = quote_reserves_up(POOL_QUOTE, 200);
    env.set_reserves(POOL_BASE, q_up);
    let tokens_now = mock_amm_quote(AMOUNT, POOL_BASE, q_up);
    assert!(tokens_now < min_tokens(&order, 0), "precondition: the 1% rung must fail");
    assert!(tokens_now >= min_tokens(&order, 1), "precondition: the 3% rung must pass");

    // Rung 0: PumpSwap rejects with its slippage error; the whole try is undone.
    let before = env.state();
    assert_code(&env.try_rung(0), AMM_SLIPPAGE);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));
    assert_eq!(env.order(&user).unwrap().status, OrderStatus::Open);
    assert!(!env.exists(&env.vault_wsol_ata(&user)), "no wrapped SOL account survives a failed try");

    // Rung 1 when it becomes due.
    env.warp(order.start_slot + WINDOW);
    let pool_quote_lamports = env.balance(&env.pool.quote_token_account);
    assert_ok(&env.try_rung(1));

    let user_ata = env.user_ata(&user);
    assert_eq!(env.tokens(&user_ata), Some(tokens_now));
    assert_eq!(env.tokens(&env.pool.base_token_account), Some(POOL_BASE - tokens_now));
    assert_eq!(env.tokens(&env.pool.quote_token_account), Some(q_up + AMOUNT));
    assert_eq!(env.balance(&env.pool.quote_token_account), pool_quote_lamports + AMOUNT);
    assert_eq!(env.balance(&vault), 0);
    assert!(!env.exists(&env.vault_ata(&user)), "vault token account is closed");
    assert!(!env.exists(&env.vault_wsol_ata(&user)), "vault wrapped SOL account is closed");
    let user_ata_rent = env.balance(&user_ata);
    let accumulator_rent = env.balance(&amm_accumulator_pda(&vault));
    assert_eq!(user_ata_rent, env.rent(165));
    assert_eq!(accumulator_rent, env.rent(mock_pump_amm::USER_VOLUME_ACCUMULATOR_LEN));
    // Everything the vault did not spend on the buy and the two accounts that
    // stay (the user's token account, the vault's volume accumulator) is back
    // with the user, to the lamport; the wrapped SOL account's rent included.
    assert_eq!(env.balance(&user), u1 + AMM_RENT_RESERVE - user_ata_rent - accumulator_rent);
    assert_eq!(env.balance(&session), FEE_BUDGET - 2 * SIG_FEE);

    let filled = env.order(&user).unwrap();
    assert_eq!(filled.status, OrderStatus::Filled);
    assert_eq!(filled.filled_rung, 1);
    assert_eq!(filled.tokens_bought, tokens_now);
    // Assumption, as on the curve: `lamports_spent` is the quote the buy took
    // (`amount`), not the rent of the accounts it created.
    assert_eq!(filled.lamports_spent, AMOUNT);
}

#[test]
fn pumpswap_fill_emits_order_filled() {
    let mut env = opened();
    let user = env.user.pubkey();
    let meta = assert_ok(&env.try_rung(0));
    let filled = events::<rung::events::OrderFilled>(&meta.logs);
    assert_eq!(filled.len(), 1);
    assert_eq!(filled[0].user, user);
    assert_eq!(filled[0].mint, env.mint);
    assert_eq!(filled[0].tokens_bought, mock_amm_quote(AMOUNT, POOL_BASE, POOL_QUOTE));
}

// --- rules shared with the curve, once for a PumpSwap order -----------------

#[test]
fn pumpswap_try_after_fill_is_rejected_with_order_filled() {
    let mut env = opened();
    let order = env.order(&env.user.pubkey()).unwrap();
    assert_ok(&env.try_rung(0));
    env.warp(order.start_slot + WINDOW);
    let before = env.state();
    assert_rung_err(&env.try_rung(1), RungError::OrderFilled);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));
}

#[test]
fn pumpswap_rung_not_due_is_rejected() {
    let mut env = opened();
    let before = env.state();
    assert_rung_err(&env.try_rung(1), RungError::RungNotDue);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));
}

#[test]
fn pumpswap_rung_above_cap_is_rejected() {
    let mut env = opened();
    let order = env.order(&env.user.pubkey()).unwrap();
    env.warp(order.start_slot + 2 * WINDOW);
    let before = env.state();
    assert_rung_err(&env.try_rung(2), RungError::RungAboveCap);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));
}

#[test]
fn pumpswap_expired_order_is_rejected() {
    let mut env = opened();
    let order = env.order(&env.user.pubkey()).unwrap();
    env.warp(order.last_slot);
    let before = env.state();
    assert_rung_err(&env.try_rung(0), RungError::OrderExpired);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));
}

#[test]
fn pumpswap_other_key_is_rejected_with_wrong_session_key() {
    let mut env = opened();
    let other = env.new_funded_keypair(1_000_000_000);
    let accounts = env.try_accounts_for(&other.pubkey(), &env.user.pubkey());
    let before = env.state();
    assert_rung_err(&env.try_rung_with(&other, &accounts, 0), RungError::WrongSessionKey);
    assert_eq!(env.state(), before);
}

// --- refund and cancel --------------------------------------------------------

#[test]
fn pumpswap_refund_after_expiry_returns_everything() {
    let mut env = AmmEnv::new();
    let user = env.user.pubkey();
    env.open_default();
    let u1 = env.balance(&user);
    let order_rent = env.order_rent();
    let order = env.order(&user).unwrap();
    // A failed try first: it leaves no wrapped SOL account behind.
    env.set_reserves(POOL_BASE, quote_reserves_up(POOL_QUOTE, 500));
    assert_code(&env.try_rung(0), AMM_SLIPPAGE);

    let stranger = env.new_funded_keypair(1_000_000_000);
    env.warp(order.last_slot);
    assert_ok(&env.refund(&stranger, &user));
    // The vault held only lamports: all of them, and the order's rent, return.
    assert_eq!(env.balance(&user), u1 + AMOUNT + AMM_RENT_RESERVE + order_rent);
    assert_eq!(env.balance(&vault_pda(&user)), 0);
    assert!(!env.exists(&order_pda(&user)));
    assert!(!env.exists(&env.vault_wsol_ata(&user)));
}

#[test]
fn pumpswap_cancel_returns_everything() {
    let mut env = opened();
    let user = env.user.insecure_clone();
    let u1 = env.balance(&user.pubkey());
    let order_rent = env.order_rent();
    assert_ok(&env.cancel(&user));
    assert_eq!(env.balance(&user.pubkey()), u1 - SIG_FEE + AMOUNT + AMM_RENT_RESERVE + order_rent);
    assert_eq!(env.balance(&vault_pda(&user.pubkey())), 0);
}

// --- the two references on pool reserves -------------------------------------

#[test]
fn pumpswap_cap_on_the_seen_price_binds_when_the_price_rose_before_open() {
    let mut env = AmmEnv::new();
    let user = env.user.pubkey();
    let spec = amm_spec_at(AMOUNT, POOL_BASE, POOL_QUOTE).with_rungs(&[100, 200]);
    let q_open = quote_reserves_up(POOL_QUOTE, 500);
    env.set_reserves(POOL_BASE, q_open);
    assert_ok(&env.open_order(&spec));

    let order = env.order(&user).unwrap();
    let start = expected_start(spec.expected_tokens_seen, spec.raw_tokens_seen, AMOUNT, POOL_BASE, q_open);
    assert_eq!(order.expected_tokens_start, start);
    assert!(start < spec.expected_tokens_seen);

    let tokens_now = mock_amm_quote(AMOUNT, POOL_BASE, q_open);
    assert!(tokens_now >= min_tokens_at(start, 100).unwrap(), "precondition: the 1% rung on the start price would pass");
    assert!(tokens_now < min_tokens_at(spec.expected_tokens_seen, 200).unwrap(), "precondition: above the 2% cap on the seen price");
    for (rung, slot) in [(0u8, order.start_slot), (1, order.start_slot + WINDOW)] {
        env.warp(slot);
        let before = env.state();
        assert_code(&env.try_rung(rung), AMM_SLIPPAGE);
        assert_eq!(env.state(), before.session_paid(SIG_FEE), "rung {rung}");
    }
}

#[test]
fn pumpswap_rungs_count_from_the_lower_price_when_the_price_fell_before_open() {
    let mut env = AmmEnv::new();
    let user = env.user.pubkey();
    let spec = amm_spec_at(AMOUNT, POOL_BASE, POOL_QUOTE);
    let q_open = POOL_QUOTE / 100 * 95;
    env.set_reserves(POOL_BASE, q_open);
    assert_ok(&env.open_order(&spec));
    let order = env.order(&user).unwrap();
    let start = expected_start(spec.expected_tokens_seen, spec.raw_tokens_seen, AMOUNT, POOL_BASE, q_open);
    assert_eq!(order.expected_tokens_start, start);
    assert!(start > spec.expected_tokens_seen);

    let q_try = quote_reserves_up(q_open, 150);
    env.set_reserves(POOL_BASE, q_try);
    let tokens_now = mock_amm_quote(AMOUNT, POOL_BASE, q_try);
    assert!(tokens_now >= spec.expected_tokens_seen);
    assert!(tokens_now < min_tokens(&order, 0));
    assert!(tokens_now >= min_tokens(&order, 1));

    assert_code(&env.try_rung(0), AMM_SLIPPAGE);
    env.warp(order.start_slot + WINDOW);
    assert_ok(&env.try_rung(1));
    assert_eq!(env.order(&user).unwrap().filled_rung, 1);
    assert_eq!(env.tokens(&env.user_ata(&user)), Some(tokens_now));
}

// --- effective quote reserves -------------------------------------------------

/// `Pool.virtual_quote_reserves` is signed. The start quote uses
/// `pool_quote_token_account.amount + virtual_quote_reserves`.
#[test]
fn pumpswap_start_quote_uses_effective_quote_reserves() {
    for v in [-30_000_000_000i128, 17_584_390_927] {
        let mut env = AmmEnv::new();
        let user = env.user.pubkey();
        // The app quoted on the raw vault balance (a client that ignores the field).
        let spec = amm_spec_at(AMOUNT, POOL_BASE, POOL_QUOTE);
        env.set_virtual_quote_reserves(v);
        let effective = u64::try_from(POOL_QUOTE as i128 + v).unwrap();
        assert_ok(&env.open_order(&spec));
        let order = env.order(&user).unwrap();
        assert_eq!(
            order.expected_tokens_start,
            expected_start(spec.expected_tokens_seen, spec.raw_tokens_seen, AMOUNT, POOL_BASE, effective),
            "virtual_quote_reserves {v}"
        );
        if v < 0 {
            // A lower effective quote reserve is a lower price: the 1% rung
            // fills at the price PumpSwap computes on the same reserves.
            assert_ok(&env.try_rung(0));
            assert_eq!(env.tokens(&env.user_ata(&user)), Some(mock_amm_quote(AMOUNT, POOL_BASE, effective)));
        }
    }
}

/// Pools written before an appended field existed are shorter; the missing
/// fields read as 0 / false (PUMP_SWAP_README). A pool that ends after
/// `is_cashback_coin` (245 bytes) has no `virtual_quote_reserves`.
#[test]
fn pumpswap_older_shorter_pool_reads_missing_virtual_reserves_as_zero() {
    let mut env = AmmEnv::new();
    let user = env.user.pubkey();
    let address = env.pool.address;
    let mut pool = env.svm.get_account(&address).unwrap();
    pool.data.truncate(245);
    env.svm.set_account(address, pool).unwrap();
    let spec = amm_spec_at(AMOUNT, POOL_BASE, POOL_QUOTE);
    assert_ok(&env.open_order(&spec));
    assert_eq!(env.order(&user).unwrap().expected_tokens_start, spec.expected_tokens_seen);
}

// --- Token-2022 base mint -----------------------------------------------------

#[test]
fn pumpswap_token_2022_second_rung_fills_after_first_rung_fails() {
    let mut env = AmmEnv::with_token_program(TOKEN_2022);
    let user = env.user.pubkey();
    let vault = vault_pda(&user);
    env.open_default();
    let u1 = env.balance(&user);
    let order = env.order(&user).unwrap();

    let q_up = quote_reserves_up(POOL_QUOTE, 200);
    env.set_reserves(POOL_BASE, q_up);
    let tokens_now = mock_amm_quote(AMOUNT, POOL_BASE, q_up);
    assert!(tokens_now < min_tokens(&order, 0));
    assert!(tokens_now >= min_tokens(&order, 1));
    let before = env.state();
    assert_code(&env.try_rung(0), AMM_SLIPPAGE);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));

    env.warp(order.start_slot + WINDOW);
    assert_ok(&env.try_rung(1));
    let user_ata = env.user_ata(&user);
    let account = env.svm.get_account(&user_ata).unwrap();
    assert_eq!(account.owner, TOKEN_2022);
    assert_eq!(env.tokens(&user_ata), Some(tokens_now));
    assert!(!env.exists(&env.vault_ata(&user)));
    assert!(!env.exists(&env.vault_wsol_ata(&user)));
    assert_eq!(env.balance(&vault), 0);
    let user_ata_rent = account.lamports;
    assert_eq!(user_ata_rent, env.rent(account.data.len()));
    let accumulator_rent = env.balance(&amm_accumulator_pda(&vault));
    assert_eq!(env.balance(&user), u1 + AMM_RENT_RESERVE - user_ata_rent - accumulator_rent);
    assert_eq!(env.order(&user).unwrap().tokens_bought, tokens_now);
}
