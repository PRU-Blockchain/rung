//! Shared LiteSVM harness for Rung's tests. It loads Rung and the pump test
//! double (`test-programs/mock-pump`, at pump's address), packs mint, token and
//! bonding-curve accounts by hand, builds Rung's four instructions and reads
//! back errors, balances, accounts and events.
#![allow(dead_code)]

use std::path::PathBuf;

use anchor_lang::{
    prelude::{AccountMeta, Pubkey},
    pubkey,
    solana_program::{
        clock::Clock,
        instruction::{error::InstructionError, Instruction},
        system_instruction,
    },
    AccountDeserialize, AnchorDeserialize, Discriminator, InstructionData, ToAccountMetas,
};
use litesvm::{types::TransactionResult, LiteSVM};
use rung::{error::RungError, state::Order, OpenOrderArgs, Venue};
use solana_account::Account;
use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_transaction::Transaction;
use solana_transaction_error::TransactionError;

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

pub const PUMP: Pubkey = rung::venue::PUMP_PROGRAM_ID;
pub const SYSTEM: Pubkey = anchor_lang::solana_program::system_program::ID;
pub const TOKEN: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const TOKEN_2022: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
pub const ATA_PROGRAM: Pubkey = pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
pub const WSOL: Pubkey = pubkey!("So11111111111111111111111111111111111111112");
pub const COMPUTE_BUDGET: Pubkey = pubkey!("ComputeBudget111111111111111111111111111111");
/// pump `fee_config` (docs/pump-arayuz.md, section 0).
pub const PUMP_FEE_CONFIG: Pubkey = pubkey!("8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt");
/// First buyback fee recipient listed in docs/pump-arayuz.md, section J.
pub const BUYBACK_RECIPIENT: Pubkey = pubkey!("5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD");

// ---------------------------------------------------------------------------
// Test numbers (test choices, not pump's real values)
// ---------------------------------------------------------------------------

/// LiteSVM's default fee per signature.
pub const SIG_FEE: u64 = 5_000;
pub const DECIMALS: u8 = 6;
pub const VIRTUAL_TOKEN: u64 = 1_073_000_000_000_000;
pub const VIRTUAL_QUOTE: u64 = 30_000_000_000;
/// Tokens held by the curve's token account.
pub const CURVE_TOKENS: u64 = 800_000_000_000_000;
pub const AMOUNT: u64 = 100_000_000;
pub const RENT_RESERVE: u64 = 8_000_000;
/// Must be at least the rent-exempt minimum of an empty account (890,880),
/// otherwise funding a fresh session key fails the runtime's rent check.
pub const FEE_BUDGET: u64 = 1_000_000;
pub const WINDOW: u64 = 4;
pub const LIFETIME: u64 = 100;
pub const START_SLOT: u64 = 1_000;
pub const USER_AIRDROP: u64 = 10_000_000_000;
pub const CU_LIMIT: u32 = 1_400_000;

// ---------------------------------------------------------------------------
// PDAs
// ---------------------------------------------------------------------------

pub fn order_pda(user: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[rung::ORDER_SEED, user.as_ref()], &rung::ID).0
}
pub fn vault_pda(user: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[rung::VAULT_SEED, user.as_ref()], &rung::ID).0
}
pub fn order_bumps(user: &Pubkey) -> (u8, u8) {
    let order = Pubkey::find_program_address(&[rung::ORDER_SEED, user.as_ref()], &rung::ID).1;
    let vault = Pubkey::find_program_address(&[rung::VAULT_SEED, user.as_ref()], &rung::ID).1;
    (order, vault)
}
pub fn curve_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"bonding-curve", mint.as_ref()], &PUMP).0
}
pub fn global_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"global"], &PUMP).0
}
pub fn event_authority_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"__event_authority"], &PUMP).0
}
pub fn accumulator_pda(buyer: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"user_volume_accumulator", buyer.as_ref()], &PUMP).0
}
pub fn ata(owner: &Pubkey, mint: &Pubkey, token_program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[owner.as_ref(), token_program.as_ref(), mint.as_ref()],
        &ATA_PROGRAM,
    )
    .0
}

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

pub fn rung_code(e: RungError) -> u32 {
    u32::from(e)
}
pub fn anchor_code(e: anchor_lang::error::ErrorCode) -> u32 {
    u32::from(e)
}
/// pump's `BuySlippageBelowMinTokensOut` (docs/pump-arayuz.md, section G).
pub const PUMP_SLIPPAGE: u32 = 6042;
/// System program `ResultWithNegativeLamports`: a transfer or account creation
/// asked for more lamports than the payer had.
pub const SYSTEM_NOT_ENOUGH_LAMPORTS: u32 = 1;

/// Returns the custom error code of a failed transaction. Panics, with the
/// logs, if the transaction succeeded or failed some other way.
pub fn custom_code(res: &TransactionResult) -> u32 {
    match res {
        Ok(meta) => panic!("transaction succeeded, expected an error\n{}", meta.pretty_logs()),
        Err(failed) => match &failed.err {
            TransactionError::InstructionError(_, InstructionError::Custom(code)) => *code,
            other => panic!(
                "expected a custom program error, got {other:?}\n{}",
                failed.meta.pretty_logs()
            ),
        },
    }
}

#[track_caller]
pub fn assert_code(res: &TransactionResult, expected: u32) {
    let got = custom_code(res);
    if got != expected {
        let logs = res.as_ref().err().map(|f| f.meta.pretty_logs()).unwrap_or_default();
        panic!("expected custom error {expected}, got {got}\n{logs}");
    }
}

#[track_caller]
pub fn assert_rung_err(res: &TransactionResult, e: RungError) {
    assert_code(res, rung_code(e));
}

#[track_caller]
pub fn assert_anchor_err(res: &TransactionResult, e: anchor_lang::error::ErrorCode) {
    assert_code(res, anchor_code(e));
}

#[track_caller]
pub fn assert_ok(res: &TransactionResult) -> litesvm::types::TransactionMetadata {
    match res {
        Ok(meta) => meta.clone(),
        Err(failed) => panic!("transaction failed: {:?}\n{}", failed.err, failed.meta.pretty_logs()),
    }
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

/// Copy of the test double's quote (pump IDL formula, single fee of
/// `mock_pump::FEE_BPS`). Kept separate from the double on purpose; a test in
/// `mock_pump.rs` checks that the two agree.
pub fn mock_quote(spendable: u64, virtual_token: u64, virtual_quote: u64) -> u64 {
    let net = spendable as u128 * 10_000 / (10_000 + mock_pump::FEE_BPS as u128);
    assert!(net > 1, "amount too small for a quote");
    let tokens = (net - 1) * virtual_token as u128 / (virtual_quote as u128 + net - 1);
    u64::try_from(tokens).unwrap()
}

/// Fee-free constant-product quote, the one the app sends as `raw_tokens_seen`.
pub fn raw_quote(lamports: u64, virtual_token: u64, virtual_quote: u64) -> u64 {
    let tokens =
        lamports as u128 * virtual_token as u128 / (virtual_quote as u128 + lamports as u128);
    u64::try_from(tokens).unwrap()
}

/// `expected_tokens_start` as the spec defines it:
/// `floor(expected_tokens_seen * raw_quote(amount, reserves now) / raw_tokens_seen)`.
pub fn expected_start(seen: u64, raw_seen: u64, amount: u64, vt_now: u64, vq_now: u64) -> u64 {
    let raw_now = raw_quote(amount, vt_now, vq_now) as u128;
    u64::try_from(seen as u128 * raw_now / raw_seen as u128).unwrap()
}

/// Virtual quote reserves that make the price `bps` basis points higher
/// (fewer tokens per SOL) than `vq`, for the same token reserves.
pub fn quote_reserves_up(vq: u64, bps: u64) -> u64 {
    (vq as u128 * (10_000 + bps as u128) / 10_000) as u64
}

// ---------------------------------------------------------------------------
// Hand-packed SPL accounts (no SPL crates)
// ---------------------------------------------------------------------------

/// SPL `Mint`, 82 bytes: mint_authority COption<Pubkey>, supply u64,
/// decimals u8, is_initialized bool, freeze_authority COption<Pubkey>.
pub fn pack_mint(decimals: u8, supply: u64) -> Vec<u8> {
    let mut d = Vec::with_capacity(82);
    d.extend_from_slice(&[0u8; 4]); // mint_authority: None
    d.extend_from_slice(&[0u8; 32]);
    d.extend_from_slice(&supply.to_le_bytes());
    d.push(decimals);
    d.push(1); // is_initialized
    d.extend_from_slice(&[0u8; 4]); // freeze_authority: None
    d.extend_from_slice(&[0u8; 32]);
    assert_eq!(d.len(), 82);
    d
}

/// SPL `Account`, 165 bytes: mint, owner, amount, delegate COption<Pubkey>,
/// state u8 (1 = initialized), is_native COption<u64>, delegated_amount u64,
/// close_authority COption<Pubkey>.
pub fn pack_token_account(mint: &Pubkey, owner: &Pubkey, amount: u64) -> Vec<u8> {
    let mut d = Vec::with_capacity(165);
    d.extend_from_slice(mint.as_ref());
    d.extend_from_slice(owner.as_ref());
    d.extend_from_slice(&amount.to_le_bytes());
    d.extend_from_slice(&[0u8; 36]); // delegate: None
    d.push(1); // state: Initialized
    d.extend_from_slice(&[0u8; 12]); // is_native: None
    d.extend_from_slice(&0u64.to_le_bytes()); // delegated_amount
    d.extend_from_slice(&[0u8; 36]); // close_authority: None
    assert_eq!(d.len(), 165);
    d
}

/// pump `BondingCurve` prefix: discriminator, five u64 fields, `complete`.
pub fn pack_curve(virtual_token: u64, virtual_quote: u64, complete: bool) -> Vec<u8> {
    let mut d = rung::venue::BONDING_CURVE_DISCRIMINATOR.to_vec();
    d.extend_from_slice(&virtual_token.to_le_bytes());
    d.extend_from_slice(&virtual_quote.to_le_bytes());
    d.extend_from_slice(&CURVE_TOKENS.to_le_bytes()); // real_token_reserves
    d.extend_from_slice(&0u64.to_le_bytes()); // real_quote_reserves
    d.extend_from_slice(&1_000_000_000_000_000u64.to_le_bytes()); // token_total_supply
    d.push(complete as u8);
    d
}

/// Reads the `amount` field of a token account.
pub fn token_amount(data: &[u8]) -> u64 {
    u64::from_le_bytes(data[64..72].try_into().unwrap())
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

fn base64_decode(s: &str) -> Vec<u8> {
    let mut out = Vec::new();
    let (mut buf, mut bits) = (0u32, 0u32);
    for c in s.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            _ => continue,
        } as u32;
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    out
}

/// Every Anchor event of type `T` in the logs (`Program data: <base64>`).
pub fn events<T: AnchorDeserialize + Discriminator>(logs: &[String]) -> Vec<T> {
    logs.iter()
        .filter_map(|l| l.strip_prefix("Program data: "))
        .map(base64_decode)
        .filter(|d| d.len() >= T::DISCRIMINATOR.len() && d.starts_with(T::DISCRIMINATOR))
        .map(|d| T::deserialize(&mut &d[T::DISCRIMINATOR.len()..]).expect("event decodes"))
        .collect()
}

// ---------------------------------------------------------------------------
// Order parameters
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
pub struct OrderSpec {
    pub venue: Venue,
    pub rungs_bps: Vec<u16>,
    pub amount: u64,
    pub rent_reserve: u64,
    pub fee_budget: u64,
    pub expected_tokens_seen: u64,
    pub raw_tokens_seen: u64,
    pub window_slots: u64,
    pub lifetime_slots: u64,
}

impl OrderSpec {
    /// Default order, quoted by the "app" at the given reserves:
    /// 1% then 3% (cap), 4-slot window, 100-slot lifetime.
    pub fn quoted_at(amount: u64, virtual_token: u64, virtual_quote: u64) -> Self {
        Self {
            venue: Venue::Curve,
            rungs_bps: vec![100, 300],
            amount,
            rent_reserve: RENT_RESERVE,
            fee_budget: FEE_BUDGET,
            expected_tokens_seen: mock_quote(amount, virtual_token, virtual_quote),
            raw_tokens_seen: raw_quote(amount, virtual_token, virtual_quote),
            window_slots: WINDOW,
            lifetime_slots: LIFETIME,
        }
    }

    pub fn with_rungs(mut self, rungs: &[u16]) -> Self {
        self.rungs_bps = rungs.to_vec();
        self
    }

    pub fn args(&self) -> OpenOrderArgs {
        OpenOrderArgs {
            venue: self.venue,
            rungs_bps: self.rungs_bps.clone(),
            amount: self.amount,
            rent_reserve: self.rent_reserve,
            fee_budget: self.fee_budget,
            expected_tokens_seen: self.expected_tokens_seen,
            raw_tokens_seen: self.raw_tokens_seen,
            window_slots: self.window_slots,
            lifetime_slots: self.lifetime_slots,
        }
    }
}

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

pub fn open_order_ix(
    user: &Pubkey,
    session_key: &Pubkey,
    mint: &Pubkey,
    venue_state: &Pubkey,
    args: OpenOrderArgs,
) -> Instruction {
    Instruction {
        program_id: rung::ID,
        accounts: rung::accounts::OpenOrder {
            user: *user,
            session_key: *session_key,
            mint: *mint,
            order: order_pda(user),
            vault: vault_pda(user),
            venue_state: *venue_state,
            system_program: SYSTEM,
        }
        .to_account_metas(None),
        data: rung::instruction::OpenOrder { args }.data(),
    }
}

/// The 17 accounts of pump's `buy_exact_quote_in_v3` (docs/pump-arayuz.md A3)
/// for `buyer` buying `mint` on a SOL-paired curve.
pub fn buy_accounts(
    buyer: &Pubkey,
    mint: &Pubkey,
    token_program: &Pubkey,
    buyer_signs: bool,
) -> Vec<AccountMeta> {
    let curve = curve_pda(mint);
    vec![
        AccountMeta::new_readonly(global_pda(), false), // 0 global
        AccountMeta::new_readonly(*mint, false),        // 1 base_mint
        AccountMeta::new_readonly(WSOL, false),         // 2 quote_mint
        AccountMeta::new_readonly(*token_program, false), // 3 base_token_program
        AccountMeta::new_readonly(TOKEN, false),        // 4 quote_token_program
        AccountMeta::new(curve, false),                 // 5 bonding_curve
        AccountMeta::new(ata(&curve, mint, token_program), false), // 6 associated_base_bonding_curve
        AccountMeta::new(ata(&curve, &WSOL, &TOKEN), false), // 7 associated_quote_bonding_curve
        AccountMeta::new(*buyer, buyer_signs),          // 8 user
        AccountMeta::new(ata(buyer, mint, token_program), false), // 9 associated_base_user
        AccountMeta::new(ata(buyer, &WSOL, &TOKEN), false), // 10 associated_quote_user
        AccountMeta::new(accumulator_pda(buyer), false), // 11 user_volume_accumulator
        AccountMeta::new_readonly(PUMP_FEE_CONFIG, false), // 12 fee_config
        AccountMeta::new(BUYBACK_RECIPIENT, false),     // 13 buyback_fee_recipient
        AccountMeta::new_readonly(SYSTEM, false),       // 14 system_program
        AccountMeta::new_readonly(event_authority_pda(), false), // 15 event_authority
        AccountMeta::new_readonly(PUMP, false),         // 16 program
    ]
}

/// A direct `buy_exact_quote_in_v3` call to the test double.
pub fn mock_buy_ix(
    buyer: &Pubkey,
    mint: &Pubkey,
    token_program: &Pubkey,
    spendable: u64,
    min_tokens_out: u64,
) -> Instruction {
    Instruction {
        program_id: PUMP,
        accounts: buy_accounts(buyer, mint, token_program, true),
        data: mock_pump::instruction::BuyExactQuoteInV3 {
            spendable_quote_in: spendable,
            min_tokens_out,
            partial_fill: mock_pump::OptionBool(false),
        }
        .data(),
    }
}

/// Every account of `try_rung`, so a test can swap any of them.
#[derive(Clone, Debug)]
pub struct TryRungAccounts {
    pub session_key: Pubkey,
    pub order: Pubkey,
    pub user: Pubkey,
    pub vault: Pubkey,
    pub mint: Pubkey,
    pub user_token_account: Pubkey,
    pub vault_token_account: Pubkey,
    pub token_program: Pubkey,
    pub associated_token_program: Pubkey,
    pub system_program: Pubkey,
    pub remaining: Vec<AccountMeta>,
}

impl TryRungAccounts {
    pub fn new(session_key: &Pubkey, user: &Pubkey, mint: &Pubkey, token_program: &Pubkey) -> Self {
        let vault = vault_pda(user);
        Self {
            session_key: *session_key,
            order: order_pda(user),
            user: *user,
            vault,
            mint: *mint,
            user_token_account: ata(user, mint, token_program),
            vault_token_account: ata(&vault, mint, token_program),
            token_program: *token_program,
            associated_token_program: ATA_PROGRAM,
            system_program: SYSTEM,
            remaining: buy_accounts(&vault, mint, token_program, false),
        }
    }

    pub fn ix(&self, rung_index: u8) -> Instruction {
        let mut accounts = rung::accounts::TryRung {
            session_key: self.session_key,
            order: self.order,
            user: self.user,
            vault: self.vault,
            mint: self.mint,
            user_token_account: self.user_token_account,
            vault_token_account: self.vault_token_account,
            token_program: self.token_program,
            associated_token_program: self.associated_token_program,
            system_program: self.system_program,
        }
        .to_account_metas(None);
        accounts.extend(self.remaining.iter().cloned());
        Instruction {
            program_id: rung::ID,
            accounts,
            data: rung::instruction::TryRung { rung_index }.data(),
        }
    }
}

pub fn refund_ix(caller: &Pubkey, user: &Pubkey) -> Instruction {
    refund_ix_with(caller, &order_pda(user), user, &vault_pda(user))
}

pub fn refund_ix_with(caller: &Pubkey, order: &Pubkey, user: &Pubkey, vault: &Pubkey) -> Instruction {
    Instruction {
        program_id: rung::ID,
        accounts: rung::accounts::Refund {
            caller: *caller,
            order: *order,
            user: *user,
            vault: *vault,
            system_program: SYSTEM,
        }
        .to_account_metas(None),
        data: rung::instruction::Refund {}.data(),
    }
}

pub fn cancel_ix(user: &Pubkey) -> Instruction {
    cancel_ix_with(user, &order_pda(user), &vault_pda(user))
}

pub fn cancel_ix_with(user: &Pubkey, order: &Pubkey, vault: &Pubkey) -> Instruction {
    Instruction {
        program_id: rung::ID,
        accounts: rung::accounts::Cancel {
            user: *user,
            order: *order,
            vault: *vault,
            system_program: SYSTEM,
        }
        .to_account_metas(None),
        data: rung::instruction::Cancel {}.data(),
    }
}

/// `ComputeBudgetInstruction::SetComputeUnitLimit` (tag 2, u32 LE), built by
/// hand to avoid another dependency. It does not change the fee.
pub fn cu_limit_ix(units: u32) -> Instruction {
    let mut data = vec![2u8];
    data.extend_from_slice(&units.to_le_bytes());
    Instruction { program_id: COMPUTE_BUDGET, accounts: vec![], data }
}

// ---------------------------------------------------------------------------
// The environment
// ---------------------------------------------------------------------------

fn deploy_path(name: &str) -> PathBuf {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/deploy")
        .join(format!("{name}.so"));
    assert!(
        path.exists(),
        "{} is missing. Run `cargo build-sbf --manifest-path test-programs/mock-pump/Cargo.toml && anchor build` first.",
        path.display()
    );
    path
}

/// Snapshot of every balance and account a rejected transaction must leave
/// untouched.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct State {
    pub user_lamports: u64,
    pub vault_lamports: u64,
    pub session_lamports: u64,
    pub order: Option<(u64, Vec<u8>)>,
    pub user_ata: Option<(u64, Vec<u8>)>,
    pub vault_ata: Option<(u64, Vec<u8>)>,
    pub curve: Option<(u64, Vec<u8>)>,
    pub curve_ata: Option<(u64, Vec<u8>)>,
}

impl State {
    /// The same state after the session key paid `fee` for a rejected transaction.
    pub fn session_paid(&self, fee: u64) -> State {
        let mut s = self.clone();
        s.session_lamports -= fee;
        s
    }

    /// The same state after the user paid `fee` for a rejected transaction.
    pub fn user_paid(&self, fee: u64) -> State {
        let mut s = self.clone();
        s.user_lamports -= fee;
        s
    }
}

pub struct Env {
    pub svm: LiteSVM,
    pub user: Keypair,
    pub session: Keypair,
    pub mint: Pubkey,
    pub token_program: Pubkey,
}

impl Env {
    /// Fresh SVM with Rung, the pump double, an SPL Token mint, its curve at
    /// the default reserves, a funded user and an unfunded session key.
    pub fn new() -> Self {
        Self::with_token_program(TOKEN)
    }

    pub fn with_token_program(token_program: Pubkey) -> Self {
        let mut svm = LiteSVM::new();
        svm.add_program_from_file(rung::ID, deploy_path("rung")).unwrap();
        svm.add_program_from_file(PUMP, deploy_path("mock_pump")).unwrap();
        svm.warp_to_slot(START_SLOT);
        let user = Keypair::new();
        svm.airdrop(&user.pubkey(), USER_AIRDROP).unwrap();
        let mut env = Self {
            svm,
            user,
            session: Keypair::new(),
            mint: Keypair::new().pubkey(),
            token_program,
        };
        let mint = env.mint;
        env.create_mint(&mint, token_program);
        env.create_curve(&mint, VIRTUAL_TOKEN, VIRTUAL_QUOTE, false);
        env
    }

    // --- accounts -------------------------------------------------------

    pub fn rent(&self, len: usize) -> u64 {
        self.svm.minimum_balance_for_rent_exemption(len)
    }

    pub fn put(&mut self, address: &Pubkey, owner: &Pubkey, data: Vec<u8>, lamports: u64) {
        self.svm
            .set_account(
                *address,
                Account { lamports, data, owner: *owner, executable: false, rent_epoch: 0 },
            )
            .unwrap();
    }

    pub fn create_mint(&mut self, mint: &Pubkey, token_program: Pubkey) {
        let lamports = self.rent(82);
        self.put(mint, &token_program, pack_mint(DECIMALS, 1_000_000_000_000_000), lamports);
    }

    pub fn create_token_account(
        &mut self,
        address: &Pubkey,
        mint: &Pubkey,
        owner: &Pubkey,
        amount: u64,
        token_program: Pubkey,
    ) {
        let lamports = self.rent(165);
        self.put(address, &token_program, pack_token_account(mint, owner, amount), lamports);
    }

    /// Curve account (owned by pump) and the curve's token account.
    pub fn create_curve(&mut self, mint: &Pubkey, virtual_token: u64, virtual_quote: u64, complete: bool) {
        let curve = curve_pda(mint);
        let data = pack_curve(virtual_token, virtual_quote, complete);
        let lamports = self.rent(data.len());
        self.put(&curve, &PUMP, data, lamports);
        let tp = self.token_program;
        self.create_token_account(&ata(&curve, mint, &tp), mint, &curve, CURVE_TOKENS, tp);
    }

    /// Rewrites the curve reserves of `self.mint`, keeping its lamports.
    pub fn set_price(&mut self, virtual_token: u64, virtual_quote: u64) {
        let curve = curve_pda(&self.mint);
        let lamports = self.balance(&curve);
        self.put(&curve, &PUMP, pack_curve(virtual_token, virtual_quote, false), lamports);
    }

    pub fn reserves(&self) -> (u64, u64) {
        let data = self.svm.get_account(&curve_pda(&self.mint)).unwrap().data;
        let r = rung::venue::parse_curve_reserves(&data).unwrap();
        (r.virtual_token_reserves, r.virtual_quote_reserves)
    }

    /// Turns the double's cheat switch on or off (`global` data byte 0).
    pub fn set_cheat(&mut self, on: bool) {
        let lamports = self.rent(1);
        self.put(&global_pda(), &PUMP, vec![on as u8], lamports);
    }

    pub fn balance(&self, address: &Pubkey) -> u64 {
        self.svm.get_balance(address).unwrap_or(0)
    }

    pub fn exists(&self, address: &Pubkey) -> bool {
        self.svm.get_account(address).map(|a| a.lamports > 0).unwrap_or(false)
    }

    pub fn tokens(&self, token_account: &Pubkey) -> Option<u64> {
        self.svm
            .get_account(token_account)
            .filter(|a| a.lamports > 0 && a.data.len() >= 165)
            .map(|a| token_amount(&a.data))
    }

    pub fn order(&self, user: &Pubkey) -> Option<Order> {
        self.svm
            .get_account(&order_pda(user))
            .filter(|a| a.lamports > 0 && a.owner == rung::ID)
            .map(|a| Order::try_deserialize(&mut a.data.as_slice()).expect("order decodes"))
    }

    pub fn user_ata(&self, user: &Pubkey) -> Pubkey {
        ata(user, &self.mint, &self.token_program)
    }

    pub fn vault_ata(&self, user: &Pubkey) -> Pubkey {
        ata(&vault_pda(user), &self.mint, &self.token_program)
    }

    fn raw(&self, address: &Pubkey) -> Option<(u64, Vec<u8>)> {
        self.svm
            .get_account(address)
            .filter(|a| a.lamports > 0)
            .map(|a| (a.lamports, a.data))
    }

    pub fn state_of(&self, user: &Pubkey, session: &Pubkey) -> State {
        let curve = curve_pda(&self.mint);
        State {
            user_lamports: self.balance(user),
            vault_lamports: self.balance(&vault_pda(user)),
            session_lamports: self.balance(session),
            order: self.raw(&order_pda(user)),
            user_ata: self.raw(&self.user_ata(user)),
            vault_ata: self.raw(&self.vault_ata(user)),
            curve: self.raw(&curve),
            curve_ata: self.raw(&ata(&curve, &self.mint, &self.token_program)),
        }
    }

    /// State of the default user and session key.
    pub fn state(&self) -> State {
        self.state_of(&self.user.pubkey(), &self.session.pubkey())
    }

    // --- slots ----------------------------------------------------------

    pub fn slot(&self) -> u64 {
        self.svm.get_sysvar::<Clock>().slot
    }

    pub fn warp(&mut self, slot: u64) {
        self.svm.warp_to_slot(slot);
    }

    // --- sending --------------------------------------------------------

    /// Signs and sends `ixs`; `payer` pays the fee and signs. A fresh blockhash
    /// each time, so two identical transactions are never deduplicated.
    pub fn send(&mut self, ixs: &[Instruction], payer: &Keypair, others: &[&Keypair]) -> TransactionResult {
        self.svm.expire_blockhash();
        let mut signers: Vec<&Keypair> = vec![payer];
        signers.extend_from_slice(others);
        let tx = Transaction::new_signed_with_payer(
            ixs,
            Some(&payer.pubkey()),
            &signers,
            self.svm.latest_blockhash(),
        );
        self.svm.send_transaction(tx)
    }

    pub fn new_funded_keypair(&mut self, lamports: u64) -> Keypair {
        let kp = Keypair::new();
        self.svm.airdrop(&kp.pubkey(), lamports).unwrap();
        kp
    }

    /// Plain system transfer (used to pre-fund PDAs the way an attacker could).
    pub fn transfer(&mut self, from: &Keypair, to: &Pubkey, lamports: u64) -> TransactionResult {
        let ix = system_instruction::transfer(&from.pubkey(), to, lamports);
        self.send(&[ix], from, &[])
    }

    // --- Rung instructions ----------------------------------------------

    /// Default order spec, quoted at the curve's current reserves.
    pub fn spec(&self) -> OrderSpec {
        let (vt, vq) = self.reserves();
        OrderSpec::quoted_at(AMOUNT, vt, vq)
    }

    pub fn open_order_as(&mut self, user: &Keypair, session: &Pubkey, spec: &OrderSpec) -> TransactionResult {
        let venue_state = curve_pda(&self.mint);
        self.open_order_full(user, session, &self.mint.clone(), &venue_state, spec)
    }

    pub fn open_order_full(
        &mut self,
        user: &Keypair,
        session: &Pubkey,
        mint: &Pubkey,
        venue_state: &Pubkey,
        spec: &OrderSpec,
    ) -> TransactionResult {
        let ix = open_order_ix(&user.pubkey(), session, mint, venue_state, spec.args());
        self.send(&[ix], user, &[])
    }

    /// Opens `spec` for the default user and session key.
    pub fn open_order(&mut self, spec: &OrderSpec) -> TransactionResult {
        let user = self.user.insecure_clone();
        let session = self.session.pubkey();
        self.open_order_as(&user, &session, spec)
    }

    /// Opens the default order and panics if it fails.
    pub fn open_default(&mut self) -> OrderSpec {
        let spec = self.spec();
        assert_ok(&self.open_order(&spec));
        spec
    }

    pub fn try_accounts(&self) -> TryRungAccounts {
        TryRungAccounts::new(&self.session.pubkey(), &self.user.pubkey(), &self.mint, &self.token_program)
    }

    pub fn try_accounts_for(&self, session: &Pubkey, user: &Pubkey) -> TryRungAccounts {
        TryRungAccounts::new(session, user, &self.mint, &self.token_program)
    }

    /// Sends `try_rung` with `accounts`, signed and paid by `signer`.
    pub fn try_rung_with(&mut self, signer: &Keypair, accounts: &TryRungAccounts, rung_index: u8) -> TransactionResult {
        let ixs = [cu_limit_ix(CU_LIMIT), accounts.ix(rung_index)];
        self.send(&ixs, signer, &[])
    }

    /// Default user's order, tried by the default session key.
    pub fn try_rung(&mut self, rung_index: u8) -> TransactionResult {
        let accounts = self.try_accounts();
        let session = self.session.insecure_clone();
        self.try_rung_with(&session, &accounts, rung_index)
    }

    pub fn refund(&mut self, caller: &Keypair, user: &Pubkey) -> TransactionResult {
        let ix = refund_ix(&caller.pubkey(), user);
        self.send(&[ix], caller, &[])
    }

    pub fn cancel(&mut self, user: &Keypair) -> TransactionResult {
        let ix = cancel_ix(&user.pubkey());
        self.send(&[ix], user, &[])
    }

    /// Lamports the default session key needs to have been funded with, and
    /// pays for, the default order.
    pub fn order_rent(&self) -> u64 {
        self.rent(8 + <Order as anchor_lang::Space>::INIT_SPACE)
    }
}

/// Expected token floor of a rung, as the spec defines it (`math::min_tokens_for_rung`).
pub fn min_tokens(order: &Order, rung_index: usize) -> u64 {
    rung::math::min_tokens_for_rung(
        order.expected_tokens_seen,
        order.expected_tokens_start,
        order.rungs_bps[rung_index],
        order.cap_bps(),
    )
    .unwrap()
}

/// Same, from raw numbers (for preconditions computed before the order exists).
pub fn min_tokens_raw(seen: u64, start: u64, rung_bps: u16, cap_bps: u16) -> u64 {
    rung::math::min_tokens_for_rung(seen, start, rung_bps, cap_bps).unwrap()
}
