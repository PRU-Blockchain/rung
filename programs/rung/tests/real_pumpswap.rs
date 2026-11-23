//! Rung against the REAL PumpSwap program (pump.fun's AMM), not the test double.
//!
//! `scripts/fetch-pumpswap-fixtures.mjs` dumps PumpSwap's executable from
//! mainnet and snapshots one live, canonical, SOL-paired pool (not mayhem, not
//! cashback) from a recent `buy_exact_quote_in_v2` into
//! `tests/fixtures/pumpswap/` (git-ignored). Without that folder every test
//! here prints a notice and returns, so a clean clone stays green.
//!
//! T1 environment check (plain wallet wraps SOL and buys directly) · T2 Rung
//! buys with the vault PDA as PumpSwap's `user` · T3 a tight rung fails with
//! PumpSwap's slippage error · T4 compute units and transaction size · T5
//! quote formula and real fee rate · T6 mayhem and cashback pools · T7 token
//! accounts that are not associated token accounts · T8 buyback recipient ·
//! T9 rent top-up of an older, shorter pool · T10 Rung buys a mint of the other
//! token program (the snapshot pool re-keyed to a new mint). T2-T4 and T10 need
//! Rung's PumpSwap path.
//! Run with `-- --nocapture` to see the numbers.

mod common;

use std::path::PathBuf;

use anchor_lang::{
    prelude::{AccountMeta, Pubkey},
    pubkey,
    solana_program::{clock::Clock, instruction::Instruction, rent::Rent},
};
use base64::Engine;
use common::{amm::*, *};
use litesvm::{types::TransactionResult, LiteSVM};
use rung::{state::OrderStatus, OpenOrderArgs, Venue};
use solana_account::Account;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;

const NATIVE_LOADER: Pubkey = pubkey!("NativeLoader1111111111111111111111111111111");
const SYSVAR_OWNER: Pubkey = pubkey!("Sysvar1111111111111111111111111111111111111");
/// Anchor `emit_cpi!` prefix of the self-CPI that carries an event.
const EVENT_IX_TAG: [u8; 8] = [0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d];
/// `BuyEvent` discriminator (idl/pump_amm.json).
const BUY_EVENT: [u8; 8] = [103, 244, 82, 31, 44, 245, 119, 119];
const SLOTS_PER_EPOCH: u64 = 432_000;
/// The 8 buyback fee recipient wallets (docs/pump-arayuz.md J, FEE_RECIPIENTS).
const BUYBACK_WALLETS: [Pubkey; 8] = [
    pubkey!("5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD"),
    pubkey!("9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7"),
    pubkey!("GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL"),
    pubkey!("3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR"),
    pubkey!("5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6"),
    pubkey!("EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL"),
    pubkey!("5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD"),
    pubkey!("A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW"),
];

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

fn fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/pumpswap")
}

fn b64(s: &str) -> Vec<u8> {
    base64::engine::general_purpose::STANDARD.decode(s).expect("base64")
}

fn pk(s: &str) -> Pubkey {
    s.parse().expect("pubkey")
}

fn u64_at(d: &[u8], o: usize) -> u64 {
    u64::from_le_bytes(d[o..o + 8].try_into().unwrap())
}

/// Length of an ELF64 file: the end of its section header table. `solana
/// program dump` writes the whole program-data area, zero padding included.
fn elf_len(bytes: &[u8]) -> usize {
    let shoff = u64_at(bytes, 0x28) as usize;
    let shentsize = u16::from_le_bytes([bytes[0x3a], bytes[0x3b]]) as usize;
    let shnum = u16::from_le_bytes([bytes[0x3c], bytes[0x3d]]) as usize;
    (shoff + shentsize * shnum).min(bytes.len())
}

struct Real {
    svm: LiteSVM,
    mint: Pubkey,
    token_program: Pubkey,
    pool: AmmPool,
    buyback: Pubkey,
    slot: u64,
}

impl Real {
    /// `None` (with a notice) when the fixtures are missing.
    fn load() -> Option<Self> {
        let dir = fixture_dir();
        if !dir.join("pump_amm.so").exists() || !dir.join("accounts.json").exists() {
            eprintln!(
                "fixtures missing: run `node scripts/fetch-pumpswap-fixtures.mjs` ({} not found); skipping",
                dir.display()
            );
            return None;
        }
        let json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join("accounts.json")).unwrap()).unwrap();
        let slot = json["accounts_slot"].as_u64().unwrap();
        let block_time = json["block_time"].as_i64().unwrap_or_else(|| json["source"]["block_time"].as_i64().unwrap());
        let buy: Vec<Pubkey> = json["buy_accounts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| pk(a["address"].as_str().unwrap()))
            .collect();
        assert_eq!(buy.len(), 17);

        let mut svm = LiteSVM::new().with_log_bytes_limit(None);
        for a in json["accounts"].as_array().unwrap() {
            if a["address"] == "SysvarRent111111111111111111111111111111111" && a["exists"] == true {
                let d = b64(a["data"].as_str().unwrap());
                #[allow(deprecated)]
                let rent = Rent {
                    lamports_per_byte_year: u64_at(&d, 0),
                    exemption_threshold: f64::from_le_bytes(d[8..16].try_into().unwrap()),
                    burn_percent: d[16],
                };
                svm.set_sysvar(&rent);
            }
        }
        svm.warp_to_slot(slot);
        let epoch = slot / SLOTS_PER_EPOCH;
        svm.set_sysvar(&Clock {
            slot,
            epoch_start_timestamp: block_time,
            epoch,
            leader_schedule_epoch: epoch + 1,
            unix_timestamp: block_time,
        });

        let rung_so = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy/rung.so");
        assert!(rung_so.exists(), "run `anchor build` first");
        svm.add_program_from_file(rung::ID, &rung_so).unwrap();
        let amm = std::fs::read(dir.join("pump_amm.so")).unwrap();
        if let Err(e) = svm.add_program(PUMP_SWAP, &amm) {
            let len = elf_len(&amm);
            eprintln!("pump_amm.so ({} bytes) did not load ({e:?}); retrying trimmed to {len} bytes", amm.len());
            svm.add_program(PUMP_SWAP, &amm[..len]).expect("pump_amm.so loads");
        }
        for a in json["accounts"].as_array().unwrap() {
            if a["exists"] != true || a["executable"] == true {
                continue;
            }
            let owner = pk(a["owner"].as_str().unwrap());
            if owner == NATIVE_LOADER || owner == SYSVAR_OWNER {
                continue;
            }
            svm.set_account(
                pk(a["address"].as_str().unwrap()),
                Account {
                    lamports: a["lamports"].as_u64().unwrap(),
                    data: b64(a["data"].as_str().unwrap()),
                    owner,
                    executable: false,
                    rent_epoch: a["rent_epoch"].as_str().and_then(|s| s.parse().ok()).unwrap_or(u64::MAX),
                },
            )
            .unwrap();
        }

        let mint = buy[3];
        let token_program = buy[9];
        let pool = AmmPool { address: buy[0], base_token_account: buy[7], quote_token_account: buy[8] };
        // The fixture's accounts are the ones our helpers derive (docs/pump-arayuz.md K).
        assert_eq!(buy[0], canonical_pool(&mint), "the trade's pool is the canonical pool of its mint");
        assert_eq!(buy[2], AMM_GLOBAL_CONFIG);
        assert_eq!(buy[2], amm_global_config_pda());
        assert_eq!(buy[4], WSOL);
        assert_eq!(buy[7], ata(&buy[0], &mint, &token_program));
        assert_eq!(buy[8], ata(&buy[0], &WSOL, &TOKEN));
        assert_eq!(buy[10], TOKEN);
        assert_eq!(buy[11], SYSTEM);
        assert_eq!(buy[12], amm_accumulator_pda(&buy[1]));
        assert_eq!(buy[13], AMM_FEE_CONFIG);
        assert_eq!(buy[13], amm_fee_config_pda());
        assert_eq!(buy[15], amm_event_authority_pda());
        assert_eq!(buy[16], PUMP_SWAP);
        let pool_data = svm.get_account(&buy[0]).unwrap().data;
        assert_eq!(pool_data[..8], POOL_DISCRIMINATOR);
        assert_eq!(Pubkey::new_from_array(pool_data[11..43].try_into().unwrap()), pool_authority_pda(&mint));
        let buyback = buy[14];
        let buyback_data = svm.get_account(&buyback).unwrap().data;
        let buyback_owner = Pubkey::new_from_array(buyback_data[32..64].try_into().unwrap());
        assert!(BUYBACK_WALLETS.contains(&buyback_owner), "buyback account belongs to a listed wallet");
        assert_eq!(buyback, wsol_ata(&buyback_owner));
        Some(Self { svm, mint, token_program, pool, buyback, slot })
    }

    fn rent(&self, len: usize) -> u64 {
        self.svm.minimum_balance_for_rent_exemption(len)
    }
    fn balance(&self, a: &Pubkey) -> u64 {
        self.svm.get_balance(a).unwrap_or(0)
    }
    fn account(&self, a: &Pubkey) -> Option<Account> {
        self.svm.get_account(a).filter(|x| x.lamports > 0)
    }
    fn tokens(&self, a: &Pubkey) -> Option<u64> {
        self.account(a).map(|x| token_amount(&x.data))
    }
    fn pool_data(&self) -> Vec<u8> {
        self.svm.get_account(&self.pool.address).unwrap().data
    }
    /// (base reserve, effective quote reserve, virtual_quote_reserves).
    fn reserves(&self) -> (u64, u64, i128) {
        let d = self.pool_data();
        let v = i128::from_le_bytes(d[245..261].try_into().unwrap());
        let base = self.tokens(&self.pool.base_token_account).unwrap();
        let quote = self.tokens(&self.pool.quote_token_account).unwrap();
        (base, u64::try_from(quote as i128 + v).unwrap(), v)
    }

    fn send(&mut self, ixs: &[Instruction], payer: &Keypair, others: &[&Keypair]) -> TransactionResult {
        self.svm.expire_blockhash();
        let mut signers = vec![payer];
        signers.extend_from_slice(others);
        let tx = Transaction::new_signed_with_payer(ixs, Some(&payer.pubkey()), &signers, self.svm.latest_blockhash());
        self.svm.send_transaction(tx)
    }

    fn wallet(&mut self, lamports: u64) -> Keypair {
        let kp = Keypair::new();
        self.svm.airdrop(&kp.pubkey(), lamports).unwrap();
        kp
    }

    fn buy_metas(&self, buyer: &Pubkey, signs: bool) -> Vec<AccountMeta> {
        amm_buy_accounts(buyer, &self.mint, &self.token_program, &self.pool, &self.buyback, signs)
    }

    fn buy_ix_with(&self, metas: Vec<AccountMeta>, spendable: u64, min_out: u64) -> Instruction {
        Instruction { program_id: PUMP_SWAP, accounts: metas, data: amm_buy_data(spendable, min_out) }
    }

    fn buy_ix(&self, buyer: &Pubkey, spendable: u64, min_out: u64) -> Instruction {
        self.buy_ix_with(self.buy_metas(buyer, true), spendable, min_out)
    }

    /// Base ATA, wrapped SOL ATA holding `spendable`, then the buy: what a
    /// plain wallet sends.
    fn direct_buy_ixs(&self, buyer: &Pubkey, spendable: u64, min_out: u64) -> Vec<Instruction> {
        let mut ixs = vec![cu_limit_ix(CU_LIMIT), create_ata_ix(buyer, buyer, &self.mint, &self.token_program)];
        ixs.extend(wrap_sol_ixs(buyer, spendable));
        ixs.push(self.buy_ix(buyer, spendable, min_out));
        ixs
    }

    /// Tokens a direct buy of `amount` returns now (simulated; nothing kept).
    fn real_quote(&mut self, amount: u64) -> u64 {
        let w = self.wallet(10_000_000_000);
        let ixs = self.direct_buy_ixs(&w.pubkey(), amount, 1);
        self.svm.expire_blockhash();
        let tx = Transaction::new_signed_with_payer(&ixs, Some(&w.pubkey()), &[&w], self.svm.latest_blockhash());
        let sim = self
            .svm
            .simulate_transaction(tx)
            .unwrap_or_else(|e| panic!("quote simulation failed: {:?}\n{}", e.err, e.meta.pretty_logs()));
        let a = ata(&w.pubkey(), &self.mint, &self.token_program);
        let acc = sim.post_accounts.iter().find(|(x, _)| *x == a).expect("ATA in post accounts");
        token_amount(&Account::from(acc.1.clone()).data)
    }

    fn order(&self, user: &Pubkey) -> rung::state::Order {
        let a = self.svm.get_account(&order_pda(user)).expect("order account");
        anchor_lang::AccountDeserialize::try_deserialize(&mut a.data.as_slice()).expect("order decodes")
    }
}

fn logs_of(res: &TransactionResult) -> String {
    match res {
        Ok(m) => m.pretty_logs(),
        Err(f) => f.meta.pretty_logs(),
    }
}

fn cu_of(res: &TransactionResult) -> u64 {
    match res {
        Ok(m) => m.compute_units_consumed,
        Err(f) => f.meta.compute_units_consumed,
    }
}

fn err_of(res: &TransactionResult) -> Option<String> {
    res.as_ref().err().map(|f| format!("{:?}", f.err))
}

#[track_caller]
fn ok(res: &TransactionResult, what: &str) -> litesvm::types::TransactionMetadata {
    match res {
        Ok(m) => m.clone(),
        Err(f) => panic!("{what} FAILED: {:?}\n{}", f.err, f.meta.pretty_logs()),
    }
}

// ---------------------------------------------------------------------------
// PumpSwap's BuyEvent (IDL field order)
// ---------------------------------------------------------------------------

#[derive(Debug, Default, Clone)]
#[allow(dead_code)]
struct BuyEvent {
    base_amount_out: u64,
    max_quote_amount_in: u64,
    pool_base_token_reserves: u64,
    pool_quote_token_reserves: u64,
    quote_amount_in: u64,
    lp_fee_basis_points: u64,
    lp_fee: u64,
    protocol_fee_basis_points: u64,
    protocol_fee: u64,
    quote_amount_in_with_lp_fee: u64,
    user_quote_amount_in: u64,
    user: Pubkey,
    protocol_fee_recipient: Pubkey,
    coin_creator_fee_basis_points: u64,
    coin_creator_fee: u64,
    track_volume: bool,
    min_base_amount_out: u64,
    ix_name: String,
    cashback_fee_basis_points: u64,
    cashback: u64,
    buyback_fee_basis_points: u64,
    buyback_fee: u64,
    virtual_quote_reserves: i128,
}

struct Cur<'a>(&'a [u8]);
impl Cur<'_> {
    fn take(&mut self, n: usize) -> &[u8] {
        let (a, b) = self.0.split_at(n);
        self.0 = b;
        a
    }
    fn u64(&mut self) -> u64 {
        u64::from_le_bytes(self.take(8).try_into().unwrap())
    }
    fn u32(&mut self) -> u32 {
        u32::from_le_bytes(self.take(4).try_into().unwrap())
    }
    fn b(&mut self) -> bool {
        self.take(1)[0] != 0
    }
    fn pk(&mut self) -> Pubkey {
        Pubkey::new_from_array(self.take(32).try_into().unwrap())
    }
}

fn parse_buy_event(d: &[u8]) -> BuyEvent {
    let mut c = Cur(d);
    let mut e = BuyEvent::default();
    c.u64(); // timestamp
    e.base_amount_out = c.u64();
    e.max_quote_amount_in = c.u64();
    c.u64(); // user_base_token_reserves
    c.u64(); // user_quote_token_reserves
    e.pool_base_token_reserves = c.u64();
    e.pool_quote_token_reserves = c.u64();
    e.quote_amount_in = c.u64();
    e.lp_fee_basis_points = c.u64();
    e.lp_fee = c.u64();
    e.protocol_fee_basis_points = c.u64();
    e.protocol_fee = c.u64();
    e.quote_amount_in_with_lp_fee = c.u64();
    e.user_quote_amount_in = c.u64();
    c.pk(); // pool
    e.user = c.pk();
    c.pk(); // user_base_token_account
    c.pk(); // user_quote_token_account
    e.protocol_fee_recipient = c.pk();
    c.pk(); // protocol_fee_recipient_token_account
    c.pk(); // coin_creator
    e.coin_creator_fee_basis_points = c.u64();
    e.coin_creator_fee = c.u64();
    e.track_volume = c.b();
    for _ in 0..4 {
        c.u64(); // volume accumulator fields
    }
    e.min_base_amount_out = c.u64();
    let n = c.u32() as usize;
    e.ix_name = String::from_utf8_lossy(c.take(n)).into_owned();
    e.cashback_fee_basis_points = c.u64();
    e.cashback = c.u64();
    e.buyback_fee_basis_points = c.u64();
    e.buyback_fee = c.u64();
    e.virtual_quote_reserves = i128::from_le_bytes(c.take(16).try_into().unwrap());
    e
}

fn buy_event(meta: &litesvm::types::TransactionMetadata) -> Option<BuyEvent> {
    for group in &meta.inner_instructions {
        for ix in group {
            let d = &ix.instruction.data;
            if d.len() > 16 && d[..8] == EVENT_IX_TAG && d[8..16] == BUY_EVENT {
                return Some(parse_buy_event(&d[16..]));
            }
        }
    }
    for l in &meta.logs {
        if let Some(s) = l.strip_prefix("Program data: ") {
            let d = b64(s);
            if d.len() > 8 && d[..8] == BUY_EVENT {
                return Some(parse_buy_event(&d[8..]));
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Fees and quote
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Fees {
    lp: u64,
    protocol: u64,
    creator: u64,
}

/// Pump Fees `FeeConfig`: bump, admin, flat_fees, fee_tiers, stable_fee_tiers, exotic_flat_fees.
fn parse_fee_config(d: &[u8]) -> (Fees, Vec<(u128, Fees)>) {
    let mut c = Cur(&d[8..]);
    c.take(1 + 32);
    let fees = |c: &mut Cur| Fees { lp: c.u64(), protocol: c.u64(), creator: c.u64() };
    let flat = fees(&mut c);
    let n = c.u32() as usize;
    let tiers = (0..n)
        .map(|_| {
            let t = u128::from_le_bytes(c.take(16).try_into().unwrap());
            (t, fees(&mut c))
        })
        .collect();
    (flat, tiers)
}

/// FEE_PROGRAM_README `calculateFeeTier`.
fn fee_tier(tiers: &[(u128, Fees)], market_cap: u128) -> Fees {
    if market_cap < tiers[0].0 {
        return tiers[0].1;
    }
    tiers.iter().rev().find(|(t, _)| market_cap >= *t).map(|x| x.1).unwrap_or(tiers[0].1)
}

/// The quote a `buy_exact_quote_in_v2` gives (docs/pump-arayuz.md K, found by
/// T5). The same steps as pump's `buy_exact_sol_in` docs (docs A1), with the
/// three PumpSwap fees, on the effective quote reserves:
/// 1. `net = floor(spendable * 10_000 / (10_000 + lp + protocol + creator))`
/// 2. `fees = ceil(net * lp / 10_000) + ceil(net * protocol / 10_000) + ceil(net * creator / 10_000)`
/// 3. if `net + fees > spendable`: `net -= net + fees - spendable`
/// 4. `out = floor((net - 1) * base / (quote + net - 1))`
/// Returns `(out, net, fees)`.
fn amm_quote(spendable: u64, base: u64, quote: u64, f: Fees) -> (u64, u64, u64) {
    let s = spendable as u128;
    let mut net = s * 10_000 / (10_000 + (f.lp + f.protocol + f.creator) as u128);
    let fees: u128 = [f.lp, f.protocol, f.creator].iter().map(|&bps| (net * bps as u128).div_ceil(10_000)).sum();
    if net + fees > s {
        net -= net + fees - s;
    }
    let out = (net - 1) * base as u128 / (quote as u128 + net - 1);
    (out as u64, net as u64, fees as u64)
}

/// The double's one-fee version (mock_pump_amm::quote_base_out) with `total_bps`.
fn mock_pump_amm_like(spendable: u64, base: u64, quote: u64, total_bps: u64) -> u64 {
    let s = spendable as u128;
    let mut net = s * 10_000 / (10_000 + total_bps as u128);
    let fee = (net * total_bps as u128).div_ceil(10_000);
    if net + fee > s {
        net -= net + fee - s;
    }
    ((net - 1) * base as u128 / (quote as u128 + net - 1)) as u64
}

// ---------------------------------------------------------------------------
// Rung helpers
// ---------------------------------------------------------------------------

struct RungRun {
    user: Keypair,
    session: Keypair,
    u_after_open: u64,
    open_cu: u64,
}

fn open_rung_order(env: &mut Real, expected_tokens_seen: u64) -> RungRun {
    let user = env.wallet(USER_AIRDROP);
    let session = Keypair::new();
    let (base, quote, _) = env.reserves();
    let args = OpenOrderArgs {
        venue: Venue::PumpSwap,
        rungs_bps: vec![100, 300],
        amount: AMOUNT,
        rent_reserve: AMM_RENT_RESERVE,
        fee_budget: FEE_BUDGET,
        expected_tokens_seen,
        raw_tokens_seen: raw_quote(AMOUNT, base, quote),
        window_slots: WINDOW,
        lifetime_slots: LIFETIME,
    };
    let remaining = [
        AccountMeta::new_readonly(env.pool.base_token_account, false),
        AccountMeta::new_readonly(env.pool.quote_token_account, false),
    ];
    let ix = open_order_ix_with_remaining(&user.pubkey(), &session.pubkey(), &env.mint, &env.pool.address, args, &remaining);
    let res = env.send(&[ix], &user, &[]);
    let meta = ok(&res, "open_order (PumpSwap)");
    let u_after_open = env.balance(&user.pubkey());
    RungRun { user, session, u_after_open, open_cu: meta.compute_units_consumed }
}

fn try_rung_ixs(env: &Real, run: &RungRun, rung_index: u8) -> Vec<Instruction> {
    let mut accounts = TryRungAccounts::new(&run.session.pubkey(), &run.user.pubkey(), &env.mint, &env.token_program);
    accounts.remaining = env.buy_metas(&vault_pda(&run.user.pubkey()), false);
    vec![cu_limit_ix(CU_LIMIT), accounts.ix(rung_index)]
}

fn try_rung_tx(env: &mut Real, run: &RungRun, rung_index: u8) -> TransactionResult {
    let ixs = try_rung_ixs(env, run, rung_index);
    let session = run.session.insecure_clone();
    env.send(&ixs, &session, &[])
}

/// Serialized size of a legacy transaction with one signature, counted from
/// the wire format (compact-u16 lengths), and its number of account keys.
fn legacy_tx_size(ixs: &[Instruction], payer: &Pubkey) -> (usize, usize) {
    let compact = |n: usize| if n < 0x80 { 1 } else if n < 0x4000 { 2 } else { 3 };
    let m = Message::new(ixs, Some(payer));
    let keys = m.account_keys.len();
    let mut size = compact(1) + 64; // one signature
    size += 3 + compact(keys) + 32 * keys + 32; // header, keys, blockhash
    size += compact(m.instructions.len());
    for ix in &m.instructions {
        size += 1 + compact(ix.accounts.len()) + ix.accounts.len() + compact(ix.data.len()) + ix.data.len();
    }
    (size, keys)
}

// ---------------------------------------------------------------------------
// T1: a plain wallet wraps SOL and buys directly from the real PumpSwap
// ---------------------------------------------------------------------------

#[test]
fn t1_plain_wallet_buys_from_real_pumpswap() {
    let Some(mut env) = Real::load() else { return };
    let w = env.wallet(USER_AIRDROP);
    let me = w.pubkey();
    let (base, quote, v) = env.reserves();
    let pool_before = env.svm.get_account(&env.pool.address).unwrap();
    println!("T1 fixture slot {} mint {} token program {} pool {}", env.slot, env.mint, env.token_program, env.pool.address);
    println!("T1 reserves: base {base} effective quote {quote} (virtual_quote_reserves {v}); pool len {} lamports {}", pool_before.data.len(), pool_before.lamports);

    let b0 = env.balance(&me);
    let res = env.send(&env.direct_buy_ixs(&me, AMOUNT, 1), &w, &[]);
    let meta = ok(&res, "T1 direct buy_exact_quote_in_v2");
    let tokens = env.tokens(&ata(&me, &env.mint, &env.token_program)).unwrap();
    let base_ata_rent = env.balance(&ata(&me, &env.mint, &env.token_program));
    let wsol = env.account(&wsol_ata(&me)).expect("WSOL ATA stays");
    let acc = env.account(&amm_accumulator_pda(&me)).expect("user_volume_accumulator created");
    let pool_after = env.svm.get_account(&env.pool.address).unwrap();
    let paid = b0 - env.balance(&me);
    println!(
        "T1 OK tokens {tokens} | wallet paid {paid} = amount {AMOUNT} + base ATA rent {base_ata_rent} + WSOL ATA lamports {} + accumulator {} + fee {SIG_FEE} | CU {}",
        wsol.lamports, acc.lamports, meta.compute_units_consumed
    );
    println!("T1 WSOL ATA after: amount {} lamports {} (rent(165) {})", token_amount(&wsol.data), wsol.lamports, env.rent(165));
    println!("T1 accumulator owner {} len {} lamports {} (rent = {})", acc.owner, acc.data.len(), acc.lamports, env.rent(acc.data.len()));
    println!("T1 pool len {} -> {}, lamports {} -> {}", pool_before.data.len(), pool_after.data.len(), pool_before.lamports, pool_after.lamports);
    let e = buy_event(&meta).expect("BuyEvent");
    println!("T1 BuyEvent {e:?}");

    assert!(tokens > 0);
    // `spendable_quote_in` is spent in full, fees included: the WSOL account is empty.
    assert_eq!(token_amount(&wsol.data), 0);
    assert_eq!(wsol.lamports, env.rent(165));
    assert_eq!(e.user, me);
    assert_eq!(e.ix_name, "buy_exact_quote_in_v2");
    assert_eq!(e.base_amount_out, tokens);
    // The accumulator is PumpSwap's, created in the trade and paid by `user`.
    assert_eq!(acc.owner, PUMP_SWAP);
    assert_eq!(acc.lamports, env.rent(acc.data.len()));
    assert_eq!(acc.data.len(), mock_pump_amm::USER_VOLUME_ACCUMULATOR_LEN);
    // Nothing else is paid by the wallet: no pool top-up on a current-layout pool.
    assert_eq!(pool_after.lamports, pool_before.lamports);
    assert_eq!(paid, AMOUNT + base_ata_rent + wsol.lamports + acc.lamports + SIG_FEE);
}

// ---------------------------------------------------------------------------
// T2: Rung buys through the real PumpSwap; the buyer is the vault PDA
// ---------------------------------------------------------------------------

#[test]
fn t2_rung_vault_pda_buys_from_real_pumpswap() {
    let Some(mut env) = Real::load() else { return };
    let quote = env.real_quote(AMOUNT);
    let run = open_rung_order(&mut env, quote);
    let user = run.user.pubkey();
    let vault = vault_pda(&user);
    println!("T2 quote {quote} tokens for {AMOUNT} lamports; open_order CU {}; vault holds {}", run.open_cu, env.balance(&vault));
    let pool_quote_before = env.tokens(&env.pool.quote_token_account).unwrap();

    let res = try_rung_tx(&mut env, &run, 0);
    let cu = cu_of(&res);
    if let Err(f) = &res {
        println!("T2 try_rung(0) FAILED: {:?} CU {cu}\n{}", f.err, logs_of(&res));
    }
    let meta = ok(&res, "T2 try_rung(0) with the real PumpSwap");

    let user_ata = ata(&user, &env.mint, &env.token_program);
    let tokens = env.tokens(&user_ata).unwrap();
    let o = env.order(&user);
    let acc = env.account(&amm_accumulator_pda(&vault)).expect("vault's user_volume_accumulator");
    let returned = env.balance(&user) - run.u_after_open;
    let ata_rent = env.balance(&user_ata);
    println!("T2 OK try_rung CU {cu}; tokens {tokens}; returned {returned}; user ATA rent {ata_rent}; accumulator {}", acc.lamports);
    if let Some(e) = buy_event(&meta) {
        println!("T2 BuyEvent user {} (vault {vault}) {e:?}", e.user);
    }

    assert_eq!(o.status, OrderStatus::Filled);
    assert_eq!(o.filled_rung, 0);
    assert_eq!(tokens, quote);
    assert_eq!(o.tokens_bought, tokens);
    assert_eq!(o.lamports_spent, AMOUNT);
    // The order amount leaves the vault in full. Most of it lands in the pool;
    // half of the protocol fee goes to the buyback recipient instead (24,704
    // lamports of 100,000,000 in this snapshot), so the pool gets slightly less.
    let pool_gain = env.tokens(&env.pool.quote_token_account).unwrap() - pool_quote_before;
    assert!(pool_gain <= AMOUNT && pool_gain >= AMOUNT - AMOUNT / 1_000, "pool gained {pool_gain}");
    assert_eq!(env.balance(&vault), 0);
    assert!(env.account(&ata(&vault, &env.mint, &env.token_program)).is_none());
    assert!(env.account(&wsol_ata(&vault)).is_none(), "the vault's WSOL account is closed");
    assert_eq!(acc.owner, PUMP_SWAP);
    assert_eq!(returned, AMM_RENT_RESERVE - ata_rent - acc.lamports);
}

// ---------------------------------------------------------------------------
// T3: a rung tighter than the real quote fails with PumpSwap's slippage error
// ---------------------------------------------------------------------------

#[test]
fn t3_tight_rung_fails_with_real_pumpswap_slippage() {
    let Some(mut env) = Real::load() else { return };
    let (base, quote, _) = env.reserves();
    let fee_free = raw_quote(AMOUNT, base, quote);
    let real = env.real_quote(AMOUNT);
    assert!(
        real < rung::math::min_tokens_at(fee_free, 100).unwrap(),
        "precondition: the real fee is above 1%, so the 1% rung on the fee-free quote cannot fill"
    );
    let run = open_rung_order(&mut env, fee_free);
    let user = run.user.pubkey();
    let vault_before = env.balance(&vault_pda(&user));
    let res = try_rung_tx(&mut env, &run, 0);
    let logs = logs_of(&res);
    println!("T3 try_rung(0) result {:?} CU {}", err_of(&res), cu_of(&res));
    assert_code(&res, AMM_SLIPPAGE);
    assert!(logs.contains("Program pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA failed: custom program error: 0x1798"));
    assert_eq!(env.order(&user).status, OrderStatus::Open);
    assert_eq!(env.balance(&vault_pda(&user)), vault_before);
    assert!(env.account(&wsol_ata(&vault_pda(&user))).is_none());
}

// ---------------------------------------------------------------------------
// T4: compute units and transaction size of try_rung against the real PumpSwap
// ---------------------------------------------------------------------------

#[test]
fn t4_try_rung_compute_units_and_size() {
    let Some(mut env) = Real::load() else { return };
    // Size first: it depends only on the account keys, not on Rung's code.
    let probe = RungRun { user: Keypair::new(), session: Keypair::new(), u_after_open: 0, open_cu: 0 };
    let (size, keys) = legacy_tx_size(&try_rung_ixs(&env, &probe, 0), &probe.session.pubkey());
    println!("T4 try_rung legacy transaction (CU limit ix + try_rung with 17 PumpSwap accounts): {size} bytes (limit 1232), {keys} account keys");
    assert!(size <= 1232, "try_rung fits a legacy transaction");

    let quote = env.real_quote(AMOUNT);
    let good = open_rung_order(&mut env, quote);

    let success = try_rung_tx(&mut env, &good, 0);
    let w = env.wallet(USER_AIRDROP);
    let direct = env.send(&env.direct_buy_ixs(&w.pubkey(), AMOUNT, 1), &w, &[]);
    ok(&direct, "direct buy");
    println!(
        "T4 CU: try_rung {} ({:?}) | open_order {} | direct wrap+buy (new accumulator) {}",
        cu_of(&success),
        err_of(&success),
        good.open_cu,
        cu_of(&direct)
    );
    ok(&success, "T4 try_rung");
    assert!(cu_of(&success) < CU_LIMIT as u64);
}

// ---------------------------------------------------------------------------
// T5: quote formula and the real fee rate
// ---------------------------------------------------------------------------

#[test]
fn t5_quote_formula_and_fee_rate() {
    let Some(mut env) = Real::load() else { return };
    let (base, quote, v) = env.reserves();
    let fee_cfg = env.svm.get_account(&AMM_FEE_CONFIG).unwrap().data;
    let global = env.svm.get_account(&AMM_GLOBAL_CONFIG).unwrap().data;
    let supply = u64_at(&env.svm.get_account(&env.mint).unwrap().data, 36);
    // GlobalConfig: admin 32, lp 8, protocol 8, disable_flags 1, protocol_fee_recipients 256,
    // coin_creator 8, admin_set_coin_creator_authority 32, whitelist_pda 32,
    // reserved_fee_recipient 32, mayhem_mode_enabled 1, reserved_fee_recipients 224,
    // is_cashback_enabled 1, buyback_fee_recipients 256, buyback_basis_points 8.
    let buyback_bps_offset = 8 + 32 + 8 + 8 + 1 + 256 + 8 + 32 + 32 + 32 + 1 + 224 + 1 + 256;
    let g_buyback_bps = u64_at(&global, buyback_bps_offset);
    let (flat, tiers) = parse_fee_config(&fee_cfg);
    // FEE_PROGRAM_README poolMarketCap: quoteReserve * baseMintSupply / baseReserve.
    let mcap = quote as u128 * supply as u128 / base as u128;
    let tier = fee_tier(&tiers, mcap);
    println!("T5 reserves base {base} quote {quote} (virtual {v}) supply {supply} market cap {mcap}");
    println!("T5 fee_config flat {flat:?}; {} tiers; tier for this market cap {tier:?}; global buyback_basis_points {g_buyback_bps}", tiers.len());

    let w = env.wallet(USER_AIRDROP);
    let me = w.pubkey();
    let meta = ok(&env.send(&env.direct_buy_ixs(&me, AMOUNT, 1), &w, &[]), "T5 buy");
    let actual = env.tokens(&ata(&me, &env.mint, &env.token_program)).unwrap();
    let e = buy_event(&meta).expect("BuyEvent");
    println!("T5 BuyEvent {e:?}");

    let raw = raw_quote(AMOUNT, base, quote);
    let total = tier.lp + tier.protocol + tier.creator;
    let (formula, net, fees) = amm_quote(AMOUNT, base, quote, tier);
    let fees_paid = e.lp_fee + e.protocol_fee + e.coin_creator_fee;
    // The constant-product quote on the whole amount with one fee taken off first.
    let single = mock_pump_amm_like(AMOUNT, base, quote, total);
    println!("T5 actual {actual} | fee-free {raw} (actual/raw {:.6}, {:.2} bps below) | formula with tier {total} bps: {formula} (diff {}) | net {net} fees {fees}",
        actual as f64 / raw as f64, (raw - actual) as f64 * 10_000.0 / raw as f64, actual as i128 - formula as i128);
    println!("T5 one-fee formula with {total} bps (the double): {single} (diff {})", actual as i128 - single as i128);
    println!("T5 event: quote_amount_in {} lp {} protocol {} creator {} buyback {} (bps {}) cashback {} | sum of fees {fees_paid} | user_quote_amount_in {}",
        e.quote_amount_in, e.lp_fee, e.protocol_fee, e.coin_creator_fee, e.buyback_fee, e.buyback_fee_basis_points, e.cashback, e.user_quote_amount_in);

    // Pinned from the 2026-11-23 snapshot:
    // - the rates are the fee_config tier's lp, protocol and creator bps (the
    //   pool is canonical, so tiers apply, not flat_fees);
    // - the buyback fee is a share of the protocol fee, not an extra charge;
    // - `amm_quote` (pump A1 steps with three fees) gives the exact token
    //   amount; the event reports `net` as `user_quote_amount_in`;
    // - `spendable_quote_in` is spent in full: net + fees = amount.
    assert_eq!(
        (e.lp_fee_basis_points, e.protocol_fee_basis_points, e.coin_creator_fee_basis_points),
        (tier.lp, tier.protocol, tier.creator)
    );
    assert_eq!(total, mock_pump_amm::FEE_BPS, "the double charges this pool's real total");
    assert_eq!(e.buyback_fee_basis_points, g_buyback_bps);
    assert_eq!(e.buyback_fee, e.protocol_fee * g_buyback_bps / 10_000);
    assert_eq!(formula, actual);
    assert_eq!(e.base_amount_out, actual);
    assert_eq!(e.quote_amount_in, AMOUNT);
    assert_eq!(e.user_quote_amount_in, net);
    assert_eq!(fees_paid, fees);
    assert_eq!(net + fees, AMOUNT);
    assert!(actual < raw);
    // One rounded fee instead of three moves `net` by a lamport or two.
    assert!(single.abs_diff(actual) * 1_000_000 <= actual, "the double's one-fee quote is within 1 ppm of the real one");

    // One token more than the pool gives now fails with 6040 and keeps the wrapped SOL.
    let (base, quote, _) = env.reserves();
    let (next, _, _) = amm_quote(AMOUNT, base, quote, tier);
    let w = env.wallet(USER_AIRDROP);
    let res = env.send(&env.direct_buy_ixs(&w.pubkey(), AMOUNT, next + 1), &w, &[]);
    assert_code(&res, AMM_SLIPPAGE);
    assert!(logs_of(&res).contains("custom program error: 0x1798"));
    let w = env.wallet(USER_AIRDROP);
    ok(&env.send(&env.direct_buy_ixs(&w.pubkey(), AMOUNT, next), &w, &[]), "T5 buy with min = quote");
    assert_eq!(env.tokens(&ata(&w.pubkey(), &env.mint, &env.token_program)), Some(next));
}

// ---------------------------------------------------------------------------
// T6: mayhem and cashback pools (flags flipped on the snapshot pool)
// ---------------------------------------------------------------------------

#[test]
fn t6_v2_buy_on_mayhem_and_cashback_pools() {
    let Some(mut env) = Real::load() else { return };
    let mut outcome = Vec::new();
    for (what, offset) in [("is_mayhem_mode", 243usize), ("is_cashback_coin", 244)] {
        let original = env.svm.get_account(&env.pool.address).unwrap();
        let mut flipped = original.clone();
        flipped.data[offset] = 1;
        env.svm.set_account(env.pool.address, flipped).unwrap();
        let w = env.wallet(USER_AIRDROP);
        let res = env.send(&env.direct_buy_ixs(&w.pubkey(), AMOUNT, 1), &w, &[]);
        let event = res.as_ref().ok().and_then(buy_event);
        println!("T6 {what} = true: {:?} | fees bps lp/protocol/creator/buyback {:?}", err_of(&res),
            event.map(|e| (e.lp_fee_basis_points, e.protocol_fee_basis_points, e.coin_creator_fee_basis_points, e.buyback_fee_basis_points)));
        outcome.push(res.as_ref().err().map(|_| custom_code(&res)));
        env.svm.set_account(env.pool.address, original).unwrap();
    }
    println!("T6 outcome {outcome:?}");
    // Observed on the 2026-11-23 binary: a mayhem pool trades through v2
    // (the 6080 `MayhemPoolNotSupported` code in the IDL is not raised; the
    // buyback fee is 0), a cashback pool fails with 6079.
    assert_eq!(outcome, vec![None, Some(AMM_CASHBACK_NOT_SUPPORTED)]);
}

// ---------------------------------------------------------------------------
// T7: token accounts that are not associated token accounts
// ---------------------------------------------------------------------------

#[test]
fn t7_non_ata_token_accounts() {
    let Some(mut env) = Real::load() else { return };
    let rent = env.rent(165);
    // (a) wrapped SOL in a plain token account (not the ATA) of the buyer.
    let w = env.wallet(USER_AIRDROP);
    let me = w.pubkey();
    let other_wsol = Pubkey::new_unique();
    env.svm
        .set_account(other_wsol, Account { lamports: rent + AMOUNT, data: pack_native_token_account(&me, AMOUNT, rent), owner: TOKEN, executable: false, rent_epoch: 0 })
        .unwrap();
    let mut metas = env.buy_metas(&me, true);
    metas[6] = AccountMeta::new(other_wsol, false);
    let ixs = [cu_limit_ix(CU_LIMIT), create_ata_ix(&me, &me, &env.mint, &env.token_program), env.buy_ix_with(metas, AMOUNT, 1)];
    let res = env.send(&ixs, &w, &[]);
    println!("T7a non-ATA WSOL account of the buyer: {:?}", err_of(&res));
    let wsol_non_ata_ok = res.is_ok();

    // (b) tokens into a plain (non-ATA) base account of the buyer.
    let w = env.wallet(USER_AIRDROP);
    let me = w.pubkey();
    let other_base = Pubkey::new_unique();
    let len = env.svm.get_account(&ata(&env.pool.address, &env.mint, &env.token_program)).unwrap().data.len();
    let mut data = env.svm.get_account(&env.pool.base_token_account).unwrap().data;
    data[32..64].copy_from_slice(me.as_ref());
    data[64..72].copy_from_slice(&0u64.to_le_bytes());
    let lamports = env.rent(len);
    env.svm.set_account(other_base, Account { lamports, data, owner: env.token_program, executable: false, rent_epoch: 0 }).unwrap();
    let mut metas = env.buy_metas(&me, true);
    metas[5] = AccountMeta::new(other_base, false);
    let mut ixs = vec![cu_limit_ix(CU_LIMIT)];
    ixs.extend(wrap_sol_ixs(&me, AMOUNT));
    ixs.push(env.buy_ix_with(metas, AMOUNT, 1));
    let res = env.send(&ixs, &w, &[]);
    println!("T7b non-ATA base account of the buyer: {:?} tokens {:?}", err_of(&res), env.tokens(&other_base));
    let base_non_ata_ok = res.is_ok();
    println!("T7 non-ATA WSOL accepted: {wsol_non_ata_ok}; non-ATA base accepted: {base_non_ata_ok}");
}

// ---------------------------------------------------------------------------
// T8: the buyback recipient account
// ---------------------------------------------------------------------------

#[test]
fn t8_buyback_recipient_must_be_a_listed_wallets_wsol_account() {
    let Some(mut env) = Real::load() else { return };
    let rent = env.rent(165);
    // (a) Another listed wallet's WSOL ATA that does not exist in the snapshot.
    let other_listed = BUYBACK_WALLETS.iter().map(wsol_ata).find(|a| *a != env.buyback && env.account(a).is_none());
    if let Some(missing) = other_listed {
        let w = env.wallet(USER_AIRDROP);
        let mut metas = env.buy_metas(&w.pubkey(), true);
        metas[14] = AccountMeta::new(missing, false);
        let mut ixs = env.direct_buy_ixs(&w.pubkey(), AMOUNT, 1);
        *ixs.last_mut().unwrap() = env.buy_ix_with(metas, AMOUNT, 1);
        let res = env.send(&ixs, &w, &[]);
        println!("T8a listed wallet's WSOL ATA that does not exist ({missing}): {:?}", err_of(&res));
        assert!(res.is_err(), "the buyback account must exist");
    }
    // (b) A WSOL account of a wallet that is not on the list.
    let stranger = Pubkey::new_unique();
    let stranger_wsol = wsol_ata(&stranger);
    env.svm
        .set_account(stranger_wsol, Account { lamports: rent, data: pack_native_token_account(&stranger, 0, rent), owner: TOKEN, executable: false, rent_epoch: 0 })
        .unwrap();
    let w = env.wallet(USER_AIRDROP);
    let mut metas = env.buy_metas(&w.pubkey(), true);
    metas[14] = AccountMeta::new(stranger_wsol, false);
    let mut ixs = env.direct_buy_ixs(&w.pubkey(), AMOUNT, 1);
    *ixs.last_mut().unwrap() = env.buy_ix_with(metas, AMOUNT, 1);
    let res = env.send(&ixs, &w, &[]);
    let line = logs_of(&res).lines().find(|l| l.contains("Error")).map(str::to_owned);
    println!("T8b WSOL account of an unlisted wallet: {:?} {line:?}", err_of(&res));
    assert!(res.is_err(), "only the listed buyback wallets are accepted");
}

// ---------------------------------------------------------------------------
// T9: rent top-up of an older, shorter pool
// ---------------------------------------------------------------------------

#[test]
fn t9_short_pool_is_topped_up_by_user() {
    let Some(mut env) = Real::load() else { return };
    // Cut the pool back to the layout before `creator_fee_bps` (245 + 16 = 261 bytes).
    let mut pool = env.svm.get_account(&env.pool.address).unwrap();
    pool.data.truncate(261);
    pool.lamports = env.rent(261);
    env.svm.set_account(env.pool.address, pool.clone()).unwrap();
    let w = env.wallet(USER_AIRDROP);
    let me = w.pubkey();
    let b0 = env.balance(&me);
    let res = env.send(&env.direct_buy_ixs(&me, AMOUNT, 1), &w, &[]);
    let after = env.svm.get_account(&env.pool.address).unwrap();
    println!(
        "T9 261-byte pool: {:?}; pool len {} -> {}, lamports {} -> {} (rent of new len {})",
        err_of(&res), pool.data.len(), after.data.len(), pool.lamports, after.lamports, env.rent(after.data.len())
    );
    if res.is_ok() {
        let acc = env.balance(&amm_accumulator_pda(&me));
        let base_ata = env.balance(&ata(&me, &env.mint, &env.token_program));
        let wsol = env.balance(&wsol_ata(&me));
        let top_up = after.lamports - pool.lamports;
        println!("T9 wallet paid {} = amount + ATAs + accumulator + fee + top-up {top_up}", b0 - env.balance(&me));
        assert_eq!(b0 - env.balance(&me), AMOUNT + base_ata + wsol + acc + SIG_FEE + top_up);
    }
}

// ---------------------------------------------------------------------------
// T10: Rung buys a mint of the other token program from the real PumpSwap
// ---------------------------------------------------------------------------

/// Re-keys the snapshot pool to a new mint owned by `token_program`: a mint
/// with the snapshot mint's base fields, its canonical pool (the snapshot
/// pool's data with the mint, creator, bump and token accounts rewritten) and
/// the pool's two token accounts at the snapshot's reserves. A constructed
/// pool, not one read from mainnet.
fn rekey_pool_to_new_mint(env: &mut Real, token_program: Pubkey) {
    let old_mint = env.svm.get_account(&env.mint).unwrap();
    let base = env.tokens(&env.pool.base_token_account).unwrap();
    let quote = env.tokens(&env.pool.quote_token_account).unwrap();

    let mint = Pubkey::new_unique();
    let mint_data = old_mint.data[..82].to_vec();
    let lamports = env.rent(mint_data.len());
    env.svm.set_account(mint, Account { lamports, data: mint_data, owner: token_program, executable: false, rent_epoch: 0 }).unwrap();

    let creator = pool_authority_pda(&mint);
    let (address, bump) = pool_pda(0, &creator, &mint, &WSOL);
    let pool = AmmPool {
        address,
        base_token_account: ata(&address, &mint, &token_program),
        quote_token_account: ata(&address, &WSOL, &TOKEN),
    };
    let mut account = env.svm.get_account(&env.pool.address).unwrap();
    account.data[8] = bump;
    account.data[11..43].copy_from_slice(creator.as_ref());
    account.data[43..75].copy_from_slice(mint.as_ref());
    account.data[139..171].copy_from_slice(pool.base_token_account.as_ref());
    account.data[171..203].copy_from_slice(pool.quote_token_account.as_ref());
    env.svm.set_account(address, account).unwrap();

    let rent = env.rent(165);
    env.svm
        .set_account(pool.base_token_account, Account { lamports: rent, data: pack_token_account(&mint, &address, base), owner: token_program, executable: false, rent_epoch: 0 })
        .unwrap();
    env.svm
        .set_account(pool.quote_token_account, Account { lamports: rent + quote, data: pack_native_token_account(&address, quote, rent), owner: TOKEN, executable: false, rent_epoch: 0 })
        .unwrap();

    env.mint = mint;
    env.token_program = token_program;
    env.pool = pool;
    assert_eq!(env.pool.address, canonical_pool(&mint));
}

#[test]
fn t10_rung_buys_a_mint_of_the_other_token_program() {
    let Some(mut env) = Real::load() else { return };
    let other = if env.token_program == TOKEN { TOKEN_2022 } else { TOKEN };
    let snapshot_quote = env.real_quote(AMOUNT);
    rekey_pool_to_new_mint(&mut env, other);
    println!("T10 snapshot mint was under another token program; constructed mint {} under {other}", env.mint);

    // A plain wallet first: the real program accepts the constructed pool and
    // prices it like the snapshot pool (same reserves, same fee tier).
    let quote = env.real_quote(AMOUNT);
    assert_eq!(quote, snapshot_quote);

    let run = open_rung_order(&mut env, quote);
    let user = run.user.pubkey();
    let vault = vault_pda(&user);
    let res = try_rung_tx(&mut env, &run, 0);
    let cu = cu_of(&res);
    if res.is_err() {
        println!("T10 try_rung(0) FAILED: {:?} CU {cu}
{}", err_of(&res), logs_of(&res));
    }
    ok(&res, "T10 try_rung(0) with the real PumpSwap");
    let user_ata = ata(&user, &env.mint, &env.token_program);
    let tokens = env.tokens(&user_ata).unwrap();
    let o = env.order(&user);
    println!("T10 OK try_rung CU {cu}; tokens {tokens}; user ATA rent {}", env.balance(&user_ata));
    assert_eq!(o.status, OrderStatus::Filled);
    assert_eq!(tokens, quote);
    assert_eq!(o.tokens_bought, tokens);
    assert_eq!(o.lamports_spent, AMOUNT);
    assert_eq!(env.balance(&vault), 0);
    assert!(env.account(&ata(&vault, &env.mint, &env.token_program)).is_none());
    assert!(env.account(&wsol_ata(&vault)).is_none());
}
