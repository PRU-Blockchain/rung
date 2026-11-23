//! Everything the program knows about PumpSwap, the pool a pump.fun token
//! trades in after it leaves its bonding curve.
//!
//! Source: https://github.com/pump-fun/pump-public-docs (`idl/pump_amm.json`,
//! `idl/pump.json` for the pool derivation). See section K of
//! `docs/pump-arayuz.md`. Compare with the current IDL before every
//! deployment.

use anchor_lang::{
    prelude::*,
    solana_program::{
        instruction::{AccountMeta, Instruction},
        program::invoke_signed,
    },
};

use crate::{
    error::RungError,
    venue::{CurveReserves, PUMP_PROGRAM_ID},
};

/// The PumpSwap program. A pool buy goes to this address and to no other.
pub const PUMP_SWAP_PROGRAM_ID: Pubkey = pubkey!("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");

/// Wrapped SOL: the only quote token the program buys with.
pub const WSOL_MINT: Pubkey = pubkey!("So11111111111111111111111111111111111111112");

/// The original SPL Token program, which owns every wrapped-SOL account.
/// Fixed here because the program lets it act with the vault's signature.
pub const SPL_TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

pub const POOL_SEED: &[u8] = b"pool";
pub const POOL_AUTHORITY_SEED: &[u8] = b"pool-authority";

/// Anchor discriminator of PumpSwap's `Pool` account.
pub const POOL_DISCRIMINATOR: [u8; 8] = [241, 154, 109, 4, 17, 177, 109, 188];

/// Anchor discriminator of PumpSwap's `buy_exact_quote_in_v2`: spend a fixed
/// amount of wrapped SOL, receive at least `min_base_amount_out`.
pub const BUY_EXACT_QUOTE_IN_V2_DISCRIMINATOR: [u8; 8] = [194, 171, 28, 70, 104, 77, 91, 47];

/// `buy_exact_quote_in_v2` takes exactly these 17 accounts, in this order.
pub const POOL_BUY_ACCOUNT_COUNT: usize = 17;
/// Positions the program checks itself. PumpSwap checks the rest.
pub const POOL_BUY_POOL: usize = 0;
pub const POOL_BUY_USER: usize = 1;
pub const POOL_BUY_BASE_MINT: usize = 3;
pub const POOL_BUY_QUOTE_MINT: usize = 4;
pub const POOL_BUY_USER_BASE_TOKEN_ACCOUNT: usize = 5;
pub const POOL_BUY_USER_QUOTE_TOKEN_ACCOUNT: usize = 6;
pub const POOL_BUY_BASE_TOKEN_PROGRAM: usize = 9;
pub const POOL_BUY_QUOTE_TOKEN_PROGRAM: usize = 10;
pub const POOL_BUY_PROGRAM: usize = 16;

/// The one pool of `mint` the program accepts: the pool pump itself created
/// when the token left its curve. Its creator is pump's pool authority for
/// that mint, its index is 0 and its quote token is wrapped SOL. A pool that
/// anyone else created for the same token has another address.
pub fn canonical_pool(mint: &Pubkey) -> Pubkey {
    let (pool_authority, _) =
        Pubkey::find_program_address(&[POOL_AUTHORITY_SEED, mint.as_ref()], &PUMP_PROGRAM_ID);
    let index = 0u16.to_le_bytes();
    let (pool, _) = Pubkey::find_program_address(
        &[
            POOL_SEED,
            &index,
            pool_authority.as_ref(),
            mint.as_ref(),
            WSOL_MINT.as_ref(),
        ],
        &PUMP_SWAP_PROGRAM_ID,
    );
    pool
}

/// The fields of a `Pool` account the program reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PoolState {
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub pool_base_token_account: Pubkey,
    pub pool_quote_token_account: Pubkey,
    /// Added to the quote token balance to get the reserve the price is
    /// computed from. Can be negative. Zero on pools written before the field
    /// existed.
    pub virtual_quote_reserves: i128,
}

/// Reads a `Pool` account from its raw data.
///
/// Layout after the 8-byte discriminator: `pool_bump: u8`, `index: u16`,
/// `creator`, `base_mint`, `quote_mint`, `lp_mint`, `pool_base_token_account`,
/// `pool_quote_token_account` (32 bytes each), `lp_supply: u64`,
/// `coin_creator` (32), `is_mayhem_mode: bool`, `is_cashback_coin: bool`,
/// `virtual_quote_reserves: i128`.
pub fn parse_pool(data: &[u8]) -> Result<PoolState> {
    const BASE_MINT: usize = 8 + 1 + 2 + 32;
    const QUOTE_MINT: usize = BASE_MINT + 32;
    const POOL_BASE_TOKEN_ACCOUNT: usize = QUOTE_MINT + 32 + 32;
    const POOL_QUOTE_TOKEN_ACCOUNT: usize = POOL_BASE_TOKEN_ACCOUNT + 32;
    const VIRTUAL_QUOTE_RESERVES: usize = POOL_QUOTE_TOKEN_ACCOUNT + 32 + 8 + 32 + 1 + 1;

    require!(
        data.len() >= POOL_QUOTE_TOKEN_ACCOUNT + 32 && data[..8] == POOL_DISCRIMINATOR,
        RungError::InvalidVenueAccount
    );
    let read_key = |offset: usize| -> Pubkey {
        let mut bytes = [0u8; 32];
        bytes.copy_from_slice(&data[offset..offset + 32]);
        Pubkey::new_from_array(bytes)
    };
    let virtual_quote_reserves = if data.len() >= VIRTUAL_QUOTE_RESERVES + 16 {
        let mut bytes = [0u8; 16];
        bytes.copy_from_slice(&data[VIRTUAL_QUOTE_RESERVES..VIRTUAL_QUOTE_RESERVES + 16]);
        i128::from_le_bytes(bytes)
    } else {
        0
    };
    Ok(PoolState {
        base_mint: read_key(BASE_MINT),
        quote_mint: read_key(QUOTE_MINT),
        pool_base_token_account: read_key(POOL_BASE_TOKEN_ACCOUNT),
        pool_quote_token_account: read_key(POOL_QUOTE_TOKEN_ACCOUNT),
        virtual_quote_reserves,
    })
}

/// The reserves the pool's price is computed from: the token balance, and the
/// wrapped-SOL balance plus the pool's virtual quote reserves.
pub fn pool_reserves(pool: &PoolState, base_balance: u64, quote_balance: u64) -> Result<CurveReserves> {
    let effective_quote = (quote_balance as i128)
        .checked_add(pool.virtual_quote_reserves)
        .ok_or(RungError::MathOverflow)?;
    require!(base_balance > 0 && effective_quote > 0, RungError::InvalidVenueAccount);
    Ok(CurveReserves {
        virtual_token_reserves: base_balance,
        virtual_quote_reserves: u64::try_from(effective_quote)
            .map_err(|_| RungError::InvalidVenueAccount)?,
        complete: false,
    })
}

/// Checks the accounts the session key supplied for a pool buy.
///
/// The program fixes the ones that decide where SOL comes from and where
/// tokens go: the pool is the token's canonical pool, the buyer is the vault,
/// the tokens land in the vault's token account, the wrapped SOL comes from
/// the vault's wrapped-SOL account, the quote token program is SPL Token, and
/// the program called is PumpSwap. PumpSwap validates every other account.
pub fn check_pool_buy_accounts(
    accounts: &[AccountInfo],
    mint: &Pubkey,
    token_program: &Pubkey,
    vault: &Pubkey,
    vault_token_account: &Pubkey,
    vault_wsol_account: &Pubkey,
) -> Result<()> {
    require!(
        accounts.len() == POOL_BUY_ACCOUNT_COUNT,
        RungError::AccountMismatch
    );
    require_keys_eq!(
        accounts[POOL_BUY_PROGRAM].key(),
        PUMP_SWAP_PROGRAM_ID,
        RungError::WrongBuyProgram
    );
    let pool = canonical_pool(mint);
    for (index, expected) in [
        (POOL_BUY_POOL, &pool),
        (POOL_BUY_USER, vault),
        (POOL_BUY_BASE_MINT, mint),
        (POOL_BUY_QUOTE_MINT, &WSOL_MINT),
        (POOL_BUY_USER_BASE_TOKEN_ACCOUNT, vault_token_account),
        (POOL_BUY_USER_QUOTE_TOKEN_ACCOUNT, vault_wsol_account),
        (POOL_BUY_BASE_TOKEN_PROGRAM, token_program),
        (POOL_BUY_QUOTE_TOKEN_PROGRAM, &SPL_TOKEN_PROGRAM_ID),
    ] {
        require_keys_eq!(accounts[index].key(), *expected, RungError::AccountMismatch);
    }
    Ok(())
}

/// Calls PumpSwap's `buy_exact_quote_in_v2`: spend exactly `lamports` of the
/// vault's wrapped SOL, receive at least `min_tokens_out`. The vault is the
/// buyer and signs through `vault_seeds`. No other account is given signer
/// rights.
pub fn buy_on_pool(
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
            is_signer: index == POOL_BUY_USER,
            is_writable: account.is_writable,
        })
        .collect();

    // Arguments: spendable_quote_in: u64, min_base_amount_out: u64.
    let mut data = Vec::with_capacity(8 + 8 + 8);
    data.extend_from_slice(&BUY_EXACT_QUOTE_IN_V2_DISCRIMINATOR);
    data.extend_from_slice(&lamports.to_le_bytes());
    data.extend_from_slice(&min_tokens_out.to_le_bytes());

    invoke_signed(
        &Instruction {
            program_id: PUMP_SWAP_PROGRAM_ID,
            accounts: metas,
            data,
        },
        accounts,
        &[vault_seeds],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pool_bytes(virtual_quote: Option<i128>) -> (Vec<u8>, [Pubkey; 4]) {
        let keys = [
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
        ];
        let mut data = POOL_DISCRIMINATOR.to_vec();
        data.push(255); // pool_bump
        data.extend_from_slice(&0u16.to_le_bytes()); // index
        data.extend_from_slice(&[7u8; 32]); // creator
        data.extend_from_slice(keys[0].as_ref()); // base_mint
        data.extend_from_slice(keys[1].as_ref()); // quote_mint
        data.extend_from_slice(&[8u8; 32]); // lp_mint
        data.extend_from_slice(keys[2].as_ref()); // pool_base_token_account
        data.extend_from_slice(keys[3].as_ref()); // pool_quote_token_account
        data.extend_from_slice(&0u64.to_le_bytes()); // lp_supply
        data.extend_from_slice(&[9u8; 32]); // coin_creator
        data.push(0); // is_mayhem_mode
        data.push(0); // is_cashback_coin
        if let Some(v) = virtual_quote {
            data.extend_from_slice(&v.to_le_bytes());
        }
        (data, keys)
    }

    #[test]
    fn reads_the_fields_of_a_pool() {
        let (data, keys) = pool_bytes(Some(-5));
        let pool = parse_pool(&data).unwrap();
        assert_eq!(pool.base_mint, keys[0]);
        assert_eq!(pool.quote_mint, keys[1]);
        assert_eq!(pool.pool_base_token_account, keys[2]);
        assert_eq!(pool.pool_quote_token_account, keys[3]);
        assert_eq!(pool.virtual_quote_reserves, -5);
    }

    #[test]
    fn older_shorter_pool_has_no_virtual_reserves() {
        let (data, _) = pool_bytes(None);
        assert_eq!(parse_pool(&data).unwrap().virtual_quote_reserves, 0);
    }

    #[test]
    fn rejects_another_discriminator_and_truncated_data() {
        let (mut data, _) = pool_bytes(Some(0));
        assert!(parse_pool(&data[..100]).is_err());
        data[0] ^= 0xff;
        assert!(parse_pool(&data).is_err());
    }

    #[test]
    fn effective_quote_reserve_adds_the_virtual_part() {
        let (data, _) = pool_bytes(Some(-400));
        let pool = parse_pool(&data).unwrap();
        let reserves = pool_reserves(&pool, 1_000, 1_000).unwrap();
        assert_eq!(reserves.virtual_token_reserves, 1_000);
        assert_eq!(reserves.virtual_quote_reserves, 600);
    }

    #[test]
    fn empty_or_negative_reserves_are_rejected() {
        let (data, _) = pool_bytes(Some(-1_000));
        let pool = parse_pool(&data).unwrap();
        assert!(pool_reserves(&pool, 1_000, 1_000).is_err()); // effective quote is zero
        assert!(pool_reserves(&pool, 1_000, 999).is_err()); // negative
        assert!(pool_reserves(&pool, 0, 5_000).is_err()); // no tokens
    }
}
