//! Checks of the PumpSwap test double on its own, without Rung: its
//! discriminator, error codes, `Pool` layout and quote match the interface
//! found in pump's IDL and against the real program (`real_pumpswap.rs`), a
//! plain wallet buys through it with wrapped SOL, and its cheat switches work.
//! These must pass before Rung's PumpSwap tests mean anything.

mod common;

use anchor_lang::{prelude::Pubkey, pubkey, Discriminator};
use common::{amm::*, *};
use solana_signer::Signer;

#[test]
fn discriminator_equals_pumpswap_idl_value() {
    let idl_value: [u8; 8] = [194, 171, 28, 70, 104, 77, 91, 47];
    assert_eq!(mock_pump_amm::instruction::BuyExactQuoteInV2::DISCRIMINATOR, &idl_value);
    assert_eq!(BUY_EXACT_QUOTE_IN_V2, idl_value);
    assert_eq!(mock_pump_amm::POOL_DISCRIMINATOR, POOL_DISCRIMINATOR);
}

#[test]
fn error_codes_equal_pumpswap_idl_values() {
    assert_eq!(u32::from(mock_pump_amm::MockAmmError::BuySlippageBelowMinBaseAmountOut), 6040);
    assert_eq!(u32::from(mock_pump_amm::MockAmmError::CashbackCoinNotSupported), 6079);
    assert_eq!(AMM_SLIPPAGE, 6040);
}

#[test]
fn harness_quote_matches_the_double() {
    for (amount, base, quote) in [
        (AMOUNT, POOL_BASE, POOL_QUOTE),
        (1_000_000, POOL_BASE, POOL_QUOTE),
        (500_000_000, 130_814_685_142_676, 150_821_961_962),
        (12_345, 1_000_000, 30_000),
    ] {
        assert_eq!(mock_amm_quote(amount, base, quote), mock_pump_amm::quote_base_out(amount, base, quote).unwrap());
    }
}

/// The derivation checked on mainnet by `scripts/fetch-pumpswap-fixtures.mjs`
/// (docs/pump-arayuz.md K): mint 76fF…pump, pool C4E4…YUJr.
#[test]
fn canonical_pool_derivation_matches_the_mainnet_pool() {
    let mint = pubkey!("76fFhcA142kf9gdg11ahYTmEiZnPXokxJkcF1axupump");
    assert_eq!(pool_authority_pda(&mint), pubkey!("EBTqQ1g8NSPXorW6HcerzQABkdRmqrXXwMBLgSq3VRiX"));
    assert_eq!(canonical_pool(&mint), pubkey!("C4E4jTqFXTsCYD2UvRTXmSDDjrMuLZtwrnxNJo9XYUJr"));
    assert_eq!(amm_global_config_pda(), AMM_GLOBAL_CONFIG);
    assert_eq!(amm_fee_config_pda(), AMM_FEE_CONFIG);
}

#[test]
fn pool_layout_matches_the_double() {
    use mock_pump_amm::pool_offsets as o;
    let spec = PoolSpec {
        bump: 7,
        index: 0x0102,
        creator: Pubkey::new_unique(),
        base_mint: Pubkey::new_unique(),
        quote_mint: WSOL,
        pool_base_token_account: Pubkey::new_unique(),
        pool_quote_token_account: Pubkey::new_unique(),
        coin_creator: Pubkey::new_unique(),
        is_mayhem_mode: true,
        is_cashback_coin: false,
        virtual_quote_reserves: -5,
    };
    let d = pack_pool(&spec);
    assert_eq!(d.len(), o::LEN);
    assert_eq!(d[o::POOL_BUMP], 7);
    assert_eq!(d[o::INDEX..o::INDEX + 2], [0x02, 0x01]);
    assert_eq!(d[o::CREATOR..o::CREATOR + 32], spec.creator.to_bytes());
    assert_eq!(d[o::BASE_MINT..o::BASE_MINT + 32], spec.base_mint.to_bytes());
    assert_eq!(d[o::QUOTE_MINT..o::QUOTE_MINT + 32], WSOL.to_bytes());
    assert_eq!(d[o::POOL_BASE_TOKEN_ACCOUNT..o::POOL_BASE_TOKEN_ACCOUNT + 32], spec.pool_base_token_account.to_bytes());
    assert_eq!(d[o::POOL_QUOTE_TOKEN_ACCOUNT..o::POOL_QUOTE_TOKEN_ACCOUNT + 32], spec.pool_quote_token_account.to_bytes());
    assert_eq!(d[o::COIN_CREATOR..o::COIN_CREATOR + 32], spec.coin_creator.to_bytes());
    assert_eq!((d[o::IS_MAYHEM_MODE], d[o::IS_CASHBACK_COIN]), (1, 0));
    assert_eq!(i128::from_le_bytes(d[o::VIRTUAL_QUOTE_RESERVES..o::VIRTUAL_QUOTE_RESERVES + 16].try_into().unwrap()), -5);
}

/// A plain wallet with wrapped SOL buys from the double.
fn direct_buy(env: &mut AmmEnv, spendable: u64, min_out: u64) -> (solana_keypair::Keypair, litesvm::types::TransactionResult) {
    let buyer = env.new_funded_keypair(1_000_000_000);
    let me = buyer.pubkey();
    let (mint, tp, pool) = (env.mint, env.token_program, env.pool);
    let mut ixs = vec![create_ata_ix(&me, &me, &mint, &tp)];
    ixs.extend(wrap_sol_ixs(&me, spendable));
    ixs.push(anchor_lang::solana_program::instruction::Instruction {
        program_id: PUMP_SWAP,
        accounts: amm_buy_accounts(&me, &mint, &tp, &pool, &buyback_wsol_account(), true),
        data: amm_buy_data(spendable, min_out),
    });
    let res = env.send(&ixs, &buyer, &[]);
    (buyer, res)
}

#[test]
fn wallet_buys_directly_and_receives_the_quoted_tokens() {
    let mut env = AmmEnv::new();
    let quoted = mock_amm_quote(AMOUNT, POOL_BASE, POOL_QUOTE);
    let quote_lamports = env.balance(&env.pool.quote_token_account);
    let (buyer, res) = direct_buy(&mut env, AMOUNT, quoted);
    assert_ok(&res);
    let me = buyer.pubkey();
    assert_eq!(env.tokens(&ata(&me, &env.mint, &TOKEN)), Some(quoted));
    assert_eq!(env.tokens(&wsol_ata(&me)), Some(0), "spendable is spent in full");
    assert_eq!(env.tokens(&env.pool.base_token_account), Some(POOL_BASE - quoted));
    assert_eq!(env.tokens(&env.pool.quote_token_account), Some(POOL_QUOTE + AMOUNT));
    assert_eq!(env.balance(&env.pool.quote_token_account), quote_lamports + AMOUNT);
    let acc = env.svm.get_account(&amm_accumulator_pda(&me)).unwrap();
    assert_eq!((acc.owner, acc.data.len(), acc.lamports), (PUMP_SWAP, 137, env.rent(137)));
}

#[test]
fn slippage_fails_with_6040_and_moves_nothing() {
    let mut env = AmmEnv::new();
    let quoted = mock_amm_quote(AMOUNT, POOL_BASE, POOL_QUOTE);
    let pool_before = (env.tokens(&env.pool.base_token_account), env.tokens(&env.pool.quote_token_account));
    let (_, res) = direct_buy(&mut env, AMOUNT, quoted + 1);
    assert_code(&res, AMM_SLIPPAGE);
    assert_eq!((env.tokens(&env.pool.base_token_account), env.tokens(&env.pool.quote_token_account)), pool_before);
}

#[test]
fn quote_uses_effective_quote_reserves() {
    let mut env = AmmEnv::new();
    let v: i128 = -20_000_000_000;
    env.set_virtual_quote_reserves(v);
    assert_eq!(env.amm_reserves(), (POOL_BASE, POOL_QUOTE - 20_000_000_000));
    let quoted = mock_amm_quote(AMOUNT, POOL_BASE, POOL_QUOTE - 20_000_000_000);
    let (buyer, res) = direct_buy(&mut env, AMOUNT, quoted);
    assert_ok(&res);
    assert_eq!(env.tokens(&ata(&buyer.pubkey(), &env.mint, &TOKEN)), Some(quoted));
}

#[test]
fn cashback_pool_fails_with_6079_and_mayhem_pool_trades() {
    let mut env = AmmEnv::new();
    let address = env.pool.address;
    let mut spec = env.pool_spec();
    spec.is_cashback_coin = true;
    env.write_pool(&address, &spec);
    assert_code(&direct_buy(&mut env, AMOUNT, 1).1, AMM_CASHBACK_NOT_SUPPORTED);
    spec.is_cashback_coin = false;
    spec.is_mayhem_mode = true;
    env.write_pool(&address, &spec);
    assert_ok(&direct_buy(&mut env, AMOUNT, 1).1);
}

#[test]
fn cheat_switches_deliver_half_or_take_extra_lamports() {
    let mut env = AmmEnv::new();
    let quoted = mock_amm_quote(AMOUNT, POOL_BASE, POOL_QUOTE);
    env.set_amm_cheat(1);
    let (buyer, res) = direct_buy(&mut env, AMOUNT, quoted);
    assert_ok(&res);
    assert_eq!(env.tokens(&ata(&buyer.pubkey(), &env.mint, &TOKEN)), Some(quoted / 2));

    let mut env = AmmEnv::new();
    env.set_amm_cheat(2);
    let pool_lamports = env.balance(&env.pool.address);
    let (buyer, res) = direct_buy(&mut env, AMOUNT, quoted);
    assert_ok(&res);
    assert_eq!(env.tokens(&ata(&buyer.pubkey(), &env.mint, &TOKEN)), Some(quoted));
    assert_eq!(env.balance(&env.pool.address), pool_lamports + mock_pump_amm::OVERCHARGE_LAMPORTS);
}
