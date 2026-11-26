// Pure: no React, no network. Tested from client/test/app-funds.test.ts.

/** Kept on top of what a buy takes out of the wallet: the wallet's own fee for the approval. */
export const BALANCE_SLACK_LAMPORTS = 100_000n;

/**
 * Is the connected wallet short of SOL for this buy?
 *
 * With no wallet connected the answer is always no. The buy button then connects
 * a wallet, and the balance of a wallet that was just disconnected must not keep
 * it blocked.
 */
/**
 * The order record deposit this order paid, for the receipt. The record is
 * created by a user's first order and reused afterwards, so a later order
 * pays nothing: only what the record holds now beyond what it held before
 * this order counts. `after` is null when the record is gone.
 */
export function orderDepositPaid(existedBefore: boolean, before: bigint, after: bigint | null): bigint {
  if (after === null) return 0n;
  const paid = existedBefore ? after - before : after;
  return paid > 0n ? paid : 0n;
}

export function walletIsShort(connected: boolean, balance: bigint | null, total: bigint | null): boolean {
  if (!connected || balance === null || total === null) return false;
  return balance < total + BALANCE_SLACK_LAMPORTS;
}
