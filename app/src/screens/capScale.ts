// The line on the "not bought" screen: from the price you saw (left end) to a
// little past where the price went. Two marks: your cap, and the price after
// the last try. Pure, so the places can be tested.

/** Where the price mark sits; the room right of it shows the line goes on. */
const PRICE_AT = 0.8;
/** The cap mark never gets closer to the left end than this, so it stays readable. */
const CAP_MIN = 0.06;

/**
 * The two marks as shares of the line's width, or null when there is nothing
 * true to draw: the price is not known, or it is not above the cap.
 */
export function capScale(capBps: number, priceAbovePct: number | undefined): { cap: number; price: number } | null {
  const capPct = capBps / 100;
  if (priceAbovePct === undefined || capPct <= 0 || priceAbovePct <= capPct) return null;
  const cap = Math.max(CAP_MIN, Number(((capPct / priceAbovePct) * PRICE_AT).toFixed(4)));
  return { cap, price: PRICE_AT };
}
