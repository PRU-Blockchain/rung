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
    venue::{parse_curve_reserves, raw_quote, BONDING_CURVE_SEED, PUMP_PROGRAM_ID},
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

    /// CHECK: the venue's price account (the bonding curve of `mint`). Its
    /// address and owner are verified in the handler before it is read.
    pub venue_state: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
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
    require!(args.venue == Venue::Curve, RungError::VenueNotSupported);

    // One open order per user: the vault never holds the SOL of two orders.
    require!(
        ctx.accounts.order.status != OrderStatus::Open,
        RungError::OrderAlreadyOpen
    );

    // --- Reference 2: read the price from the venue now. ---
    let mint = ctx.accounts.mint.key();
    let (curve_address, _) =
        Pubkey::find_program_address(&[BONDING_CURVE_SEED, mint.as_ref()], &PUMP_PROGRAM_ID);
    require_keys_eq!(
        ctx.accounts.venue_state.key(),
        curve_address,
        RungError::InvalidVenueAccount
    );
    require_keys_eq!(
        *ctx.accounts.venue_state.owner,
        PUMP_PROGRAM_ID,
        RungError::InvalidVenueAccount
    );
    let reserves = parse_curve_reserves(&ctx.accounts.venue_state.try_borrow_data()?)?;
    require!(!reserves.complete, RungError::CurveComplete);

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
