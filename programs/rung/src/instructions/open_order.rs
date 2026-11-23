use anchor_lang::{
    prelude::*,
    system_program::{self, Transfer},
};
use anchor_spl::token_interface::Mint;

use crate::{
    constants::*,
    error::RungError,
    events::OrderOpened,
    state::{Order, OrderStatus, Venue},
    pump_swap::{
        canonical_pool, parse_pool, pool_reserves, PUMP_SWAP_PROGRAM_ID, SPL_TOKEN_PROGRAM_ID,
        WSOL_MINT,
    },
    venue::{
        parse_curve_reserves, raw_quote, CurveReserves, BONDING_CURVE_SEED, PUMP_PROGRAM_ID,
    },
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct OpenOrderArgs {
    pub venue: Venue,
    /// Slippage of each rung in basis points, strictly increasing, 1 to 5
    /// entries. The last one is the cap.
    pub rungs_bps: Vec<u16>,
    /// Lamports the buy may spend.
    pub amount: u64,
    /// Extra lamports for the rent of accounts the buy creates. Unspent
    /// lamports return to the user.
    pub rent_reserve: u64,
    /// Lamports sent to the session key for transaction fees.
    pub fee_budget: u64,
    /// Tokens the app quoted for `amount`, fees included, at the price the
    /// user saw.
    pub expected_tokens_seen: u64,
    /// The same quote without fees, from the reserves the app saw. The program
    /// repeats this fee-free quote on the reserves it reads now and scales
    /// `expected_tokens_seen` by the ratio, which gives the ladder its start.
    pub raw_tokens_seen: u64,
    /// Slots between two rungs becoming due.
    pub window_slots: u64,
    /// The order can be tried for this many slots.
    pub lifetime_slots: u64,
}

#[derive(Accounts)]
pub struct OpenOrder<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    /// One-time key of this order. Receives the fee budget; nothing else.
    #[account(mut)]
    pub session_key: SystemAccount<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// Created on the user's first order, reused afterwards.
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + Order::INIT_SPACE,
        seeds = [ORDER_SEED, user.key().as_ref()],
        bump
    )]
    pub order: Account<'info, Order>,

    #[account(mut, seeds = [VAULT_SEED, user.key().as_ref()], bump)]
    pub vault: SystemAccount<'info>,

    /// CHECK: the venue's price account: the bonding curve of `mint`, or its
    /// canonical PumpSwap pool. Its address and owner are verified in the
    /// handler before it is read.
    pub venue_state: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    // Remaining accounts, PumpSwap only: the pool's base and quote token
    // accounts, in that order.
}

/// Reserves of the bonding curve of `mint`. The account must be pump's curve
/// for exactly this mint, and the curve must still be selling.
fn curve_start_reserves(venue_state: &UncheckedAccount, mint: &Pubkey) -> Result<CurveReserves> {
    let (curve_address, _) =
        Pubkey::find_program_address(&[BONDING_CURVE_SEED, mint.as_ref()], &PUMP_PROGRAM_ID);
    require_keys_eq!(
        venue_state.key(),
        curve_address,
        RungError::InvalidVenueAccount
    );
    require_keys_eq!(
        *venue_state.owner,
        PUMP_PROGRAM_ID,
        RungError::InvalidVenueAccount
    );
    let reserves = parse_curve_reserves(&venue_state.try_borrow_data()?)?;
    require!(!reserves.complete, RungError::CurveComplete);
    Ok(reserves)
}

/// Reserves of the canonical PumpSwap pool of `mint`. The two remaining
/// accounts are the pool's token accounts, in the order base, quote; they
/// must be the ones written in the pool.
fn pool_start_reserves(
    venue_state: &UncheckedAccount,
    reserve_accounts: &[AccountInfo],
    mint: &Pubkey,
    base_token_program: &Pubkey,
) -> Result<CurveReserves> {
    require_keys_eq!(
        venue_state.key(),
        canonical_pool(mint),
        RungError::InvalidVenueAccount
    );
    require_keys_eq!(
        *venue_state.owner,
        PUMP_SWAP_PROGRAM_ID,
        RungError::InvalidVenueAccount
    );
    let pool = parse_pool(&venue_state.try_borrow_data()?)?;
    require_keys_eq!(pool.base_mint, *mint, RungError::InvalidVenueAccount);
    require_keys_eq!(pool.quote_mint, WSOL_MINT, RungError::InvalidVenueAccount);
    // An order on a cashback pool could never fill: refuse it before any SOL moves.
    require!(!pool.is_cashback_coin, RungError::VenueNotSupported);

    require!(reserve_accounts.len() == 2, RungError::InvalidVenueAccount);
    let (base_account, quote_account) = (&reserve_accounts[0], &reserve_accounts[1]);
    require_keys_eq!(
        base_account.key(),
        pool.pool_base_token_account,
        RungError::InvalidVenueAccount
    );
    require_keys_eq!(
        quote_account.key(),
        pool.pool_quote_token_account,
        RungError::InvalidVenueAccount
    );
    require_keys_eq!(
        *base_account.owner,
        *base_token_program,
        RungError::InvalidVenueAccount
    );
    require_keys_eq!(
        *quote_account.owner,
        SPL_TOKEN_PROGRAM_ID,
        RungError::InvalidVenueAccount
    );
    pool_reserves(
        &pool,
        token_balance(base_account)?,
        token_balance(quote_account)?,
    )
}

/// Balance of a token account: bytes 64..72 in both token programs.
fn token_balance(token_account: &AccountInfo) -> Result<u64> {
    let data = token_account.try_borrow_data()?;
    require!(data.len() >= 72, RungError::InvalidVenueAccount);
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&data[64..72]);
    Ok(u64::from_le_bytes(bytes))
}

pub fn handle_open_order(ctx: Context<OpenOrder>, args: OpenOrderArgs) -> Result<()> {
    // --- Input limits. Nothing is written or moved before all of them pass. ---
    let rung_count = args.rungs_bps.len();
    require!(
        (1..=MAX_RUNGS).contains(&rung_count),
        RungError::InvalidRungCount
    );
    let mut previous = 0u16;
    for &rung in &args.rungs_bps {
        require!(rung > previous, RungError::RungsNotIncreasing);
        previous = rung;
    }
    // `previous` is now the last rung: the cap.
    require!(previous <= MAX_CAP_BPS, RungError::CapTooHigh);

    require!(args.amount >= MIN_ORDER_LAMPORTS, RungError::AmountTooSmall);
    require!(args.amount <= MAX_ORDER_LAMPORTS, RungError::AmountAboveLimit);
    require!(
        args.rent_reserve <= MAX_RENT_RESERVE_LAMPORTS,
        RungError::RentReserveAboveLimit
    );
    require!(
        args.fee_budget <= MAX_FEE_BUDGET_LAMPORTS,
        RungError::FeeBudgetAboveLimit
    );
    require!(
        (MIN_WINDOW_SLOTS..=MAX_WINDOW_SLOTS).contains(&args.window_slots),
        RungError::InvalidWindow
    );
    // The last rung becomes due at `(rung_count - 1) * window_slots`; the
    // order must still be alive then.
    let last_rung_due = (rung_count as u64 - 1) * args.window_slots;
    require!(
        args.lifetime_slots > last_rung_due && args.lifetime_slots <= MAX_LIFETIME_SLOTS,
        RungError::InvalidLifetime
    );
    require!(
        args.expected_tokens_seen > 0 && args.raw_tokens_seen > 0,
        RungError::InvalidExpectedTokens
    );
    // The two quotes must agree with each other: fees only reduce a quote,
    // and by no more than `MAX_VENUE_FEE_BPS`. This keeps the ladder's start
    // tied to the price the program reads, whatever the client sends.
    let seen = args.expected_tokens_seen as u128;
    let raw_seen = args.raw_tokens_seen as u128;
    require!(
        seen <= raw_seen
            && seen * BPS_DENOMINATOR as u128
                >= raw_seen * (BPS_DENOMINATOR - MAX_VENUE_FEE_BPS) as u128,
        RungError::InvalidExpectedTokens
    );
    // A new account must hold the rent-exempt minimum or nothing at all.
    if args.fee_budget > 0 {
        let session_key_after = ctx
            .accounts
            .session_key
            .lamports()
            .checked_add(args.fee_budget)
            .ok_or(RungError::MathOverflow)?;
        require!(
            session_key_after >= Rent::get()?.minimum_balance(0),
            RungError::FeeBudgetBelowRent
        );
    }

    // One open order per user: the vault never holds the SOL of two orders.
    require!(
        ctx.accounts.order.status != OrderStatus::Open,
        RungError::OrderAlreadyOpen
    );

    // --- Reference 2: read the price from the venue now. ---
    let mint = ctx.accounts.mint.key();
    let reserves = match args.venue {
        Venue::Curve => curve_start_reserves(&ctx.accounts.venue_state, &mint)?,
        Venue::PumpSwap => pool_start_reserves(
            &ctx.accounts.venue_state,
            ctx.remaining_accounts,
            &mint,
            ctx.accounts.mint.to_account_info().owner,
        )?,
    };

    // Scale the quote the user saw by how the fee-free quote changed between
    // the reserves the app saw and the reserves the program reads now.
    let raw_tokens_now = raw_quote(args.amount, &reserves)?;
    let expected_tokens_start = (args.expected_tokens_seen as u128)
        .checked_mul(raw_tokens_now as u128)
        .ok_or(RungError::MathOverflow)?
        / args.raw_tokens_seen as u128;
    let expected_tokens_start =
        u64::try_from(expected_tokens_start).map_err(|_| RungError::MathOverflow)?;

    // --- Write the rules. ---
    let slot = Clock::get()?.slot;
    let mut rungs_bps = [0u16; MAX_RUNGS];
    rungs_bps[..rung_count].copy_from_slice(&args.rungs_bps);

    let order = &mut ctx.accounts.order;
    order.user = ctx.accounts.user.key();
    order.session_key = ctx.accounts.session_key.key();
    order.mint = mint;
    order.venue = args.venue;
    order.status = OrderStatus::Open;
    order.rung_count = rung_count as u8;
    order.rungs_bps = rungs_bps;
    order.amount = args.amount;
    order.rent_reserve = args.rent_reserve;
    order.expected_tokens_seen = args.expected_tokens_seen;
    order.expected_tokens_start = expected_tokens_start;
    order.start_slot = slot;
    order.window_slots = args.window_slots;
    order.last_slot = slot + args.lifetime_slots;
    order.filled_rung = 0;
    order.tokens_bought = 0;
    order.lamports_spent = 0;
    order.bump = ctx.bumps.order;
    order.vault_bump = ctx.bumps.vault;

    // --- Move the SOL: the order into the vault, the fee budget to the key. ---
    let to_vault = args
        .amount
        .checked_add(args.rent_reserve)
        .ok_or(RungError::MathOverflow)?;
    system_program::transfer(
        CpiContext::new(
            system_program::ID,
            Transfer {
                from: ctx.accounts.user.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        ),
        to_vault,
    )?;
    if args.fee_budget > 0 {
        system_program::transfer(
            CpiContext::new(
                system_program::ID,
                Transfer {
                    from: ctx.accounts.user.to_account_info(),
                    to: ctx.accounts.session_key.to_account_info(),
                },
            ),
            args.fee_budget,
        )?;
    }

    emit!(OrderOpened {
        user: order.user,
        session_key: order.session_key,
        mint: order.mint,
        venue: order.venue,
        amount: order.amount,
        rung_count: order.rung_count,
        rungs_bps: order.rungs_bps,
        expected_tokens_seen: order.expected_tokens_seen,
        expected_tokens_start: order.expected_tokens_start,
        start_slot: order.start_slot,
        window_slots: order.window_slots,
        last_slot: order.last_slot,
    });
    Ok(())
}
