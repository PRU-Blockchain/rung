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

/**
 * Of what leaves the wallet when the order opens, the part that comes back for
 * sure after a buy: the rent of the accounts opened and closed inside the buy,
 * the margin, and the fee budget beyond the most the tries, the refund and the
 * sweep can cost. A buy on an early rung returns more; an order that does not
 * buy returns the amount too.
 */
export function returnsAtLeast(p: {
  vaultTokenAccount: bigint;
  vaultWsolAccount: bigint;
  margin: bigint;
  feeBudgetTotal: bigint;
  maxFeeIfNoFill: bigint;
}): bigint {
  const back = p.vaultTokenAccount + p.vaultWsolAccount + p.margin + p.feeBudgetTotal - p.maxFeeIfNoFill;
  return back > 0n ? back : 0n;
}

/** Lamports as SOL with at most four decimals, trailing zeros dropped. */
function sol4(lamports: bigint, round: "nearest" | "down"): string {
  const unit = 100_000n; // 0.0001 SOL
  const units = round === "down" ? lamports / unit : (lamports + unit / 2n) / unit;
  const whole = units / 10_000n;
  const frac = (units % 10_000n).toString().padStart(4, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/**
 * The line above the Buy button: the number the wallet will show, and how much
 * of it returns. The wallet's number is rounded to four places; what returns is
 * rounded down, so it is never overstated.
 */
export const walletLine = (leaves: bigint, back: bigint): string =>
  `Wallet shows ${sol4(leaves, "nearest")} SOL · ${sol4(back, "down")} returns`;
