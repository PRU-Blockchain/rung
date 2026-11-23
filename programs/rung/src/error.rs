use anchor_lang::prelude::*;

#[error_code]
pub enum RungError {
    // --- open_order: input limits ---
    #[msg("An order needs between 1 and 5 rungs")]
    InvalidRungCount,
    #[msg("Rungs must be above zero and strictly increasing")]
    RungsNotIncreasing,
    #[msg("The last rung (the cap) is above the highest cap the program allows")]
    CapTooHigh,
    #[msg("Order amount is below the minimum")]
    AmountTooSmall,
    #[msg("Order amount is above the per-order limit")]
    AmountAboveLimit,
    #[msg("Rent reserve is above the limit")]
    RentReserveAboveLimit,
    #[msg("Fee budget for the session key is above the limit")]
    FeeBudgetAboveLimit,
    #[msg("Window between rungs is out of range")]
    InvalidWindow,
    #[msg("Order lifetime is out of range")]
    InvalidLifetime,
    #[msg("Expected token amount must be above zero")]
    InvalidExpectedTokens,
    #[msg("This user already has an open order")]
    OrderAlreadyOpen,

    // --- try_rung: the rules the session key cannot loosen ---
    #[msg("Only the session key of this order may try a rung")]
    WrongSessionKey,
    #[msg("Order is already filled: at most one buy per order")]
    OrderFilled,
    #[msg("Order is not open")]
    OrderNotOpen,
    #[msg("This rung is above the cap of the order")]
    RungAboveCap,
    #[msg("This rung is not due yet")]
    RungNotDue,
    #[msg("Order has expired")]
    OrderExpired,
    #[msg("The buy returned fewer tokens than the rung allows")]
    BoughtLessThanMinimum,

    // --- refund / cancel ---
    #[msg("Order has not expired yet: until then only the session key may refund it; the user can cancel")]
    OrderNotExpired,
    #[msg("Only the user of this order may cancel it")]
    WrongUser,

    // --- accounts ---
    #[msg("Account does not match the order")]
    AccountMismatch,
    #[msg("Buy program is not the expected pump program")]
    WrongBuyProgram,
    #[msg("Venue account could not be read")]
    InvalidVenueAccount,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("This venue is not supported yet")]
    VenueNotSupported,
    #[msg("The bonding curve is complete; the token trades in a pool now")]
    CurveComplete,
}
