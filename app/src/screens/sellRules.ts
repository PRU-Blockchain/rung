// The rules around selling that need no network. Pure; tested from
// client/test/app-sell.test.ts.

import { PublicKey } from "../../../client/src";

export interface Holding {
  mint: string;
  /** In the token's base units. */
  amount: bigint;
}

/**
 * Token accounts as the chain returns them (mint at 0, amount as a u64 at 64),
 * as one line per token with a balance.
 */
export function holdingsFrom(accounts: Uint8Array[]): Holding[] {
  const byMint = new Map<string, bigint>();
  for (const data of accounts) {
    if (data.length < 72) continue;
    let amount = 0n;
    for (let i = 7; i >= 0; i--) amount = (amount << 8n) | BigInt(data[64 + i]);
    if (amount === 0n) continue;
    const mint = new PublicKey(data.slice(0, 32)).toBase58();
    byMint.set(mint, (byMint.get(mint) ?? 0n) + amount);
  }
  return [...byMint].map(([mint, amount]) => ({ mint, amount }));
}

/**
 * Is this token listed under "Your tokens"? Rung sells where it buys: pump.fun
 * tokens. On mainnet their addresses end in "pump"; devnet's test tokens carry
 * no such ending, so there every token is listed (one that is not pump's is
 * refused when its sale is prepared).
 */
export const showsInTokens = (mint: string, cluster: string): boolean => cluster !== "mainnet-beta" || mint.endsWith("pump");
