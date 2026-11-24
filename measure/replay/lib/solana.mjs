// Uses the client's own @solana/web3.js (no new dependency) for PDA derivation and base58.
import { createRequire } from 'node:module';
import path from 'node:path';
import { REPLAY_DIR } from './rpc.mjs';

const require = createRequire(path.join(REPLAY_DIR, '..', '..', 'client', 'package.json'));
const web3 = require('@solana/web3.js');
export const { PublicKey } = web3;
const bs58 = require('bs58');
export const b58 = bs58.default || bs58;

export const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const PUMP_SWAP = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
export const WSOL = 'So11111111111111111111111111111111111111112';

const pda = (seeds, program) => PublicKey.findProgramAddressSync(seeds, new PublicKey(program))[0].toBase58();

export const bondingCurvePda = (mint) => pda([Buffer.from('bonding-curve'), new PublicKey(mint).toBuffer()], PUMP);
export const poolAuthorityPda = (mint) => pda([Buffer.from('pool-authority'), new PublicKey(mint).toBuffer()], PUMP);
/** PumpSwap canonical pool: ["pool", 0u16 LE, pool authority, mint, WSOL] (client/src/pdas.ts canonicalPoolPda). */
export const canonicalPoolPda = (mint) =>
  pda([Buffer.from('pool'), Buffer.from([0, 0]), new PublicKey(poolAuthorityPda(mint)).toBuffer(), new PublicKey(mint).toBuffer(), new PublicKey(WSOL).toBuffer()], PUMP_SWAP);
