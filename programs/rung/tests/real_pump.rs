//! Rung against the REAL pump.fun bonding-curve program (not the test double).
//!
//! `scripts/fetch-pump-fixtures.mjs` dumps pump's executable from mainnet and
//! snapshots the accounts of one live SOL-paired curve into
//! `tests/fixtures/pump/` (git-ignored). Without that folder every test here
//! prints a notice and returns, so a clean clone stays green.
//!
//! T1 environment check (plain wallet buys directly) · T2 Rung buys with the
//! vault PDA as pump's `user` · T3 a tight rung fails with pump's slippage
//! error · T4 compute units · T5 quote formula and real fee rate · T6
//! `close_user_volume_accumulator` · T7 tokens to another wallet's account.
//! Run with `-- --nocapture` to see the numbers.

mod common;

use std::path::PathBuf;

use anchor_lang::{
    prelude::{AccountMeta, Pubkey},
    pubkey,
    solana_program::{clock::Clock, instruction::Instruction, rent::Rent},
};
use base64::Engine;
use common::*;
use litesvm::{types::TransactionResult, LiteSVM};
use rung::{state::OrderStatus, OpenOrderArgs, Venue};
use solana_account::Account;
use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_transaction::Transaction;

const PUMP_FEES: Pubkey = pubkey!("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
const NATIVE_LOADER: Pubkey = pubkey!("NativeLoader1111111111111111111111111111111");
const SYSVAR_OWNER: Pubkey = pubkey!("Sysvar1111111111111111111111111111111111111");
const BUY_EXACT_QUOTE_IN_V3: [u8; 8] = [225, 247, 80, 30, 213, 179, 132, 136];
const CLOSE_USER_VOLUME_ACCUMULATOR: [u8; 8] = [249, 69, 164, 218, 150, 103, 84, 138];
/// Anchor `emit_cpi!` prefix of the self-CPI that carries an event.
const EVENT_IX_TAG: [u8; 8] = [0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d];
const TRADE_EVENT: [u8; 8] = [189, 219, 127, 211, 78, 230, 97, 238];
const SLOTS_PER_EPOCH: u64 = 432_000;

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

fn fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/pump")
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
    buyback: Pubkey,
    decimals: u8,
    slot: u64,
    block_time: i64,
}

impl Real {
    /// `None` (with a notice) when the fixtures are missing.
    fn load() -> Option<Self> {
        let dir = fixture_dir();
        if !dir.join("pump.so").exists() || !dir.join("accounts.json").exists() {
            eprintln!(
                "fixtures missing: run `node scripts/fetch-pump-fixtures.mjs` ({} not found); skipping",
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

        // Mainnet's rent, so the rent numbers below are mainnet's.
        for a in json["accounts"].as_array().unwrap() {
            if a["address"] == "SysvarRent111111111111111111111111111111111" && a["exists"] == true {
                let d = b64(a["data"].as_str().unwrap());
                // The sysvar's wire layout (the fields are deprecated, not gone).
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

        let pump = std::fs::read(dir.join("pump.so")).unwrap();
        if let Err(e) = svm.add_program(PUMP, &pump) {
            let len = elf_len(&pump);
            eprintln!("pump.so ({} bytes) did not load ({e:?}); retrying with the ELF trimmed to {len} bytes", pump.len());
            svm.add_program(PUMP, &pump[..len]).expect("pump.so loads");
        }
        let fees = dir.join("pump_fees.so");
        if fees.exists() {
            let bytes = std::fs::read(&fees).unwrap();
            if svm.add_program(PUMP_FEES, &bytes).is_err() {
                svm.add_program(PUMP_FEES, &bytes[..elf_len(&bytes)]).expect("pump_fees.so loads");
            }
        }

        // Every snapshotted data account. Programs (pump, the token programs,
        // the system program) stay LiteSVM's own or the dumped ones above.
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

        let mint = buy[1];
        let token_program = buy[3];
        let curve = curve_pda(&mint);
        // The fixture's accounts are the ones our helpers derive.
        assert_eq!(buy[0], global_pda());
        assert_eq!(buy[2], WSOL);
        assert_eq!(buy[4], TOKEN);
        assert_eq!(buy[5], curve);
        assert_eq!(buy[6], ata(&curve, &mint, &token_program));
        assert_eq!(buy[7], ata(&curve, &WSOL, &TOKEN));
        assert_eq!(buy[9], ata(&buy[8], &mint, &token_program));
        assert_eq!(buy[10], ata(&buy[8], &WSOL, &TOKEN));
        assert_eq!(buy[11], accumulator_pda(&buy[8]));
        assert_eq!(buy[12], PUMP_FEE_CONFIG);
        assert_eq!(buy[15], event_authority_pda());
        assert_eq!(buy[16], PUMP);

        let decimals = svm.get_account(&mint).unwrap().data[44];
        Some(Self { svm, mint, token_program, buyback: buy[13], decimals, slot, block_time })
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

    /// (virtual_token_reserves, virtual_quote_reserves) of the curve now.
    fn reserves(&self) -> (u64, u64) {
        let d = self.svm.get_account(&curve_pda(&self.mint)).unwrap().data;
        (u64_at(&d, 8), u64_at(&d, 16))
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

    /// The 17 accounts of `buy_exact_quote_in_v3` for `buyer`, with the
    /// fixture's buyback recipient and, optionally, another token account.
    fn buy_metas(&self, buyer: &Pubkey, signs: bool, base_user: Option<Pubkey>) -> Vec<AccountMeta> {
        let mut m = buy_accounts(buyer, &self.mint, &self.token_program, signs);
        m[13] = AccountMeta::new(self.buyback, false);
        if let Some(a) = base_user {
            m[9] = AccountMeta::new(a, false);
        }
        m
    }

    fn buy_ix(&self, buyer: &Pubkey, spendable: u64, min_out: u64, base_user: Option<Pubkey>) -> Instruction {
        let mut data = BUY_EXACT_QUOTE_IN_V3.to_vec();
        data.extend_from_slice(&spendable.to_le_bytes());
        data.extend_from_slice(&min_out.to_le_bytes());
        data.push(0); // partial_fill: false
        Instruction { program_id: PUMP, accounts: self.buy_metas(buyer, true, base_user), data }
    }

    /// Associated Token Program `CreateIdempotent` (tag 1).
    fn create_ata_ix(&self, payer: &Pubkey, owner: &Pubkey) -> Instruction {
        Instruction {
            program_id: ATA_PROGRAM,
            accounts: vec![
                AccountMeta::new(*payer, true),
                AccountMeta::new(ata(owner, &self.mint, &self.token_program), false),
                AccountMeta::new_readonly(*owner, false),
                AccountMeta::new_readonly(self.mint, false),
                AccountMeta::new_readonly(SYSTEM, false),
                AccountMeta::new_readonly(self.token_program, false),
            ],
            data: vec![1],
        }
    }

    fn user_ata(&self, owner: &Pubkey) -> Pubkey {
        ata(owner, &self.mint, &self.token_program)
    }

    /// Tokens a direct buy of `amount` returns at the current reserves
    /// (simulated by a throwaway wallet; nothing is committed but its airdrop).
    fn real_quote(&mut self, amount: u64) -> u64 {
        let w = self.wallet(10_000_000_000);
        let ixs = [
            cu_limit_ix(CU_LIMIT),
            self.create_ata_ix(&w.pubkey(), &w.pubkey()),
            self.buy_ix(&w.pubkey(), amount, 1, None),
        ];
        self.svm.expire_blockhash();
        let tx = Transaction::new_signed_with_payer(&ixs, Some(&w.pubkey()), &[&w], self.svm.latest_blockhash());
        let sim = self.svm.simulate_transaction(tx).unwrap_or_else(|e| panic!("quote simulation failed: {:?}\n{}", e.err, e.meta.pretty_logs()));
        let ata = self.user_ata(&w.pubkey());
        let acc = sim.post_accounts.iter().find(|(a, _)| *a == ata).expect("ATA in post accounts");
        token_amount(&Account::from(acc.1.clone()).data)
    }

    fn order(&self, user: &Pubkey) -> rung::state::Order {
        let a = self.svm.get_account(&order_pda(user)).expect("order account");
        anchor_lang::AccountDeserialize::try_deserialize(&mut a.data.as_slice()).expect("order decodes")
    }
}

fn token_amount(data: &[u8]) -> u64 {
    u64_at(data, 64)
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

#[track_caller]
fn ok(res: &TransactionResult, what: &str) -> litesvm::types::TransactionMetadata {
    match res {
        Ok(m) => m.clone(),
        Err(f) => panic!("{what} FAILED: {:?}\n{}", f.err, f.meta.pretty_logs()),
    }
}

// ---------------------------------------------------------------------------
// pump's TradeEvent (IDL field order)
// ---------------------------------------------------------------------------

#[derive(Debug, Default, Clone)]
struct Trade {
    sol_amount: u64,
    token_amount: u64,
    user: Pubkey,
    fee_basis_points: u64,
    fee: u64,
    creator_fee_basis_points: u64,
    creator_fee: u64,
    track_volume: bool,
    ix_name: String,
    cashback_fee_basis_points: u64,
    cashback: u64,
    buyback_fee_basis_points: u64,
    buyback_fee: u64,
    quote_amount: u64,
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

fn parse_trade(d: &[u8]) -> Trade {
    let mut c = Cur(d);
    let mut t = Trade::default();
    c.pk(); // mint
    t.sol_amount = c.u64();
    t.token_amount = c.u64();
    c.b(); // is_buy
    t.user = c.pk();
    c.u64(); // timestamp
    for _ in 0..4 {
        c.u64(); // reserves after the trade
    }
    c.pk(); // fee_recipient
    t.fee_basis_points = c.u64();
    t.fee = c.u64();
    c.pk(); // creator
    t.creator_fee_basis_points = c.u64();
    t.creator_fee = c.u64();
    t.track_volume = c.b();
    for _ in 0..4 {
        c.u64(); // volume accumulator fields
    }
    let n = c.u32() as usize;
    t.ix_name = String::from_utf8_lossy(c.take(n)).into_owned();
    c.b(); // mayhem_mode
    t.cashback_fee_basis_points = c.u64();
    t.cashback = c.u64();
    t.buyback_fee_basis_points = c.u64();
    t.buyback_fee = c.u64();
    let shareholders = c.u32() as usize;
    c.take(shareholders * 34);
    c.pk(); // quote_mint
    t.quote_amount = c.u64();
    t
}

/// pump's TradeEvent from an `emit_cpi!` inner instruction (or a log line).
fn trade_event(meta: &litesvm::types::TransactionMetadata) -> Option<Trade> {
    for group in &meta.inner_instructions {
        for ix in group {
            let d = &ix.instruction.data;
            if d.len() > 16 && d[..8] == EVENT_IX_TAG && d[8..16] == TRADE_EVENT {
                return Some(parse_trade(&d[16..]));
            }
        }
    }
    for l in &meta.logs {
        if let Some(s) = l.strip_prefix("Program data: ") {
            let d = b64(s);
            if d.len() > 8 && d[..8] == TRADE_EVENT {
                return Some(parse_trade(&d[8..]));
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Quote formulas
// ---------------------------------------------------------------------------

/// `buy_exact_sol_in` docs formula (docs/pump-arayuz.md A1).
fn a1_quote(spendable: u64, vt: u64, vq: u64, protocol_bps: u64, creator_bps: u64) -> u64 {
    let (s, p, c) = (spendable as u128, protocol_bps as u128, creator_bps as u128);
    let mut net = s * 10_000 / (10_000 + p + c);
    let fees = (net * p).div_ceil(10_000) + (net * c).div_ceil(10_000);
    if net + fees > s {
        net -= net + fees - s;
    }
    ((net - 1) * vt as u128 / (vq as u128 + net - 1)) as u64
}

#[derive(Debug, Clone, Copy)]
struct Fees {
    lp: u64,
    protocol: u64,
    creator: u64,
}

/// `FeeConfig`: bump, admin, flat_fees, fee_tiers, stable_fee_tiers, exotic_flat_fees.
fn parse_fee_config(d: &[u8]) -> (Fees, Vec<(u128, Fees)>, Vec<(u128, Fees)>, Fees) {
    let mut c = Cur(&d[8..]);
    c.take(1 + 32);
    let fees = |c: &mut Cur| Fees { lp: c.u64(), protocol: c.u64(), creator: c.u64() };
    let flat = fees(&mut c);
    let tiers = |c: &mut Cur| {
        let n = c.u32() as usize;
        (0..n)
            .map(|_| {
                let t = u128::from_le_bytes(c.take(16).try_into().unwrap());
                (t, fees(c))
            })
            .collect::<Vec<_>>()
    };
    let t = tiers(&mut c);
    let st = tiers(&mut c);
    let exotic = fees(&mut c);
    (flat, t, st, exotic)
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
    let (vt, vq) = env.reserves();
    let args = OpenOrderArgs {
        venue: Venue::Curve,
        rungs_bps: vec![100, 300],
        amount: AMOUNT,
        rent_reserve: RENT_RESERVE,
        fee_budget: FEE_BUDGET,
        expected_tokens_seen,
        raw_tokens_seen: raw_quote(AMOUNT, vt, vq),
        window_slots: WINDOW,
        lifetime_slots: LIFETIME,
    };
    let ix = open_order_ix(&user.pubkey(), &session.pubkey(), &env.mint, &curve_pda(&env.mint), args);
    let res = env.send(&[ix], &user, &[]);
    let meta = ok(&res, "open_order");
    let u_after_open = env.balance(&user.pubkey());
    RungRun { user, session, u_after_open, open_cu: meta.compute_units_consumed }
}

fn try_rung_tx(env: &mut Real, run: &RungRun, rung_index: u8) -> TransactionResult {
    let mut accounts = TryRungAccounts::new(&run.session.pubkey(), &run.user.pubkey(), &env.mint, &env.token_program);
    accounts.remaining = env.buy_metas(&vault_pda(&run.user.pubkey()), false, None);
    let ixs = [cu_limit_ix(CU_LIMIT), accounts.ix(rung_index)];
    let session = run.session.insecure_clone();
    env.send(&ixs, &session, &[])
}

// ---------------------------------------------------------------------------
// T1: a plain wallet buys directly from the real pump
// ---------------------------------------------------------------------------

#[test]
fn t1_plain_wallet_buys_from_real_pump() {
    let Some(mut env) = Real::load() else { return };
    let w = env.wallet(USER_AIRDROP);
    let me = w.pubkey();
    let (vt, vq) = env.reserves();
    println!("T1 fixture slot {} time {} mint {} token program {} decimals {}", env.slot, env.block_time, env.mint, env.token_program, env.decimals);
    println!("T1 reserves before: virtual_token {vt} virtual_quote {vq}");

    ok(&env.send(&[env.create_ata_ix(&me, &me)], &w, &[]), "create ATA");
    let b0 = env.balance(&me);
    let res = env.send(&[cu_limit_ix(CU_LIMIT), env.buy_ix(&me, AMOUNT, 1, None)], &w, &[]);
    let meta = ok(&res, "T1 direct buy_exact_quote_in_v3");
    let tokens = env.tokens(&env.user_ata(&me)).unwrap();
    let acc = env.account(&accumulator_pda(&me)).expect("user_volume_accumulator created");
    println!(
        "T1 OK tokens {tokens} | wallet paid {} (amount {AMOUNT} + accumulator rent {} + fee {SIG_FEE}) | CU {}",
        b0 - env.balance(&me),
        acc.lamports,
        meta.compute_units_consumed
    );
    println!("T1 accumulator owner {} len {} lamports {} (rent({}) = {})", acc.owner, acc.data.len(), acc.lamports, acc.data.len(), env.rent(acc.data.len()));
    if let Some(t) = trade_event(&meta) {
        println!("T1 TradeEvent {t:?}");
    }
    assert!(tokens > 0);
    assert_eq!(b0 - env.balance(&me), AMOUNT + acc.lamports + SIG_FEE);
}

// ---------------------------------------------------------------------------
// T2: Rung buys through the real pump; the buyer is the vault PDA
// ---------------------------------------------------------------------------

#[test]
fn t2_rung_vault_pda_buys_from_real_pump() {
    let Some(mut env) = Real::load() else { return };
    let quote = env.real_quote(AMOUNT);
    let run = open_rung_order(&mut env, quote);
    let user = run.user.pubkey();
    let vault = vault_pda(&user);
    let curve = curve_pda(&env.mint);
    let order = env.svm.get_account(&order_pda(&user)).unwrap();
    println!("T2 quote {quote} tokens for {AMOUNT} lamports; open_order CU {}; vault holds {}", run.open_cu, env.balance(&vault));
    let curve_before = env.balance(&curve);

    let res = try_rung_tx(&mut env, &run, 0);
    let cu = cu_of(&res);
    if let Err(f) = &res {
        println!("T2 try_rung(0) FAILED: {:?} CU {cu}\n{}", f.err, logs_of(&res));
    }
    let meta = ok(&res, "T2 try_rung(0) with the real pump");

    let user_ata = env.user_ata(&user);
    let tokens = env.tokens(&user_ata).unwrap();
    let o = env.order(&user);
    let acc = env.account(&accumulator_pda(&vault)).expect("vault's user_volume_accumulator");
    let returned = env.balance(&user) - run.u_after_open;
    let ata_rent = env.balance(&user_ata);
    println!("T2 OK try_rung CU {cu}");
    println!(
        "T2 tokens in user ATA {tokens} (quote {quote}) | order.tokens_bought {} lamports_spent {} status {:?}",
        o.tokens_bought, o.lamports_spent, o.status
    );
    println!(
        "T2 user got back {returned} of RENT_RESERVE {RENT_RESERVE} | user ATA rent {ata_rent} (len {}) | vault ATA exists {} | vault lamports {}",
        env.account(&user_ata).unwrap().data.len(),
        env.account(&env.user_ata(&vault)).is_some(),
        env.balance(&vault)
    );
    println!(
        "T2 vault accumulator {} owner {} len {} lamports {} (rent-exempt min {})",
        accumulator_pda(&vault),
        acc.owner,
        acc.data.len(),
        acc.lamports,
        env.rent(acc.data.len())
    );
    println!("T2 curve lamports +{} | order account lamports {}", env.balance(&curve) - curve_before, order.lamports);
    if let Some(t) = trade_event(&meta) {
        println!("T2 TradeEvent user {} (vault {vault}) {t:?}", t.user);
    }

    assert_eq!(o.status, OrderStatus::Filled);
    assert_eq!(o.filled_rung, 0);
    assert_eq!(tokens, quote);
    assert_eq!(o.tokens_bought, tokens);
    assert_eq!(o.lamports_spent, AMOUNT);
    assert_eq!(env.balance(&vault), 0);
    assert!(env.account(&env.user_ata(&vault)).is_none());
    assert_eq!(acc.owner, PUMP);
    assert_eq!(returned, RENT_RESERVE - ata_rent - acc.lamports);
}

// ---------------------------------------------------------------------------
// T3: a rung tighter than the real quote fails with pump's slippage error
// ---------------------------------------------------------------------------

#[test]
fn t3_tight_rung_fails_with_real_pump_slippage() {
    let Some(mut env) = Real::load() else { return };
    let quote = env.real_quote(AMOUNT);
    // 5% more than pump will give: the 1% rung asks for ~4% more than possible.
    let run = open_rung_order(&mut env, quote * 105 / 100);
    let user = run.user.pubkey();
    let vault_before = env.balance(&vault_pda(&user));
    let res = try_rung_tx(&mut env, &run, 0);
    let logs = logs_of(&res);
    println!("T3 try_rung(0) result {:?} CU {}", res.as_ref().err().map(|f| &f.err), cu_of(&res));
    for l in logs.lines().filter(|l| l.contains("Error") || l.contains("failed") || l.contains("6EF8rr")) {
        println!("T3 log: {l}");
    }
    assert_code(&res, PUMP_SLIPPAGE);
    assert!(logs.contains("Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P failed: custom program error: 0x179a"));
    let o = env.order(&user);
    assert_eq!(o.status, OrderStatus::Open);
    assert_eq!(env.balance(&vault_pda(&user)), vault_before);
}

// ---------------------------------------------------------------------------
// T4: compute units of try_rung against the real pump
// ---------------------------------------------------------------------------

#[test]
fn t4_try_rung_compute_units() {
    let Some(mut env) = Real::load() else { return };
    let quote = env.real_quote(AMOUNT);

    let tight = open_rung_order(&mut env, quote * 105 / 100);
    let fail = try_rung_tx(&mut env, &tight, 0);
    assert_code(&fail, PUMP_SLIPPAGE);

    let good = open_rung_order(&mut env, quote);
    let success = try_rung_tx(&mut env, &good, 0);
    ok(&success, "T4 try_rung");

    // A second order by the same vault owner would reuse the accumulator; a
    // fresh user always pays it. Measure the direct buy for comparison.
    let w = env.wallet(USER_AIRDROP);
    ok(&env.send(&[env.create_ata_ix(&w.pubkey(), &w.pubkey())], &w, &[]), "ATA");
    let direct = env.send(&[cu_limit_ix(CU_LIMIT), env.buy_ix(&w.pubkey(), AMOUNT, 1, None)], &w, &[]);
    ok(&direct, "direct buy");
    let direct_again = env.send(&[cu_limit_ix(CU_LIMIT), env.buy_ix(&w.pubkey(), AMOUNT, 1, None)], &w, &[]);
    ok(&direct_again, "direct buy (accumulator exists)");

    println!(
        "T4 CU: try_rung success {} | try_rung slippage fail {} | open_order {} | direct pump buy (new accumulator) {} | direct pump buy (accumulator exists) {}",
        cu_of(&success),
        cu_of(&fail),
        good.open_cu,
        cu_of(&direct),
        cu_of(&direct_again)
    );
    assert!(cu_of(&success) < CU_LIMIT as u64);
}

// ---------------------------------------------------------------------------
// T5: quote formula and the real fee rate
// ---------------------------------------------------------------------------

#[test]
fn t5_quote_formula_and_fee_rate() {
    let Some(mut env) = Real::load() else { return };
    let (vt, vq) = env.reserves();
    let curve = env.svm.get_account(&curve_pda(&env.mint)).unwrap().data;
    let global = env.svm.get_account(&global_pda()).unwrap().data;
    let fee_cfg = env.svm.get_account(&PUMP_FEE_CONFIG).unwrap().data;
    let mint = env.svm.get_account(&env.mint).unwrap().data;
    let supply = u64_at(&mint, 36);

    let g_fee_bps = u64_at(&global, 105);
    let g_creator_bps = u64_at(&global, 154);
    let g_buyback_bps = u64_at(&global, 997);
    let curve_creator_bps = u64_at(&curve, 115);
    let (flat, tiers, stable, exotic) = parse_fee_config(&fee_cfg);
    // FEE_PROGRAM_README: market cap = virtual_sol_reserves * supply / virtual_token_reserves.
    let mcap = vq as u128 * supply as u128 / vt as u128;
    let tier = tiers.iter().rev().find(|(t, _)| *t <= mcap).or(tiers.first()).map(|x| x.1);
    println!("T5 reserves vt {vt} vq {vq} supply {supply} market cap {mcap} lamports");
    println!("T5 global fee_basis_points {g_fee_bps} creator_fee_basis_points {g_creator_bps} buyback_basis_points {g_buyback_bps}; curve creator_fee_bps {curve_creator_bps}");
    println!("T5 fee_config flat {flat:?} exotic {exotic:?}");
    for (t, f) in &tiers {
        println!("T5 fee_config tier >= {t}: {f:?}");
    }
    println!("T5 fee_config stable tiers {}", stable.len());
    println!("T5 tier for this market cap: {tier:?}");

    let w = env.wallet(USER_AIRDROP);
    let me = w.pubkey();
    ok(&env.send(&[env.create_ata_ix(&me, &me)], &w, &[]), "ATA");
    let meta = ok(&env.send(&[cu_limit_ix(CU_LIMIT), env.buy_ix(&me, AMOUNT, 1, None)], &w, &[]), "T5 buy");
    let actual = env.tokens(&env.user_ata(&me)).unwrap();
    let t = trade_event(&meta).expect("TradeEvent");
    println!("T5 TradeEvent {t:?}");

    let raw = raw_quote(AMOUNT, vt, vq);
    let ev = a1_quote(AMOUNT, vt, vq, t.fee_basis_points, t.creator_fee_basis_points);
    let ev_bb = a1_quote(AMOUNT, vt, vq, t.fee_basis_points + t.buyback_fee_basis_points, t.creator_fee_basis_points);
    let total_bps = t.fee_basis_points + t.creator_fee_basis_points + t.buyback_fee_basis_points + t.cashback_fee_basis_points;
    println!("T5 actual tokens {actual}");
    println!("T5 (b) raw fee-free {raw}: actual/raw = {:.6} (diff {} tokens, {:.2} bps)", actual as f64 / raw as f64, raw - actual, (raw - actual) as f64 * 10_000.0 / raw as f64);
    println!("T5 (a) A1 with event protocol {} + creator {}: {ev} (diff {})", t.fee_basis_points, t.creator_fee_basis_points, actual as i128 - ev as i128);
    println!("T5 (a') A1 with protocol+buyback {} + creator {}: {ev_bb} (diff {})", t.fee_basis_points + t.buyback_fee_basis_points, t.creator_fee_basis_points, actual as i128 - ev_bb as i128);
    let tier_quote = tier.map(|f| a1_quote(AMOUNT, vt, vq, f.protocol, f.creator));
    if let Some(f) = tier {
        let q = a1_quote(AMOUNT, vt, vq, f.protocol, f.creator);
        let q_lp = a1_quote(AMOUNT, vt, vq, f.protocol + f.lp, f.creator);
        println!("T5 (a'') A1 with fee_config tier protocol {} creator {}: {q} (diff {}); with lp too: {q_lp} (diff {})", f.protocol, f.creator, actual as i128 - q as i128, actual as i128 - q_lp as i128);
    }
    println!(
        "T5 fees in event: fee {} creator_fee {} buyback_fee {} cashback {} | total bps {total_bps} | sol_amount {} quote_amount {} (spent {AMOUNT})",
        t.fee, t.creator_fee, t.buyback_fee, t.cashback, t.sol_amount, t.quote_amount
    );
    // Observed on the 2026-11-23 snapshot (pinned as found):
    // - the fee rates pump applies are the fee_config tier's protocol and
    //   creator bps (not Global.fee_basis_points / creator_fee_basis_points,
    //   not the curve's creator_fee_bps);
    // - the A1 formula with those two rates gives the exact token amount;
    // - the buyback share is taken out of the protocol fee, not added to it.
    let tier = tier.expect("fee tier");
    assert_eq!((t.fee_basis_points, t.creator_fee_basis_points), (tier.protocol, tier.creator));
    assert_eq!(tier_quote, Some(actual));
    assert_eq!(ev, actual);
    assert_eq!(t.buyback_fee, t.fee * t.buyback_fee_basis_points / 10_000);
    assert_eq!(t.token_amount, actual);
    assert!(actual < raw);
}

// ---------------------------------------------------------------------------
// T6: close_user_volume_accumulator after a buy
// ---------------------------------------------------------------------------

#[test]
fn t6_close_user_volume_accumulator() {
    let Some(mut env) = Real::load() else { return };
    let w = env.wallet(USER_AIRDROP);
    let me = w.pubkey();
    ok(&env.send(&[env.create_ata_ix(&me, &me)], &w, &[]), "ATA");
    ok(&env.send(&[cu_limit_ix(CU_LIMIT), env.buy_ix(&me, AMOUNT, 1, None)], &w, &[]), "T6 buy");
    let acc = accumulator_pda(&me);
    let acc_lamports = env.balance(&acc);
    let b0 = env.balance(&me);

    let close = Instruction {
        program_id: PUMP,
        accounts: vec![
            AccountMeta::new(me, true),
            AccountMeta::new(acc, false),
            AccountMeta::new_readonly(event_authority_pda(), false),
            AccountMeta::new_readonly(PUMP, false),
        ],
        data: CLOSE_USER_VOLUME_ACCUMULATOR.to_vec(),
    };
    let res = env.send(&[close], &w, &[]);
    println!("T6 accumulator {acc} had {acc_lamports} lamports; close result {:?}", res.as_ref().err().map(|f| &f.err));
    println!("T6 logs:\n{}", logs_of(&res));
    println!(
        "T6 after: accumulator exists {} | wallet delta {} (fee {SIG_FEE})",
        env.account(&acc).is_some(),
        env.balance(&me) as i128 - b0 as i128
    );
    // Observed: closes right after a buy; the rent goes to `user` (the signer).
    ok(&res, "T6 close_user_volume_accumulator");
    assert!(env.account(&acc).is_none());
    assert_eq!(env.balance(&me), b0 + acc_lamports - SIG_FEE);

    // Conditions: the same close on an accumulator that still records
    // something owed to the user (fields edited by hand).
    // UserVolumeAccumulator: disc 8, user 32, needs_claim @40, total_unclaimed_tokens @41,
    // total_claimed_tokens @49, current_sol_volume @57, last_update_timestamp @65,
    // has_total_claimed_tokens @73, cashback_earned @74.
    for (what, offset) in [
        ("needs_claim", 40usize),
        ("total_unclaimed_tokens", 41),
        ("current_sol_volume", 57),
        ("cashback_earned", 74),
    ] {
        let w = env.wallet(USER_AIRDROP);
        let me = w.pubkey();
        ok(&env.send(&[env.create_ata_ix(&me, &me)], &w, &[]), "ATA");
        ok(&env.send(&[cu_limit_ix(CU_LIMIT), env.buy_ix(&me, AMOUNT, 1, None)], &w, &[]), "buy");
        let acc = accumulator_pda(&me);
        let mut a = env.svm.get_account(&acc).unwrap();
        a.data[offset] = 1;
        env.svm.set_account(acc, a).unwrap();
        let close = Instruction {
            program_id: PUMP,
            accounts: vec![
                AccountMeta::new(me, true),
                AccountMeta::new(acc, false),
                AccountMeta::new_readonly(event_authority_pda(), false),
                AccountMeta::new_readonly(PUMP, false),
            ],
            data: CLOSE_USER_VOLUME_ACCUMULATOR.to_vec(),
        };
        let res = env.send(&[close], &w, &[]);
        let err_line = logs_of(&res).lines().find(|l| l.contains("Error Code")).map(str::to_owned);
        println!("T6 with {what} != 0: {:?} {:?}", res.as_ref().err().map(|f| &f.err), err_line);
        // Observed: pump closes it anyway (whatever was owed is forfeited).
        ok(&res, "T6 close with a non-zero field");
        assert!(env.account(&acc).is_none());
    }
}

// ---------------------------------------------------------------------------
// T7: tokens to another wallet's token account
// ---------------------------------------------------------------------------

#[test]
fn t7_associated_base_user_of_another_wallet() {
    let Some(mut env) = Real::load() else { return };
    let w = env.wallet(USER_AIRDROP);
    let me = w.pubkey();
    let other = Keypair::new().pubkey();
    let other_ata = env.user_ata(&other);
    ok(&env.send(&[env.create_ata_ix(&me, &other)], &w, &[]), "ATA of the other wallet");
    let res = env.send(&[cu_limit_ix(CU_LIMIT), env.buy_ix(&me, AMOUNT, 1, Some(other_ata))], &w, &[]);
    println!("T7 buy by {me} into {other_ata} (owner {other}): {:?}", res.as_ref().err().map(|f| &f.err));
    println!("T7 logs:\n{}", logs_of(&res));
    println!("T7 other ATA tokens {:?}", env.tokens(&other_ata));
    // Observed: accepted; the tokens land in the other wallet's account and
    // the buyer needs no token account of its own.
    ok(&res, "T7 buy into another wallet's ATA");
    assert!(env.tokens(&other_ata).unwrap() > 0);
    assert!(env.account(&env.user_ata(&me)).is_none());
}
