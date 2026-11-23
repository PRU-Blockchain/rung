//! PumpSwap security tests: `open_order` accepts only the canonical pool of
//! the order's mint and its own reserve accounts; `try_rung` fixes the pool,
//! the buyer, the mints, the buyer's token accounts and the program among the
//! 17 `buy_exact_quote_in_v2` accounts; venue mix-ups; an AMM that cheats; and
//! pre-filled vault token accounts. Each rejection checks the exact error and
//! that no balance or account changed (apart from the signer's fee).
//! Written before Rung's PumpSwap path exists.

mod common;

use anchor_lang::prelude::{AccountMeta, Pubkey};
use common::{amm::*, *};
use rung::{error::RungError, state::OrderStatus, Venue};
use solana_keypair::Keypair;
use solana_signer::Signer;

fn opened() -> AmmEnv {
    let mut env = AmmEnv::new();
    env.open_default();
    env
}

fn invalid_venue() -> u32 {
    rung_code(RungError::InvalidVenueAccount)
}

/// Opens the default PumpSwap order with `venue_state` and `remaining`,
/// expects `code`, and checks that only the user's fee moved.
#[track_caller]
fn assert_open_rejected(env: &mut AmmEnv, venue_state: &Pubkey, remaining: &[AccountMeta], code: u32) {
    let user = env.user.insecure_clone();
    let session = env.session.pubkey();
    // Quoted from the constants: some tests break the pool the env would read.
    let spec = amm_spec_at(AMOUNT, POOL_BASE, POOL_QUOTE);
    let before = env.state();
    let res = env.open_order_raw(&user, &session, venue_state, remaining, &spec);
    assert_code(&res, code);
    assert_eq!(env.state(), before.user_paid(SIG_FEE));
    assert!(env.order(&user.pubkey()).is_none());
}

fn reserves_of(pool: &AmmPool) -> Vec<AccountMeta> {
    vec![
        AccountMeta::new_readonly(pool.base_token_account, false),
        AccountMeta::new_readonly(pool.quote_token_account, false),
    ]
}

/// Sends `accounts` as the default session key, expects `code`, and checks
/// that only the key's fee moved.
#[track_caller]
fn assert_try_rejected(env: &mut AmmEnv, accounts: &TryRungAccounts, code: u32) {
    let session = env.session.insecure_clone();
    let before = env.state();
    let res = env.try_rung_with(&session, accounts, 0);
    assert_code(&res, code);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));
    assert_eq!(env.order(&env.user.pubkey()).unwrap().status, OrderStatus::Open);
}

// --- open_order: the pool -----------------------------------------------------

#[test]
fn open_order_accepts_the_canonical_pool() {
    let mut env = AmmEnv::new();
    assert_eq!(env.pool.address, canonical_pool(&env.mint));
    let spec = env.spec();
    assert_ok(&env.open_order(&spec));
    assert_eq!(env.order(&env.user.pubkey()).unwrap().venue, Venue::PumpSwap);
}

#[test]
fn open_order_rejects_a_pool_with_another_index() {
    let mut env = AmmEnv::new();
    let mint = env.mint;
    let pool = env.create_pool(&mint, 1, &pool_authority_pda(&mint), &WSOL, POOL_BASE, POOL_QUOTE, 0);
    assert_open_rejected(&mut env, &pool.address, &reserves_of(&pool), invalid_venue());
}

#[test]
fn open_order_rejects_a_pool_with_another_creator() {
    let mut env = AmmEnv::new();
    let mint = env.mint;
    let pool = env.create_pool(&mint, 0, &Keypair::new().pubkey(), &WSOL, POOL_BASE, POOL_QUOTE, 0);
    assert_open_rejected(&mut env, &pool.address, &reserves_of(&pool), invalid_venue());
}

#[test]
fn open_order_rejects_a_pool_not_owned_by_pumpswap() {
    let mut env = AmmEnv::new();
    let address = env.pool.address;
    let mut account = env.svm.get_account(&address).unwrap();
    account.owner = SYSTEM;
    env.svm.set_account(address, account).unwrap();
    let remaining = env.reserve_accounts();
    assert_open_rejected(&mut env, &address, &remaining, invalid_venue());
}

#[test]
fn open_order_rejects_a_pool_with_another_discriminator() {
    let mut env = AmmEnv::new();
    let address = env.pool.address;
    let mut account = env.svm.get_account(&address).unwrap();
    account.data[0] ^= 0xff;
    env.svm.set_account(address, account).unwrap();
    let remaining = env.reserve_accounts();
    assert_open_rejected(&mut env, &address, &remaining, invalid_venue());
}

#[test]
fn open_order_rejects_a_pool_too_short_for_its_token_accounts() {
    let mut env = AmmEnv::new();
    let address = env.pool.address;
    let mut account = env.svm.get_account(&address).unwrap();
    // Ends inside `pool_quote_token_account` (offset 171..203).
    account.data.truncate(202);
    env.svm.set_account(address, account).unwrap();
    let remaining = env.reserve_accounts();
    assert_open_rejected(&mut env, &address, &remaining, invalid_venue());
}

#[test]
fn open_order_rejects_a_pool_quoted_in_another_mint() {
    let mut env = AmmEnv::new();
    let mint = env.mint;
    // The same mint paired with USDC, at its own (index 0, pool authority) address.
    let usdc_pool = env.create_pool(&mint, 0, &pool_authority_pda(&mint), &USDC, POOL_BASE, POOL_QUOTE, 0);
    assert_open_rejected(&mut env, &usdc_pool.address, &reserves_of(&usdc_pool), invalid_venue());
    // The canonical address, but its data names another quote mint.
    let address = env.pool.address;
    let mut spec = env.pool_spec();
    spec.quote_mint = USDC;
    env.write_pool(&address, &spec);
    let remaining = env.reserve_accounts();
    assert_open_rejected(&mut env, &address, &remaining, invalid_venue());
}

#[test]
fn open_order_rejects_another_mints_pool() {
    let mut env = AmmEnv::new();
    let other = Keypair::new().pubkey();
    env.create_mint(&other, TOKEN);
    let other_pool = env.create_pool(&other, 0, &pool_authority_pda(&other), &WSOL, POOL_BASE, POOL_QUOTE, 0);
    assert_open_rejected(&mut env, &other_pool.address, &reserves_of(&other_pool), invalid_venue());
    // The canonical address of the order's mint, but its data names another base mint.
    let address = env.pool.address;
    let mut spec = env.pool_spec();
    spec.base_mint = other;
    env.write_pool(&address, &spec);
    let remaining = env.reserve_accounts();
    assert_open_rejected(&mut env, &address, &remaining, invalid_venue());
}

#[test]
fn open_order_rejects_the_bonding_curve_as_pumpswap_venue() {
    let mut env = AmmEnv::new();
    let curve = curve_pda(&env.mint);
    let remaining = env.reserve_accounts();
    assert_open_rejected(&mut env, &curve, &remaining, invalid_venue());
}

#[test]
fn curve_order_rejects_the_pool_as_venue() {
    // Venue mix-up the other way: a curve order names the pool.
    let mut env = AmmEnv::new();
    let mut spec = env.env.spec();
    spec.venue = Venue::Curve;
    let user = env.user.insecure_clone();
    let session = env.session.pubkey();
    let pool = env.pool.address;
    let before = env.state();
    let res = env.open_order_raw(&user, &session, &pool, &[], &spec);
    assert_rung_err(&res, RungError::InvalidVenueAccount);
    assert_eq!(env.state(), before.user_paid(SIG_FEE));
}

// --- open_order: the reserve accounts ------------------------------------------

#[test]
fn open_order_rejects_reserve_accounts_in_reverse_order() {
    let mut env = AmmEnv::new();
    let pool = env.pool;
    let remaining = vec![
        AccountMeta::new_readonly(pool.quote_token_account, false),
        AccountMeta::new_readonly(pool.base_token_account, false),
    ];
    assert_open_rejected(&mut env, &pool.address, &remaining, invalid_venue());
}

#[test]
fn open_order_rejects_another_pools_reserve_accounts() {
    let mut env = AmmEnv::new();
    let other = Keypair::new().pubkey();
    env.create_mint(&other, TOKEN);
    let other_pool = env.create_pool(&other, 0, &pool_authority_pda(&other), &WSOL, POOL_BASE, POOL_QUOTE * 2, 0);
    let pool = env.pool;
    assert_open_rejected(&mut env, &pool.address, &reserves_of(&other_pool), invalid_venue());
    // Only one of the two swapped.
    let mixed = vec![
        AccountMeta::new_readonly(pool.base_token_account, false),
        AccountMeta::new_readonly(other_pool.quote_token_account, false),
    ];
    assert_open_rejected(&mut env, &pool.address, &mixed, invalid_venue());
}

#[test]
fn open_order_rejects_missing_reserve_accounts() {
    let mut env = AmmEnv::new();
    let pool = env.pool;
    assert_open_rejected(&mut env, &pool.address, &[], invalid_venue());
    let one = vec![AccountMeta::new_readonly(pool.base_token_account, false)];
    assert_open_rejected(&mut env, &pool.address, &one, invalid_venue());
}

#[test]
fn open_order_rejects_a_reserve_account_not_owned_by_a_token_program() {
    let mut env = AmmEnv::new();
    let pool = env.pool;
    let mut account = env.svm.get_account(&pool.base_token_account).unwrap();
    account.owner = SYSTEM;
    env.svm.set_account(pool.base_token_account, account).unwrap();
    assert_open_rejected(&mut env, &pool.address, &reserves_of(&pool), invalid_venue());
}

#[test]
fn open_order_rejects_zero_or_negative_effective_quote_reserves() {
    for v in [-(POOL_QUOTE as i128), -(POOL_QUOTE as i128) - 1] {
        let mut env = AmmEnv::new();
        env.set_virtual_quote_reserves(v);
        let (pool, remaining) = (env.pool.address, env.reserve_accounts());
        assert_open_rejected(&mut env, &pool, &remaining, invalid_venue());
    }
}

#[test]
fn open_order_rejects_an_empty_base_reserve() {
    let mut env = AmmEnv::new();
    env.set_reserves(0, POOL_QUOTE);
    let (pool, remaining) = (env.pool.address, env.reserve_accounts());
    assert_open_rejected(&mut env, &pool, &remaining, invalid_venue());
}

// --- try_rung: the 17 accounts ---------------------------------------------------

#[test]
fn fake_amm_program_is_rejected_with_wrong_buy_program() {
    let mut env = opened();
    // A copy of the double at another address: same code, not PumpSwap.
    let fake = Keypair::new().pubkey();
    env.svm
        .add_program_from_file(fake, concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/mock_pump_amm.so"))
        .unwrap();
    let mut accounts = env.try_accounts();
    accounts.remaining[16] = AccountMeta::new_readonly(fake, false);
    assert_try_rejected(&mut env, &accounts, rung_code(RungError::WrongBuyProgram));
    // pump's curve program is not the AMM either.
    accounts.remaining[16] = AccountMeta::new_readonly(PUMP, false);
    assert_try_rejected(&mut env, &accounts, rung_code(RungError::WrongBuyProgram));
}

#[test]
fn another_pool_in_buy_accounts_is_rejected() {
    let mut env = opened();
    let mint = env.mint;
    // A non-canonical pool of the same mint (index 1), only position 0 swapped.
    let side = env.create_pool(&mint, 1, &pool_authority_pda(&mint), &WSOL, POOL_BASE, POOL_QUOTE, 0);
    let mut accounts = env.try_accounts();
    accounts.remaining[0] = AccountMeta::new(side.address, false);
    assert_try_rejected(&mut env, &accounts, rung_code(RungError::AccountMismatch));
    // The same pool with its own token accounts too.
    accounts.remaining[7] = AccountMeta::new(side.base_token_account, false);
    accounts.remaining[8] = AccountMeta::new(side.quote_token_account, false);
    assert_try_rejected(&mut env, &accounts, rung_code(RungError::AccountMismatch));
}

#[test]
fn buyer_other_than_vault_is_rejected() {
    let mut env = opened();
    let attacker = env.new_funded_keypair(1_000_000_000);
    let mut accounts = env.try_accounts();
    accounts.remaining[1] = AccountMeta::new(attacker.pubkey(), false);
    assert_try_rejected(&mut env, &accounts, rung_code(RungError::AccountMismatch));
}

#[test]
fn base_mint_other_than_the_orders_is_rejected() {
    let mut env = opened();
    let other = Keypair::new().pubkey();
    env.create_mint(&other, TOKEN);
    let mut accounts = env.try_accounts();
    accounts.remaining[3] = AccountMeta::new_readonly(other, false);
    assert_try_rejected(&mut env, &accounts, rung_code(RungError::AccountMismatch));
}

#[test]
fn quote_mint_other_than_wrapped_sol_is_rejected() {
    let mut env = opened();
    env.create_mint(&USDC, TOKEN);
    let mut accounts = env.try_accounts();
    accounts.remaining[4] = AccountMeta::new_readonly(USDC, false);
    assert_try_rejected(&mut env, &accounts, rung_code(RungError::AccountMismatch));
}

#[test]
fn base_token_account_other_than_vault_ata_is_rejected() {
    let mut env = opened();
    let attacker = env.new_funded_keypair(1_000_000_000);
    let attacker_ata = ata(&attacker.pubkey(), &env.mint, &TOKEN);
    let mint = env.mint;
    env.create_token_account(&attacker_ata, &mint, &attacker.pubkey(), 0, TOKEN);
    let mut accounts = env.try_accounts();
    accounts.remaining[5] = AccountMeta::new(attacker_ata, false);
    assert_try_rejected(&mut env, &accounts, rung_code(RungError::AccountMismatch));
    assert_eq!(env.tokens(&attacker_ata), Some(0));
}

#[test]
fn quote_token_account_other_than_vault_wsol_ata_is_rejected() {
    let mut env = opened();
    let user = env.user.pubkey();
    // The attacker's own funded wrapped SOL account: the buy would spend the
    // attacker's SOL but the vault's would be the "payment" Rung measures.
    let attacker = env.new_funded_keypair(1_000_000_000);
    let attacker_wsol = wsol_ata(&attacker.pubkey());
    env.set_quote_account(&attacker_wsol, &attacker.pubkey(), AMOUNT);
    let mut accounts = env.try_accounts();
    accounts.remaining[6] = AccountMeta::new(attacker_wsol, false);
    assert_try_rejected(&mut env, &accounts, rung_code(RungError::AccountMismatch));
    // A wrapped SOL account the vault owns but that is not its ATA.
    let other = Keypair::new().pubkey();
    env.set_quote_account(&other, &vault_pda(&user), 0);
    accounts.remaining[6] = AccountMeta::new(other, false);
    assert_try_rejected(&mut env, &accounts, rung_code(RungError::AccountMismatch));
    // The vault's ATA for the base mint in the quote position.
    accounts.remaining[6] = AccountMeta::new(env.vault_ata(&user), false);
    assert_try_rejected(&mut env, &accounts, rung_code(RungError::AccountMismatch));
}

#[test]
fn base_token_program_other_than_the_orders_is_rejected() {
    let mut env = opened();
    let mut accounts = env.try_accounts();
    accounts.remaining[9] = AccountMeta::new_readonly(TOKEN_2022, false);
    assert_try_rejected(&mut env, &accounts, rung_code(RungError::AccountMismatch));
}

/// Not in the original list: Rung itself calls the token program on the
/// vault's wrapped SOL account (create, sync_native, close) with the vault's
/// signature. If it took that program from position 10 unchecked, a session
/// key could put its own program there and receive the vault's signature.
#[test]
fn quote_token_program_other_than_spl_token_is_rejected() {
    let mut env = opened();
    let fake = Keypair::new().pubkey();
    env.svm
        .add_program_from_file(fake, concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/mock_pump_amm.so"))
        .unwrap();
    let mut accounts = env.try_accounts();
    for program in [fake, TOKEN_2022] {
        accounts.remaining[10] = AccountMeta::new_readonly(program, false);
        assert_try_rejected(&mut env, &accounts, rung_code(RungError::AccountMismatch));
    }
}

#[test]
fn sixteen_buy_accounts_are_rejected() {
    let mut env = opened();
    let mut accounts = env.try_accounts();
    accounts.remaining.remove(14);
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

// --- venue mix-ups -----------------------------------------------------------------

/// Assumption (same order as the curve's checks): the account count first,
/// then the program at position 16, then the other fixed positions.
#[test]
fn pumpswap_order_with_curve_buy_accounts_is_rejected() {
    let mut env = opened();
    let mut accounts = env.try_accounts();
    accounts.remaining = buy_accounts(&vault_pda(&env.user.pubkey()), &env.mint, &TOKEN, false);
    assert_try_rejected(&mut env, &accounts, rung_code(RungError::WrongBuyProgram));
}

#[test]
fn curve_order_with_pumpswap_buy_accounts_is_rejected() {
    let mut env = AmmEnv::new();
    let user = env.user.pubkey();
    let spec = env.env.spec();
    assert_ok(&env.env.open_order(&spec));
    assert_eq!(env.order(&user).unwrap().venue, Venue::Curve);
    let accounts = env.try_accounts();
    assert_try_rejected(&mut env, &accounts, rung_code(RungError::WrongBuyProgram));
}

// --- an AMM that cheats ---------------------------------------------------------------

#[test]
fn short_delivery_is_rejected_with_bought_less_than_minimum() {
    let mut env = opened();
    env.set_amm_cheat(1);
    let before = env.state();
    assert_rung_err(&env.try_rung(0), RungError::BoughtLessThanMinimum);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));
}

#[test]
fn amm_that_takes_more_sol_than_the_order_allows_is_rejected() {
    let mut env = opened();
    // Full tokens, so only the SOL check can catch it: the buy takes
    // `amount` in wrapped SOL plus the accumulator's rent plus 2,000,000.
    assert!(env.rent(mock_pump_amm::USER_VOLUME_ACCUMULATOR_LEN) + mock_pump_amm::OVERCHARGE_LAMPORTS > rung::MAX_BUY_RENT_LAMPORTS);
    env.set_amm_cheat(2);
    let before = env.state();
    assert_rung_err(&env.try_rung(0), RungError::BuyTookTooMuchSol);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));
}

// --- pre-filled vault token accounts ----------------------------------------------------

#[test]
fn short_delivery_into_prefilled_vault_ata_is_still_rejected() {
    let mut env = opened();
    let user = env.user.pubkey();
    let min = min_tokens(&env.order(&user).unwrap(), 0);
    let vault_ata = env.vault_ata(&user);
    let mint = env.mint;
    env.create_token_account(&vault_ata, &mint, &vault_pda(&user), min + 1, TOKEN);
    env.set_amm_cheat(1);
    assert!(mock_amm_quote(AMOUNT, POOL_BASE, POOL_QUOTE) / 2 < min, "precondition");
    let before = env.state();
    assert_rung_err(&env.try_rung(0), RungError::BoughtLessThanMinimum);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));
}

#[test]
fn prefilled_vault_ata_with_honest_amm_gives_the_user_everything() {
    let mut env = opened();
    let user = env.user.pubkey();
    let vault = vault_pda(&user);
    let u1 = env.balance(&user);
    let pre = 777_000;
    let vault_ata = env.vault_ata(&user);
    let mint = env.mint;
    env.create_token_account(&vault_ata, &mint, &vault, pre, TOKEN);
    let vault_ata_rent = env.balance(&vault_ata);
    let bought = mock_amm_quote(AMOUNT, POOL_BASE, POOL_QUOTE);
    assert_ok(&env.try_rung(0));
    assert_eq!(env.tokens(&env.user_ata(&user)), Some(pre + bought));
    assert_eq!(env.order(&user).unwrap().tokens_bought, bought, "only the increase counts");
    let user_ata_rent = env.balance(&env.user_ata(&user));
    let accumulator_rent = env.balance(&amm_accumulator_pda(&vault));
    assert_eq!(env.balance(&user), u1 + AMM_RENT_RESERVE - user_ata_rent - accumulator_rent + vault_ata_rent);
    assert_eq!(env.balance(&vault), 0);
}

/// Someone opened the vault's wrapped SOL ATA beforehand and put SOL in it.
/// The buy still spends exactly `amount`; what was there goes to the user.
#[test]
fn prefilled_vault_wsol_ata_ends_with_the_user() {
    let mut env = opened();
    let user = env.user.pubkey();
    let vault = vault_pda(&user);
    let u1 = env.balance(&user);
    let extra = 5_000_000;
    let vault_wsol = env.vault_wsol_ata(&user);
    env.set_quote_account(&vault_wsol, &vault, extra);
    let vault_wsol_lamports = env.balance(&vault_wsol);
    let bought = mock_amm_quote(AMOUNT, POOL_BASE, POOL_QUOTE);
    assert_ok(&env.try_rung(0));
    assert_eq!(env.tokens(&env.user_ata(&user)), Some(bought));
    assert_eq!(env.tokens(&env.pool.quote_token_account), Some(POOL_QUOTE + AMOUNT));
    assert!(!env.exists(&vault_wsol));
    let user_ata_rent = env.balance(&env.user_ata(&user));
    let accumulator_rent = env.balance(&amm_accumulator_pda(&vault));
    assert_eq!(env.balance(&user), u1 + AMM_RENT_RESERVE - user_ata_rent - accumulator_rent + vault_wsol_lamports);
    assert_eq!(env.balance(&vault), 0);
    // Assumption: as on the curve, `lamports_spent` is what the buy took.
    assert_eq!(env.order(&user).unwrap().lamports_spent, AMOUNT);
}

/// Wrapped SOL parked in the vault's account cannot stand in for tokens: the
/// floor is on tokens bought, measured as the increase.
#[test]
fn prefilled_vault_wsol_ata_does_not_hide_a_short_delivery() {
    let mut env = opened();
    let user = env.user.pubkey();
    let vault_wsol = env.vault_wsol_ata(&user);
    env.set_quote_account(&vault_wsol, &vault_pda(&user), 50_000_000);
    env.set_amm_cheat(1);
    let before = env.state();
    assert_rung_err(&env.try_rung(0), RungError::BoughtLessThanMinimum);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));
    assert_eq!(env.tokens(&vault_wsol), Some(50_000_000));
}

/// With no rent reserve the vault holds exactly `amount` and cannot also pay
/// for the token accounts and the volume accumulator: the try fails (pinned:
/// the system program's `ResultWithNegativeLamports`, as on the curve) and the
/// order stays open.
#[test]
fn zero_rent_reserve_fails_the_try_and_keeps_the_order_open() {
    let mut env = AmmEnv::new();
    let mut spec = env.spec();
    spec.rent_reserve = 0;
    assert_ok(&env.open_order(&spec));
    let before = env.state();
    assert_code(&env.try_rung(0), SYSTEM_NOT_ENOUGH_LAMPORTS);
    assert_eq!(env.state(), before.session_paid(SIG_FEE));
    assert_eq!(env.order(&env.user.pubkey()).unwrap().status, OrderStatus::Open);
}

// --- Pool types the buy cannot serve (added after the second review) ----------

#[test]
fn open_order_rejects_a_cashback_pool() {
    // The v2 buy of PumpSwap fails on cashback pools (its error 6079), so an
    // order on one could never fill: refuse it before any SOL moves.
    let mut env = AmmEnv::new();
    let address = env.pool.address;
    let mut spec = env.pool_spec();
    spec.is_cashback_coin = true;
    env.write_pool(&address, &spec);
    let remaining = env.reserve_accounts();
    assert_open_rejected(&mut env, &address, &remaining, rung_code(RungError::VenueNotSupported));
}

#[test]
fn open_order_accepts_a_mayhem_pool() {
    // The real v2 buy went through with this flag set, so it is not refused.
    let mut env = AmmEnv::new();
    let address = env.pool.address;
    let mut spec = env.pool_spec();
    spec.is_mayhem_mode = true;
    env.write_pool(&address, &spec);
    env.open_default();
    let user = env.user.pubkey();
    assert_eq!(env.order(&user).unwrap().status, OrderStatus::Open);
}
