//! The vault: a system-owned account with no data, at the address
//! `["vault", user]`. Only this program can sign for it, and this file holds
//! the only way lamports leave it other than the buy itself: to the user.

use anchor_lang::{
    prelude::*,
    system_program::{self, Transfer},
};

use crate::constants::VAULT_SEED;

/// Sends every lamport in the vault to the user and returns how many moved.
///
/// The caller passes the `user` account of the order; every instruction that
/// calls this has already tied `user` to the order through its seeds.
pub fn sweep_vault_to_user<'info>(
    vault: &AccountInfo<'info>,
    user: &AccountInfo<'info>,
    vault_bump: u8,
) -> Result<u64> {
    let lamports = vault.lamports();
    if lamports == 0 {
        return Ok(0);
    }
    let user_key = user.key();
    let bump = [vault_bump];
    let seeds: &[&[u8]] = &[VAULT_SEED, user_key.as_ref(), &bump];
    system_program::transfer(
        CpiContext::new_with_signer(
            system_program::ID,
            Transfer {
                from: vault.clone(),
                to: user.clone(),
            },
            &[seeds],
        ),
        lamports,
    )?;
    Ok(lamports)
}
