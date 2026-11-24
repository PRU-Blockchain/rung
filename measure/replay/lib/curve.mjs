// Quote arithmetic, a line-for-line port of client/src/quote.ts (rawQuote, quoteAfterFees,
// minTokensAt, minTokensForRung, expectedTokensStart) and programs/rung/src/math.rs. BigInt only.
export const BPS = 10_000n;
const ceilDiv = (a, b) => (a + b - 1n) / b;

/** Fee-free constant product: floor(l * vt / (vs + l)). */
export function rawQuote(lamports, st) {
  return (lamports * st.vt) / (st.vs + lamports);
}

/** pump's SOL -> tokens with fees, each fee rounded up on its own (quote.ts quoteAfterFees). */
export function quoteAfterFees(spendable, st, feeBps) {
  const total = feeBps.reduce((a, b) => a + b, 0n);
  let net = (spendable * BPS) / (BPS + total);
  const fees = feeBps.reduce((s, b) => s + ceilDiv(net * b, BPS), 0n);
  if (net + fees > spendable) net -= net + fees - spendable;
  if (net <= 1n) return 0n;
  return ((net - 1n) * st.vt) / (st.vs + net - 1n);
}

/** Lamports (with fees) to buy exactly `amount` tokens: ceil(amount * vs / (vt - amount)) + fees, rounded up. */
export function costForTokens(amount, st, feeBps) {
  if (amount >= st.vt) return null;
  const sol = ceilDiv(amount * st.vs, st.vt - amount);
  return sol + feeBps.reduce((s, b) => s + ceilDiv(sol * b, BPS), 0n);
}

/** math.rs min_tokens_at: fewest tokens at most `bps` above a quote, rounded up. */
export function minTokensAt(expected, bps) {
  const d = BPS + BigInt(bps);
  return ceilDiv(expected * BPS, d);
}

/** math.rs min_tokens_for_rung. */
export function minTokensForRung(seen, start, rungBps, capBps) {
  const a = minTokensAt(seen, capBps);
  const b = minTokensAt(start, rungBps);
  return a > b ? a : b;
}

/** open_order: floor(seen * raw_quote(amount, reserves now) / raw_seen). */
export function expectedTokensStart(seen, rawSeen, rawNow) {
  return (seen * rawNow) / rawSeen;
}

export const spot = (st) => Number(st.vs) / Number(st.vt);
