//! PumpSwap (pump.fun AMM) part of the harness: addresses and PDAs from
//! `docs/pump-arayuz.md` (B2, E, K), a hand-packed `Pool` account, wrapped SOL
//! helpers, the 17 accounts of `buy_exact_quote_in_v2`, and `AmmEnv`: the
//! curve `Env` plus the AMM test double (`test-programs/mock-pump-amm`, at
//! PumpSwap's address) and one canonical SOL pool for the env's mint.
#![allow(dead_code)]

use std::ops::{Deref, DerefMut};

use super::*;

// ---------------------------------------------------------------------------
// Addresses (docs/pump-arayuz.md, sections 0 and K)
// ---------------------------------------------------------------------------

pub const PUMP_SWAP: Pubkey = pubkey!("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
pub const PUMP_FEES: Pubkey = pubkey!("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
/// PumpSwap `GlobalConfig`, `["global_config"]`.
pub const AMM_GLOBAL_CONFIG: Pubkey = pubkey!("ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw");
/// Pump Fees `fee_config` of PumpSwap, `["fee_config", PumpSwap id]`.
pub const AMM_FEE_CONFIG: Pubkey = pubkey!("5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx");
/// A quote mint that is not wrapped SOL (mainnet USDC).
pub const USDC: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

/// `buy_exact_quote_in_v2` discriminator (idl/pump_amm.json).
pub const BUY_EXACT_QUOTE_IN_V2: [u8; 8] = [194, 171, 28, 70, 104, 77, 91, 47];
/// PumpSwap's `Pool` account discriminator (IDL).
pub const POOL_DISCRIMINATOR: [u8; 8] = [241, 154, 109, 4, 17, 177, 109, 188];

// ---------------------------------------------------------------------------
// Error codes (idl/pump_amm.json, docs/pump-arayuz.md G)
// ---------------------------------------------------------------------------

/// `BuySlippageBelowMinBaseAmountOut`.
pub const AMM_SLIPPAGE: u32 = 6040;
/// `CashbackCoinNotSupported`.
pub const AMM_CASHBACK_NOT_SUPPORTED: u32 = 6079;
/// `MayhemPoolNotSupported`.
pub const AMM_MAYHEM_NOT_SUPPORTED: u32 = 6080;

// ---------------------------------------------------------------------------
// Test numbers (test choices)
// ---------------------------------------------------------------------------

/// Tokens in the pool's base account.
pub const POOL_BASE: u64 = 200_000_000_000_000;
/// Wrapped SOL in the pool's quote account.
pub const POOL_QUOTE: u64 = 85_000_000_000;
/// A PumpSwap buy needs one more account than a curve buy (the vault's
/// wrapped SOL account), so the default PumpSwap order sends the largest rent
/// reserve the program allows: 3 token accounts + the volume accumulator.
pub const AMM_RENT_RESERVE: u64 = rung::MAX_RENT_RESERVE_LAMPORTS;
pub const WSOL_DECIMALS: u8 = 9;

// ---------------------------------------------------------------------------
// PDAs
// ---------------------------------------------------------------------------

/// pump's pool authority: `["pool-authority", mint]` under pump (IDL `migrate`,
/// `migrate_v2`; FEE_PROGRAM_README `isPumpPool`).
pub fn pool_authority_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"pool-authority", mint.as_ref()], &PUMP).0
}

/// `["pool", index (u16 LE), creator, base_mint, quote_mint]` under PumpSwap.
pub fn pool_pda(index: u16, creator: &Pubkey, base_mint: &Pubkey, quote_mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"pool", &index.to_le_bytes(), creator.as_ref(), base_mint.as_ref(), quote_mint.as_ref()],
        &PUMP_SWAP,
    )
}

/// The pool pump's `migrate` creates for `mint`: index 0, creator = pump's
/// pool authority, quote = wrapped SOL.
pub fn canonical_pool(mint: &Pubkey) -> Pubkey {
    pool_pda(0, &pool_authority_pda(mint), mint, &WSOL).0
}

pub fn amm_global_config_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"global_config"], &PUMP_SWAP).0
}
pub fn amm_event_authority_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"__event_authority"], &PUMP_SWAP).0
}
pub fn amm_accumulator_pda(user: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"user_volume_accumulator", user.as_ref()], &PUMP_SWAP).0
}
pub fn amm_fee_config_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"fee_config", PUMP_SWAP.as_ref()], &PUMP_FEES).0
}
/// Wrapped SOL account of the first buyback wallet (docs/pump-arayuz.md J).
pub fn buyback_wsol_account() -> Pubkey {
    ata(&BUYBACK_RECIPIENT, &WSOL, &TOKEN)
}
pub fn wsol_ata(owner: &Pubkey) -> Pubkey {
    ata(owner, &WSOL, &TOKEN)
}

// ---------------------------------------------------------------------------
// Packed accounts
// ---------------------------------------------------------------------------

/// Fields of PumpSwap's `Pool` account (IDL order).
#[derive(Clone, Debug)]
pub struct PoolSpec {
    pub bump: u8,
    pub index: u16,
    pub creator: Pubkey,
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub pool_base_token_account: Pubkey,
    pub pool_quote_token_account: Pubkey,
    pub coin_creator: Pubkey,
    pub is_mayhem_mode: bool,
    pub is_cashback_coin: bool,
    pub virtual_quote_reserves: i128,
}

/// The full current `Pool` layout, 287 bytes (offsets in `mock_pump_amm::pool_offsets`).
pub fn pack_pool(p: &PoolSpec) -> Vec<u8> {
    let mut d = POOL_DISCRIMINATOR.to_vec();
    d.push(p.bump);
    d.extend_from_slice(&p.index.to_le_bytes());
    d.extend_from_slice(p.creator.as_ref());
    d.extend_from_slice(p.base_mint.as_ref());
    d.extend_from_slice(p.quote_mint.as_ref());
    d.extend_from_slice(Pubkey::new_unique().as_ref()); // lp_mint
    d.extend_from_slice(p.pool_base_token_account.as_ref());
    d.extend_from_slice(p.pool_quote_token_account.as_ref());
    d.extend_from_slice(&1_000_000u64.to_le_bytes()); // lp_supply
    d.extend_from_slice(p.coin_creator.as_ref());
    d.push(p.is_mayhem_mode as u8);
    d.push(p.is_cashback_coin as u8);
    d.extend_from_slice(&p.virtual_quote_reserves.to_le_bytes());
    d.extend_from_slice(&0u64.to_le_bytes()); // creator_fee_bps
    d.push(0); // can_edit_creator_fee
    d.push(0); // is_holder_reward
    d.extend_from_slice(&0u64.to_le_bytes()); // protocol_fees
    d.extend_from_slice(&0u64.to_le_bytes()); // creator_fees
    assert_eq!(d.len(), mock_pump_amm::pool_offsets::LEN);
    d
}

/// SPL token account with `is_native = Some(rent_reserve)`: a wrapped SOL
/// account whose lamports are `rent_reserve + amount`.
pub fn pack_native_token_account(owner: &Pubkey, amount: u64, rent_reserve: u64) -> Vec<u8> {
    let mut d = pack_token_account(&WSOL, owner, amount);
    d[109..113].copy_from_slice(&1u32.to_le_bytes()); // is_native: Some
    d[113..121].copy_from_slice(&rent_reserve.to_le_bytes());
    d
}

/// Copy of the double's quote (`mock_pump_amm::quote_base_out`), kept separate
/// on purpose; `mock_pump_amm.rs` checks that the two agree.
pub fn mock_amm_quote(spendable: u64, base_reserve: u64, quote_reserve: u64) -> u64 {
    let fee_bps = mock_pump_amm::FEE_BPS as u128;
    let s = spendable as u128;
    let mut net = s * 10_000 / (10_000 + fee_bps);
    let fee = (net * fee_bps).div_ceil(10_000);
    if net + fee > s {
        net -= net + fee - s;
    }
    assert!(net > 1, "amount too small for a quote");
    u64::try_from((net - 1) * base_reserve as u128 / (quote_reserve as u128 + net - 1)).unwrap()
}

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

/// A pool and its two token accounts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AmmPool {
    pub address: Pubkey,
    pub base_token_account: Pubkey,
    pub quote_token_account: Pubkey,
}

/// The 17 accounts of PumpSwap's `buy_exact_quote_in_v2`
/// (PUMP_SWAP_TRADE_V2.md, docs/pump-arayuz.md B2) for `buyer`, whose base
/// and wrapped SOL accounts are its associated token accounts.
pub fn amm_buy_accounts(
    buyer: &Pubkey,
    mint: &Pubkey,
    base_token_program: &Pubkey,
    pool: &AmmPool,
    buyback: &Pubkey,
    buyer_signs: bool,
) -> Vec<AccountMeta> {
    vec![
        AccountMeta::new(pool.address, false),                           // 0 pool
        AccountMeta::new(*buyer, buyer_signs),                           // 1 user
        AccountMeta::new_readonly(AMM_GLOBAL_CONFIG, false),             // 2 global_config
        AccountMeta::new_readonly(*mint, false),                         // 3 base_mint
        AccountMeta::new_readonly(WSOL, false),                          // 4 quote_mint
        AccountMeta::new(ata(buyer, mint, base_token_program), false),   // 5 user_base_token_account
        AccountMeta::new(wsol_ata(buyer), false),                        // 6 user_quote_token_account
        AccountMeta::new(pool.base_token_account, false),                // 7 pool_base_token_account
        AccountMeta::new(pool.quote_token_account, false),               // 8 pool_quote_token_account
        AccountMeta::new_readonly(*base_token_program, false),           // 9 base_token_program
        AccountMeta::new_readonly(TOKEN, false),                         // 10 quote_token_program
        AccountMeta::new_readonly(SYSTEM, false),                        // 11 system_program
        AccountMeta::new(amm_accumulator_pda(buyer), false),             // 12 user_volume_accumulator
        AccountMeta::new_readonly(AMM_FEE_CONFIG, false),                // 13 fee_config
        AccountMeta::new(*buyback, false),                               // 14 buyback_fee_recipient
        AccountMeta::new_readonly(amm_event_authority_pda(), false),     // 15 event_authority
        AccountMeta::new_readonly(PUMP_SWAP, false),                     // 16 program
    ]
}

/// `buy_exact_quote_in_v2(spendable_quote_in, min_base_amount_out)`.
pub fn amm_buy_data(spendable: u64, min_base_out: u64) -> Vec<u8> {
    let mut data = BUY_EXACT_QUOTE_IN_V2.to_vec();
    data.extend_from_slice(&spendable.to_le_bytes());
    data.extend_from_slice(&min_base_out.to_le_bytes());
    data
}

/// Rung's `open_order` with remaining accounts (PumpSwap: the pool's base and
/// quote token accounts).
pub fn open_order_ix_with_remaining(
    user: &Pubkey,
    session_key: &Pubkey,
    mint: &Pubkey,
    venue_state: &Pubkey,
    args: OpenOrderArgs,
    remaining: &[AccountMeta],
) -> Instruction {
    let mut ix = open_order_ix(user, session_key, mint, venue_state, args);
    ix.accounts.extend_from_slice(remaining);
    ix
}

/// Associated Token Program `CreateIdempotent` (tag 1).
pub fn create_ata_ix(payer: &Pubkey, owner: &Pubkey, mint: &Pubkey, token_program: &Pubkey) -> Instruction {
    Instruction {
        program_id: ATA_PROGRAM,
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(ata(owner, mint, token_program), false),
            AccountMeta::new_readonly(*owner, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(SYSTEM, false),
            AccountMeta::new_readonly(*token_program, false),
        ],
        data: vec![1],
    }
}

/// SPL Token `SyncNative` (tag 17).
pub fn sync_native_ix(account: &Pubkey) -> Instruction {
    Instruction { program_id: TOKEN, accounts: vec![AccountMeta::new(*account, false)], data: vec![17] }
}

/// SPL Token `CloseAccount` (tag 9).
pub fn close_account_ix(account: &Pubkey, destination: &Pubkey, owner: &Pubkey, token_program: &Pubkey) -> Instruction {
    Instruction {
        program_id: *token_program,
        accounts: vec![
            AccountMeta::new(*account, false),
            AccountMeta::new(*destination, false),
            AccountMeta::new_readonly(*owner, true),
        ],
        data: vec![9],
    }
}

/// Wraps `lamports` into `owner`'s wrapped SOL ATA (created if missing).
pub fn wrap_sol_ixs(owner: &Pubkey, lamports: u64) -> Vec<Instruction> {
    let account = wsol_ata(owner);
    vec![
        create_ata_ix(owner, owner, &WSOL, &TOKEN),
        system_instruction::transfer(owner, &account, lamports),
        sync_native_ix(&account),
    ]
}

// ---------------------------------------------------------------------------
// The environment
// ---------------------------------------------------------------------------

/// Every account a rejected PumpSwap transaction must leave untouched, on top
/// of the curve `State`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AmmState {
    pub base: State,
    pub pool: Option<(u64, Vec<u8>)>,
    pub pool_base: Option<(u64, Vec<u8>)>,
    pub pool_quote: Option<(u64, Vec<u8>)>,
    pub vault_wsol: Option<(u64, Vec<u8>)>,
    pub vault_accumulator: Option<(u64, Vec<u8>)>,
}

impl AmmState {
    pub fn session_paid(&self, fee: u64) -> AmmState {
        AmmState { base: self.base.session_paid(fee), ..self.clone() }
    }
    pub fn user_paid(&self, fee: u64) -> AmmState {
        AmmState { base: self.base.user_paid(fee), ..self.clone() }
    }
}

/// `Env` (Rung, the curve double, a mint with a curve, a user and a session
/// key) plus the AMM double at PumpSwap's address, the wrapped SOL mint, the
/// buyback recipient's wrapped SOL account and the canonical pool of the mint.
pub struct AmmEnv {
    pub env: Env,
    pub pool: AmmPool,
}

impl Deref for AmmEnv {
    type Target = Env;
    fn deref(&self) -> &Env {
        &self.env
    }
}
impl DerefMut for AmmEnv {
    fn deref_mut(&mut self) -> &mut Env {
        &mut self.env
    }
}

impl AmmEnv {
    pub fn new() -> Self {
        Self::with_token_program(TOKEN)
    }

    pub fn with_token_program(token_program: Pubkey) -> Self {
        let mut env = Env::with_token_program(token_program);
        let amm_so = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy/mock_pump_amm.so");
        assert!(
            amm_so.exists(),
            "{} is missing. Run `cargo build-sbf --manifest-path test-programs/mock-pump-amm/Cargo.toml` first.",
            amm_so.display()
        );
        env.svm.add_program_from_file(PUMP_SWAP, amm_so).unwrap();
        let lamports = env.rent(82);
        env.put(&WSOL, &TOKEN, pack_mint(WSOL_DECIMALS, 0), lamports);
        let rent = env.rent(165);
        env.put(&buyback_wsol_account(), &TOKEN, pack_native_token_account(&BUYBACK_RECIPIENT, 0, rent), rent);
        let mint = env.mint;
        let pool_authority = pool_authority_pda(&mint);
        let mut amm = Self { env, pool: AmmPool { address: Pubkey::default(), base_token_account: Pubkey::default(), quote_token_account: Pubkey::default() } };
        amm.pool = amm.create_pool(&mint, 0, &pool_authority, &WSOL, POOL_BASE, POOL_QUOTE, 0);
        amm
    }

    /// A pool at `pool_pda(index, creator, mint, quote_mint)`, owned by
    /// PumpSwap, with its two token accounts (the pool's ATAs). `quote` is
    /// wrapped SOL when `quote_mint` is WSOL.
    #[allow(clippy::too_many_arguments)]
    pub fn create_pool(
        &mut self,
        mint: &Pubkey,
        index: u16,
        creator: &Pubkey,
        quote_mint: &Pubkey,
        base: u64,
        quote: u64,
        virtual_quote_reserves: i128,
    ) -> AmmPool {
        let (address, bump) = pool_pda(index, creator, mint, quote_mint);
        let tp = self.token_program;
        let pool = AmmPool {
            address,
            base_token_account: ata(&address, mint, &tp),
            quote_token_account: ata(&address, quote_mint, &TOKEN),
        };
        let spec = PoolSpec {
            bump,
            index,
            creator: *creator,
            base_mint: *mint,
            quote_mint: *quote_mint,
            pool_base_token_account: pool.base_token_account,
            pool_quote_token_account: pool.quote_token_account,
            coin_creator: Pubkey::new_unique(),
            is_mayhem_mode: false,
            is_cashback_coin: false,
            virtual_quote_reserves,
        };
        self.write_pool(&address, &spec);
        self.create_token_account(&pool.base_token_account, mint, &address, base, tp);
        self.set_quote_account(&pool.quote_token_account, &address, quote);
        pool
    }

    pub fn write_pool(&mut self, address: &Pubkey, spec: &PoolSpec) {
        let data = pack_pool(spec);
        let lamports = self.rent(data.len());
        self.put(address, &PUMP_SWAP, data, lamports);
    }

    /// The canonical pool's fields as written by `create_pool`.
    pub fn pool_spec(&self) -> PoolSpec {
        let d = self.svm.get_account(&self.pool.address).unwrap().data;
        let key = |o: usize| Pubkey::new_from_array(d[o..o + 32].try_into().unwrap());
        PoolSpec {
            bump: d[8],
            index: u16::from_le_bytes([d[9], d[10]]),
            creator: key(11),
            base_mint: key(43),
            quote_mint: key(75),
            pool_base_token_account: key(139),
            pool_quote_token_account: key(171),
            coin_creator: key(211),
            is_mayhem_mode: d[243] != 0,
            is_cashback_coin: d[244] != 0,
            virtual_quote_reserves: i128::from_le_bytes(d[245..261].try_into().unwrap()),
        }
    }

    /// Wrapped SOL account `address` of `owner` holding `amount`.
    pub fn set_quote_account(&mut self, address: &Pubkey, owner: &Pubkey, amount: u64) {
        let rent = self.rent(165);
        self.put(address, &TOKEN, pack_native_token_account(owner, amount, rent), rent + amount);
    }

    /// Rewrites the canonical pool's two token balances.
    pub fn set_reserves(&mut self, base: u64, quote: u64) {
        let (pool, tp, mint) = (self.pool, self.token_program, self.mint);
        self.create_token_account(&pool.base_token_account, &mint, &pool.address, base, tp);
        self.set_quote_account(&pool.quote_token_account, &pool.address, quote);
    }

    pub fn set_virtual_quote_reserves(&mut self, v: i128) {
        let mut spec = self.pool_spec();
        spec.virtual_quote_reserves = v;
        let address = self.pool.address;
        self.write_pool(&address, &spec);
    }

    /// (base reserve, effective quote reserve) of the canonical pool now.
    pub fn amm_reserves(&self) -> (u64, u64) {
        let base = self.tokens(&self.pool.base_token_account).unwrap();
        let quote = self.tokens(&self.pool.quote_token_account).unwrap();
        let v = self.pool_spec().virtual_quote_reserves;
        (base, u64::try_from(quote as i128 + v).unwrap())
    }

    /// Sets the double's cheat switch (first byte of `global_config`).
    pub fn set_amm_cheat(&mut self, byte: u8) {
        let lamports = self.rent(1);
        self.put(&AMM_GLOBAL_CONFIG, &PUMP_SWAP, vec![byte], lamports);
    }

    pub fn vault_wsol_ata(&self, user: &Pubkey) -> Pubkey {
        wsol_ata(&vault_pda(user))
    }

    pub fn reserve_accounts(&self) -> Vec<AccountMeta> {
        vec![
            AccountMeta::new_readonly(self.pool.base_token_account, false),
            AccountMeta::new_readonly(self.pool.quote_token_account, false),
        ]
    }

    // --- orders -------------------------------------------------------------

    /// Default PumpSwap order, quoted by the "app" at the pool's reserves now.
    pub fn spec(&self) -> OrderSpec {
        let (base, quote) = self.amm_reserves();
        amm_spec_at(AMOUNT, base, quote)
    }

    /// `open_order` with any venue account and remaining accounts.
    pub fn open_order_raw(
        &mut self,
        user: &Keypair,
        session: &Pubkey,
        venue_state: &Pubkey,
        remaining: &[AccountMeta],
        spec: &OrderSpec,
    ) -> TransactionResult {
        let mint = self.mint;
        let ix = open_order_ix_with_remaining(&user.pubkey(), session, &mint, venue_state, spec.args(), remaining);
        self.send(&[ix], user, &[])
    }

    /// Opens `spec` on the canonical pool for `user` and `session`.
    pub fn open_order_as(&mut self, user: &Keypair, session: &Pubkey, spec: &OrderSpec) -> TransactionResult {
        let (pool, remaining) = (self.pool.address, self.reserve_accounts());
        self.open_order_raw(user, session, &pool, &remaining, spec)
    }

    pub fn open_order(&mut self, spec: &OrderSpec) -> TransactionResult {
        let user = self.user.insecure_clone();
        let session = self.session.pubkey();
        self.open_order_as(&user, &session, spec)
    }

    pub fn open_default(&mut self) -> OrderSpec {
        let spec = self.spec();
        assert_ok(&self.open_order(&spec));
        spec
    }

    /// `try_rung` accounts for `user`'s order with the 17 PumpSwap accounts
    /// (buyer = the vault) as remaining accounts.
    pub fn try_accounts_for(&self, session: &Pubkey, user: &Pubkey) -> TryRungAccounts {
        let mut accounts = TryRungAccounts::new(session, user, &self.mint, &self.token_program);
        accounts.remaining =
            amm_buy_accounts(&vault_pda(user), &self.mint, &self.token_program, &self.pool, &buyback_wsol_account(), false);
        accounts
    }

    pub fn try_accounts(&self) -> TryRungAccounts {
        self.try_accounts_for(&self.session.pubkey(), &self.user.pubkey())
    }

    pub fn try_rung(&mut self, rung_index: u8) -> TransactionResult {
        let accounts = self.try_accounts();
        let session = self.session.insecure_clone();
        self.try_rung_with(&session, &accounts, rung_index)
    }

    fn raw_of(&self, address: &Pubkey) -> Option<(u64, Vec<u8>)> {
        self.svm.get_account(address).filter(|a| a.lamports > 0).map(|a| (a.lamports, a.data))
    }

    pub fn state_of(&self, user: &Pubkey, session: &Pubkey) -> AmmState {
        let vault = vault_pda(user);
        AmmState {
            base: self.env.state_of(user, session),
            pool: self.raw_of(&self.pool.address),
            pool_base: self.raw_of(&self.pool.base_token_account),
            pool_quote: self.raw_of(&self.pool.quote_token_account),
            vault_wsol: self.raw_of(&wsol_ata(&vault)),
            vault_accumulator: self.raw_of(&amm_accumulator_pda(&vault)),
        }
    }

    pub fn state(&self) -> AmmState {
        self.state_of(&self.user.pubkey(), &self.session.pubkey())
    }
}

/// Default PumpSwap order quoted at `(base, quote)`: 1% then 3% (cap).
pub fn amm_spec_at(amount: u64, base: u64, quote: u64) -> OrderSpec {
    OrderSpec {
        venue: Venue::PumpSwap,
        rungs_bps: vec![100, 300],
        amount,
        rent_reserve: AMM_RENT_RESERVE,
        fee_budget: FEE_BUDGET,
        expected_tokens_seen: mock_amm_quote(amount, base, quote),
        raw_tokens_seen: raw_quote(amount, base, quote),
        window_slots: WINDOW,
        lifetime_slots: LIFETIME,
    }
}
