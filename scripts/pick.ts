// `--mint busy`: the rule that picks a curve for a test buy. Pure, so it is
// tested (client/test/pick.test.ts); scripts/ladder.ts reads the chain and
// passes in what it found.

export interface CurveActivity {
  mint: string;
  /** Open, paired with SOL, not a cashback coin, not in mayhem mode. */
  usable: boolean;
  /** Successful transactions that touched the curve in the last 60 seconds. */
  tradesLastMinute: number;
  /** Price change over the few seconds the script watched, in basis points. */
  priceMoveBps: number;
}

/**
 * The busiest usable curve whose price is not falling. Throws when there is
 * none, so the script stops before it sends anything.
 */
export function pickBusyCurve(curves: readonly CurveActivity[], minTrades: number): CurveActivity {
  const fit = curves.filter((c) => c.usable && c.tradesLastMinute >= minTrades && c.priceMoveBps >= 0);
  if (fit.length === 0) {
    throw new Error(
      `no open curve with at least ${minTrades} trades in the last minute and a price that is not falling was found; nothing was sent.`,
    );
  }
  // Array.prototype.sort is stable: equal curves keep the order given.
  return [...fit].sort((a, b) => b.tradesLastMinute - a.tradesLastMinute || b.priceMoveBps - a.priceMoveBps)[0];
}
