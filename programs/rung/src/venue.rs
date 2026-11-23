//! Everything the program knows about the venue it buys on.
//!
//! Source: https://github.com/pump-fun/pump-public-docs (`idl/pump.json`,
//! `docs/TRADE_V3.md`). See `docs/pump-arayuz.md` for the extract this file
//! was written from. The account order and the instruction data below must be
//! compared with the current IDL before every deployment.

use anchor_lang::{
    prelude::*,
    solana_program::{
        instruction::{AccountMeta, Instruction},
        program::invoke_signed,
    },
};

use crate::error::RungError;

/// The pump.fun bonding-curve program. The buy CPI goes to this address and
/// to no other.
pub const PUMP_PROGRAM_ID: Pubkey = pubkey!("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

/// Seed of pump's bonding-curve account: `["bonding-curve", mint]`.
pub const BONDING_CURVE_SEED: &[u8] = b"bonding-curve";

/// Anchor discriminator of pump's `BondingCurve` account.
pub const BONDING_CURVE_DISCRIMINATOR: [u8; 8] = [23, 183, 248, 55, 96, 216, 172, 96];

/// Anchor discriminator of pump's `buy_exact_quote_in_v3` instruction:
/// spend a fixed amount of SOL, receive at least `min_tokens_out`.
pub const BUY_EXACT_QUOTE_IN_V3_DISCRIMINATOR: [u8; 8] = [225, 247, 80, 30, 213, 179, 132, 136];

/// `buy_exact_quote_in_v3` takes exactly these 17 accounts, in this order.
pub const CURVE_BUY_ACCOUNT_COUNT: usize = 17;
/// Positions the program checks itself. Pump checks the rest.
pub const CURVE_BUY_BASE_MINT: usize = 1;
pub const CURVE_BUY_BASE_TOKEN_PROGRAM: usize = 3;
pub const CURVE_BUY_BONDING_CURVE: usize = 5;
pub const CURVE_BUY_USER: usize = 8;
pub const CURVE_BUY_USER_BASE_TOKEN_ACCOUNT: usize = 9;
pub const CURVE_BUY_USER_VOLUME_ACCUMULATOR: usize = 11;
pub const CURVE_BUY_PROGRAM: usize = 16;

/// Checks the accounts the session key supplied for the buy.
///
/// The program fixes the ones that decide where SOL comes from and where
/// tokens go: the buyer is the vault, the tokens land in the vault's token
/// account, the mint is the order's mint, the curve is that mint's curve, and
/// the program called is pump. Pump validates every other account itself.
pub fn check_curve_buy_accounts(
    accounts: &[AccountInfo],
    mint: &Pubkey,
    token_program: &Pubkey,
    vault: &Pubkey,
    vault_token_account: &Pubkey,
) -> Result<()> {
    require!(
        accounts.len() == CURVE_BUY_ACCOUNT_COUNT,
        RungError::AccountMismatch
    );
    require_keys_eq!(
        accounts[CURVE_BUY_PROGRAM].key(),
        PUMP_PROGRAM_ID,
        RungError::WrongBuyProgram
    );
    let (curve, _) =
        Pubkey::find_program_address(&[BONDING_CURVE_SEED, mint.as_ref()], &PUMP_PROGRAM_ID);
    for (index, expected) in [
        (CURVE_BUY_BASE_MINT, mint),
        (CURVE_BUY_BASE_TOKEN_PROGRAM, token_program),
        (CURVE_BUY_BONDING_CURVE, &curve),
        (CURVE_BUY_USER, vault),
        (CURVE_BUY_USER_BASE_TOKEN_ACCOUNT, vault_token_account),
    ] {
        require_keys_eq!(accounts[index].key(), *expected, RungError::AccountMismatch);
    }
    Ok(())
}

/// Calls pump's `buy_exact_quote_in_v3`: spend exactly `lamports` from the
/// vault, receive at least `min_tokens_out`. The vault is the buyer and signs
/// through `vault_seeds`. No other account is given signer rights.
pub fn buy_on_curve(
    accounts: &[AccountInfo],
    lamports: u64,
    min_tokens_out: u64,
    vault_seeds: &[&[u8]],
) -> Result<()> {
    let metas = accounts
        .iter()
        .enumerate()
        .map(|(index, account)| AccountMeta {
            pubkey: account.key(),
            is_signer: index == CURVE_BUY_USER,
            is_writable: account.is_writable,
        })
        .collect();

    // Arguments: spendable_quote_in: u64, min_tokens_out: u64,
    // partial_fill: OptionBool (one bool; false).
    let mut data = Vec::with_capacity(8 + 8 + 8 + 1);
    data.extend_from_slice(&BUY_EXACT_QUOTE_IN_V3_DISCRIMINATOR);
    data.extend_from_slice(&lamports.to_le_bytes());
    data.extend_from_slice(&min_tokens_out.to_le_bytes());
    data.push(0);

    invoke_signed(
        &Instruction {
            program_id: PUMP_PROGRAM_ID,
            accounts: metas,
            data,
        },
        accounts,
        &[vault_seeds],
    )?;
    Ok(())
}

/// The two numbers that set the price on a bonding curve.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CurveReserves {
    pub virtual_token_reserves: u64,
    pub virtual_quote_reserves: u64,
    /// True once the curve has sold out and the token moved to a pool.
    pub complete: bool,
}

/// Reads the reserves from the raw data of a `BondingCurve` account.
///
/// Layout (after the 8-byte discriminator): `virtual_token_reserves: u64`,
/// `virtual_quote_reserves: u64`, `real_token_reserves: u64`,
/// `real_quote_reserves: u64`, `token_total_supply: u64`, `complete: bool`.
/// Only this prefix is read, so older, shorter accounts work too.
pub fn parse_curve_reserves(data: &[u8]) -> Result<CurveReserves> {
    const COMPLETE_OFFSET: usize = 8 + 5 * 8;
    require!(data.len() > COMPLETE_OFFSET, RungError::InvalidVenueAccount);
    require!(
        data[..8] == BONDING_CURVE_DISCRIMINATOR,
        RungError::InvalidVenueAccount
    );
    let read_u64 = |offset: usize| -> u64 {
        let mut bytes = [0u8; 8];
        bytes.copy_from_slice(&data[offset..offset + 8]);
        u64::from_le_bytes(bytes)
    };
    Ok(CurveReserves {
        virtual_token_reserves: read_u64(8),
        virtual_quote_reserves: read_u64(16),
        complete: data[COMPLETE_OFFSET] != 0,
    })
}

/// Tokens a constant-product curve gives for `lamports`, before any fee:
/// `floor(lamports * token_reserves / (quote_reserves + lamports))`.
///
/// The program uses it only as a ratio between two moments (fees cancel out),
/// never as the amount a buy must return.
pub fn raw_quote(lamports: u64, reserves: &CurveReserves) -> Result<u64> {
    let numerator = (lamports as u128)
        .checked_mul(reserves.virtual_token_reserves as u128)
        .ok_or(RungError::MathOverflow)?;
    let denominator = (reserves.virtual_quote_reserves as u128)
        .checked_add(lamports as u128)
        .ok_or(RungError::MathOverflow)?;
    require!(denominator > 0, RungError::InvalidVenueAccount);
    u64::try_from(numerator / denominator).map_err(|_| RungError::MathOverflow.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn curve_bytes(token: u64, quote: u64, complete: bool) -> Vec<u8> {
        let mut data = BONDING_CURVE_DISCRIMINATOR.to_vec();
        data.extend_from_slice(&token.to_le_bytes());
        data.extend_from_slice(&quote.to_le_bytes());
        data.extend_from_slice(&[0u8; 24]); // real reserves and total supply
        data.push(complete as u8);
        data
    }

    #[test]
    fn reads_reserves_from_the_prefix() {
        let reserves = parse_curve_reserves(&curve_bytes(1_000, 30, false)).unwrap();
        assert_eq!(reserves.virtual_token_reserves, 1_000);
        assert_eq!(reserves.virtual_quote_reserves, 30);
        assert!(!reserves.complete);
    }

    #[test]
    fn rejects_an_account_with_another_discriminator() {
        let mut data = curve_bytes(1_000, 30, false);
        data[0] ^= 0xff;
        assert!(parse_curve_reserves(&data).is_err());
    }

    #[test]
    fn rejects_an_account_that_is_too_short() {
        assert!(parse_curve_reserves(&curve_bytes(1_000, 30, false)[..40]).is_err());
    }

    #[test]
    fn raw_quote_is_the_constant_product_formula() {
        let reserves = CurveReserves {
            virtual_token_reserves: 1_000_000,
            virtual_quote_reserves: 30_000,
            complete: false,
        };
        // 10_000 * 1_000_000 / (30_000 + 10_000) = 250_000
        assert_eq!(raw_quote(10_000, &reserves).unwrap(), 250_000);
    }
}
