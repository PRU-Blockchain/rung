//! Test vectors for the TypeScript client (`client/test/vectors.json`).
//!
//! Builds Rung's instructions with the same Rust helpers the other tests use,
//! derives the PDAs, evaluates the program's math, and runs a few orders
//! against the pump test double to capture real logs and errors. Inputs are
//! fixed, so the file only changes when the program or the helpers change.
//! `client/test/*.test.ts` checks that the TS client produces the same bytes,
//! addresses, numbers and decoded events.

mod common;

use anchor_lang::{
    prelude::{AccountMeta, Pubkey},
    pubkey,
    solana_program::instruction::{error::InstructionError, Instruction},
};
use common::{amm::*, *};
use litesvm::types::TransactionResult;
use rung::{
    events::{OrderFilled, OrderOpened, OrderRefunded},
    venue::{raw_quote as program_raw_quote, CurveReserves},
    OpenOrderArgs, Venue,
};
use serde_json::{json, Value};
use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_transaction_error::TransactionError;

const PUMP_FEES: Pubkey = pubkey!("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn metas(accounts: &[AccountMeta]) -> Value {
    accounts
        .iter()
        .map(|m| json!({ "pubkey": m.pubkey.to_string(), "is_signer": m.is_signer, "is_writable": m.is_writable }))
        .collect()
}

fn ix_json(ix: &Instruction) -> Value {
    json!({ "program_id": ix.program_id.to_string(), "data": hex(&ix.data), "accounts": metas(&ix.accounts) })
}

fn key(byte: u8) -> Pubkey {
    Pubkey::new_from_array([byte; 32])
}

/// An environment whose user, session key and mint are fixed, so the logs
/// (which carry these keys) are the same on every run.
fn fixed_env(seed: u8) -> Env {
    let mut env = Env::new();
    env.user = Keypair::new_from_array([seed; 32]);
    env.session = Keypair::new_from_array([seed + 1; 32]);
    let mint = key(seed + 2);
    env.create_mint(&mint, TOKEN);
    env.create_curve(&mint, VIRTUAL_TOKEN, VIRTUAL_QUOTE, false);
    env.mint = mint;
    env.svm.airdrop(&env.user.pubkey(), USER_AIRDROP).unwrap();
    env
}

/// The PumpSwap counterpart of `fixed_env`: the AMM double, and a fixed mint
/// with its canonical pool at the default pool reserves.
fn fixed_amm_env(seed: u8) -> AmmEnv {
    let mut amm = AmmEnv::new();
    amm.env.user = Keypair::new_from_array([seed; 32]);
    amm.env.session = Keypair::new_from_array([seed + 1; 32]);
    let mint = key(seed + 2);
    amm.env.create_mint(&mint, TOKEN);
    amm.env.mint = mint;
    amm.pool = amm.create_pool(&mint, 0, &pool_authority_pda(&mint), &WSOL, POOL_BASE, POOL_QUOTE, 0);
    let user = amm.env.user.pubkey();
    amm.env.svm.airdrop(&user, USER_AIRDROP).unwrap();
    amm
}

/// Instructions and PDAs of a PumpSwap order with fixed inputs.
fn pumpswap_vectors(user: &Pubkey, session: &Pubkey, mint: &Pubkey) -> Value {
    let pool_with = |token_program: &Pubkey| {
        let address = canonical_pool(mint);
        AmmPool {
            address,
            base_token_account: ata(&address, mint, token_program),
            quote_token_account: ata(&address, &WSOL, &TOKEN),
        }
    };
    let (pool_spl, pool_2022) = (pool_with(&TOKEN), pool_with(&TOKEN_2022));
    let args = OpenOrderArgs {
        venue: Venue::PumpSwap,
        rungs_bps: vec![100, 300],
        amount: 100_000_000,
        rent_reserve: 6_362_320,
        fee_budget: 913_730,
        expected_tokens_seen: 85_649_916_388,
        raw_tokens_seen: 86_677_037_219,
        window_slots: 4,
        lifetime_slots: 150,
    };
    let reserves = [
        AccountMeta::new_readonly(pool_spl.base_token_account, false),
        AccountMeta::new_readonly(pool_spl.quote_token_account, false),
    ];
    let open = open_order_ix_with_remaining(user, session, mint, &pool_spl.address, args, &reserves);
    let vault = vault_pda(user);
    let try_ix = |token_program: &Pubkey, pool: &AmmPool| {
        let mut accounts = TryRungAccounts::new(session, user, mint, token_program);
        accounts.remaining = amm_buy_accounts(&vault, mint, token_program, pool, &buyback_wsol_account(), false);
        accounts.ix(1)
    };
    let direct = Instruction {
        program_id: PUMP_SWAP,
        accounts: amm_buy_accounts(user, mint, &TOKEN, &pool_spl, &buyback_wsol_account(), true),
        data: amm_buy_data(100_000_000, 85_649_916_388),
    };
    assert_eq!(amm_global_config_pda(), AMM_GLOBAL_CONFIG);
    assert_eq!(amm_fee_config_pda(), AMM_FEE_CONFIG);
    json!({
        "inputs": {
            "open_order_args": {
                "venue": "PumpSwap", "rungs_bps": [100, 300], "amount": "100000000",
                "rent_reserve": "6362320", "fee_budget": "913730",
                "expected_tokens_seen": "85649916388", "raw_tokens_seen": "86677037219",
                "window_slots": "4", "lifetime_slots": "150"
            },
            "try_rung_index": 1,
            "buyback_wallet": BUYBACK_RECIPIENT.to_string(),
            "direct_buy": { "spendable": "100000000", "min_tokens_out": "85649916388" }
        },
        "open_order": ix_json(&open),
        "try_rung_spl": ix_json(&try_ix(&TOKEN, &pool_spl)),
        "try_rung_2022": ix_json(&try_ix(&TOKEN_2022, &pool_2022)),
        "direct_buy": ix_json(&direct),
        "pdas": {
            "pool_authority": pool_authority_pda(mint).to_string(),
            "canonical_pool": pool_spl.address.to_string(),
            "pool_base_spl": pool_spl.base_token_account.to_string(),
            "pool_base_2022": pool_2022.base_token_account.to_string(),
            "pool_quote": pool_spl.quote_token_account.to_string(),
            "global_config": amm_global_config_pda().to_string(),
            "fee_config": amm_fee_config_pda().to_string(),
            "event_authority": amm_event_authority_pda().to_string(),
            "vault_accumulator": amm_accumulator_pda(&vault).to_string(),
            "vault_wsol": wsol_ata(&vault).to_string(),
            "buyback_wsol": buyback_wsol_account().to_string(),
        },
    })
}

fn logs_of(res: &TransactionResult) -> Vec<String> {
    match res {
        Ok(m) => m.logs.clone(),
        Err(f) => f.meta.logs.clone(),
    }
}

fn err_json(res: &TransactionResult) -> Value {
    match &res.as_ref().expect_err("expected a failed transaction").err {
        TransactionError::InstructionError(index, InstructionError::Custom(code)) => {
            json!({ "InstructionError": [index, { "Custom": code }] })
        }
        other => panic!("unexpected error {other:?}"),
    }
}

fn opened_json(e: &OrderOpened) -> Value {
    json!({
        "name": "OrderOpened",
        "user": e.user.to_string(),
        "sessionKey": e.session_key.to_string(),
        "mint": e.mint.to_string(),
        "venue": format!("{:?}", e.venue),
        "amount": e.amount.to_string(),
        "rungCount": e.rung_count,
        "rungsBps": e.rungs_bps[..e.rung_count as usize].to_vec(),
        "expectedTokensSeen": e.expected_tokens_seen.to_string(),
        "expectedTokensStart": e.expected_tokens_start.to_string(),
        "startSlot": e.start_slot.to_string(),
        "windowSlots": e.window_slots.to_string(),
        "lastSlot": e.last_slot.to_string(),
    })
}

fn filled_json(e: &OrderFilled) -> Value {
    json!({
        "name": "OrderFilled",
        "user": e.user.to_string(),
        "mint": e.mint.to_string(),
        "rungIndex": e.rung_index,
        "rungBps": e.rung_bps,
        "tokensBought": e.tokens_bought.to_string(),
        "lamportsSpent": e.lamports_spent.to_string(),
        "expectedTokensSeen": e.expected_tokens_seen.to_string(),
        "expectedTokensStart": e.expected_tokens_start.to_string(),
        "slot": e.slot.to_string(),
    })
}

fn refunded_json(e: &OrderRefunded) -> Value {
    json!({
        "name": "OrderRefunded",
        "user": e.user.to_string(),
        "mint": e.mint.to_string(),
        "reason": format!("{:?}", e.reason),
        "lamportsReturned": e.lamports_returned.to_string(),
        "slot": e.slot.to_string(),
    })
}

fn events_json(logs: &[String]) -> Value {
    let mut out: Vec<Value> = Vec::new();
    out.extend(events::<OrderOpened>(logs).iter().map(opened_json));
    out.extend(events::<OrderFilled>(logs).iter().map(filled_json));
    out.extend(events::<OrderRefunded>(logs).iter().map(refunded_json));
    Value::Array(out)
}

fn log_case(name: &str, res: &TransactionResult) -> Value {
    let logs = logs_of(res);
    json!({ "name": name, "logs": logs, "events": events_json(&logs) })
}

fn error_case(name: &str, res: &TransactionResult, program: &Pubkey, code: u32, kind: &str) -> Value {
    assert_code(res, code);
    json!({
        "name": name,
        "err": err_json(res),
        "logs": logs_of(res),
        "program_ids": ["ComputeBudget111111111111111111111111111111", rung::ID.to_string()],
        "expected": { "program": program.to_string(), "code": code, "kind": kind },
    })
}

#[test]
fn write_client_vectors() {
    // --- Instructions with fixed inputs ---------------------------------------
    let (user, session, mint) = (key(1), key(2), key(3));
    let args = OpenOrderArgs {
        venue: Venue::Curve,
        rungs_bps: vec![100, 200, 300],
        amount: 10_000_000,
        rent_reserve: 6_492_560,
        fee_budget: 919_130,
        expected_tokens_seen: 123_456_789_012,
        raw_tokens_seen: 125_000_000_000,
        window_slots: 4,
        lifetime_slots: 150,
    };
    let open = open_order_ix(&user, &session, &mint, &curve_pda(&mint), args);
    let mut try_spl = TryRungAccounts::new(&session, &user, &mint, &TOKEN);
    try_spl.remaining = buy_accounts(&vault_pda(&user), &mint, &TOKEN, false);
    let try_2022 = TryRungAccounts::new(&session, &user, &mint, &TOKEN_2022);
    let fee_config = Pubkey::find_program_address(&[b"fee_config", PUMP.as_ref()], &PUMP_FEES).0;
    assert_eq!(fee_config, PUMP_FEE_CONFIG);

    let instructions = json!({
        "inputs": {
            "user": user.to_string(),
            "session_key": session.to_string(),
            "mint": mint.to_string(),
            "buyback_recipient": BUYBACK_RECIPIENT.to_string(),
            "open_order_args": {
                "venue": "Curve", "rungs_bps": [100, 200, 300], "amount": "10000000",
                "rent_reserve": "6492560", "fee_budget": "919130",
                "expected_tokens_seen": "123456789012", "raw_tokens_seen": "125000000000",
                "window_slots": "4", "lifetime_slots": "150"
            },
            "try_rung_index": 2,
            "cu_limit": 200000
        },
        "open_order": ix_json(&open),
        "try_rung_spl": ix_json(&try_spl.ix(2)),
        "try_rung_2022": ix_json(&try_2022.ix(2)),
        "refund": ix_json(&refund_ix(&session, &user)),
        "cancel": ix_json(&cancel_ix(&user)),
        "cu_limit": ix_json(&cu_limit_ix(200_000)),
    });

    let pumpswap = pumpswap_vectors(&user, &session, &mint);

    let vault = vault_pda(&user);
    let pdas = json!({
        "order": order_pda(&user).to_string(),
        "vault": vault.to_string(),
        "bonding_curve": curve_pda(&mint).to_string(),
        "global": global_pda().to_string(),
        "event_authority": event_authority_pda().to_string(),
        "fee_config": fee_config.to_string(),
        "vault_accumulator": accumulator_pda(&vault).to_string(),
        "user_ata_spl": ata(&user, &mint, &TOKEN).to_string(),
        "user_ata_2022": ata(&user, &mint, &TOKEN_2022).to_string(),
        "vault_ata_spl": ata(&vault, &mint, &TOKEN).to_string(),
    });

    // --- Math ------------------------------------------------------------------
    let min_cases: Vec<Value> = [
        (1_000_000u64, 1_000_000u64, 100u16, 300u16),
        (1_000_000, 950_000, 300, 300),
        (1_000_000, 1_100_000, 100, 300),
        (10, 10, 100, 100),
        (123_456_789_012, 120_000_000_000, 200, 3_000),
        (u64::MAX, u64::MAX, 0, 0),
        (u64::MAX, 1, 1, u16::MAX),
    ]
    .iter()
    .map(|&(seen, start, rung, cap)| {
        json!({
            "seen": seen.to_string(), "start": start.to_string(), "rung_bps": rung, "cap_bps": cap,
            "min_tokens_at_seen_cap": rung::math::min_tokens_at(seen, cap).unwrap().to_string(),
            "min_tokens_for_rung": rung::math::min_tokens_for_rung(seen, start, rung, cap).unwrap().to_string(),
        })
    })
    .collect();
    let raw_cases: Vec<Value> = [
        (10_000u64, 1_000_000u64, 30_000u64),
        (AMOUNT, VIRTUAL_TOKEN, VIRTUAL_QUOTE),
        (1_000_000, 774_376_454_879_262, 41_568_929_187),
    ]
    .iter()
    .map(|&(lamports, vt, vq)| {
        let reserves = CurveReserves { virtual_token_reserves: vt, virtual_quote_reserves: vq, complete: false };
        json!({
            "lamports": lamports.to_string(), "virtual_token": vt.to_string(), "virtual_quote": vq.to_string(),
            "raw_quote": program_raw_quote(lamports, &reserves).unwrap().to_string(),
        })
    })
    .collect();

    // --- Logs and errors from orders against the pump double -----------------
    // Order A expects the fee-free quote: the double (1.25% fee) gives less, so
    // the 1% rung fails in pump and the 3% rung fills.
    let mut a = fixed_env(10);
    let (vt, vq) = a.reserves();
    let mut spec = OrderSpec::quoted_at(AMOUNT, vt, vq);
    spec.expected_tokens_seen = spec.raw_tokens_seen;
    let opened = a.open_order(&spec);
    assert_ok(&opened);
    let not_due = a.try_rung(1);
    let slippage = a.try_rung(0);
    a.warp(START_SLOT + WINDOW);
    let filled = a.try_rung(1);
    assert_ok(&filled);
    a.warp(START_SLOT + WINDOW + 1);
    let after_fill = a.try_rung(1);

    // Order B: the session key gives up; order C: the user cancels.
    let mut b = fixed_env(20);
    b.open_default();
    b.warp(START_SLOT + 2);
    let session = b.session.insecure_clone();
    let gave_up = b.refund(&session, &b.user.pubkey());
    assert_ok(&gave_up);
    let mut c = fixed_env(30);
    c.open_default();
    let user_c = c.user.insecure_clone();
    let cancelled = c.cancel(&user_c);
    assert_ok(&cancelled);

    // Order D, on the canonical pool (AMM double, 1.2% fee): the pool price
    // rises 2% after the order opens, so the 1% rung fails in PumpSwap (6040)
    // and the 3% rung fills.
    let mut d = fixed_amm_env(40);
    let spec = d.spec();
    let pool_opened = d.open_order(&spec);
    assert_ok(&pool_opened);
    d.set_reserves(POOL_BASE, quote_reserves_up(POOL_QUOTE, 200));
    let pool_slippage = d.try_rung(0);
    d.warp(START_SLOT + WINDOW);
    let pool_filled = d.try_rung(1);
    assert_ok(&pool_filled);

    let logs = json!([
        log_case("open_order", &opened),
        log_case("try_rung_filled", &filled),
        log_case("refund_gave_up", &gave_up),
        log_case("cancel", &cancelled),
        log_case("try_rung_slippage", &slippage),
        log_case("open_order_pumpswap", &pool_opened),
        log_case("try_rung_filled_pumpswap", &pool_filled),
    ]);
    let errors = json!([
        error_case("pump_slippage", &slippage, &PUMP, PUMP_SLIPPAGE, "slippage"),
        error_case("rung_not_due", &not_due, &rung::ID, rung_code(rung::error::RungError::RungNotDue), "rung"),
        error_case("order_filled", &after_fill, &rung::ID, rung_code(rung::error::RungError::OrderFilled), "order-filled"),
        error_case("pumpswap_slippage", &pool_slippage, &PUMP_SWAP, AMM_SLIPPAGE, "slippage"),
    ]);

    let out = json!({
        "about": "Written by programs/rung/tests/client_vectors.rs; do not edit by hand.",
        "instructions": instructions,
        "pdas": pdas,
        "pumpswap": pumpswap,
        "math": { "min_tokens": min_cases, "raw_quote": raw_cases },
        "logs": logs,
        "errors": errors,
    });
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../client/test/vectors.json");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, serde_json::to_string_pretty(&out).unwrap() + "\n").unwrap();
}
