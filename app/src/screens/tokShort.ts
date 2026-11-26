// Pure: no React, no network. The short token count on the buy screen, the
// site's `fmtTokShort` rule (web/app/phone/phone.ts): 1000 and above without
// decimals, 1 and above at most 2 decimals, below 1 at most 6. 40.795274 -> "40.8".

export function tokShort(x: number): string {
  if (!Number.isFinite(x) || x <= 0) return "0";
  const digits = x >= 1000 ? 0 : x >= 1 ? 2 : 6;
  const fixed = x.toFixed(digits);
  const [whole, frac = ""] = fixed.split(".");
  const trimmed = frac.replace(/0+$/, "");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

/** Token base units as a number of whole tokens, for display only. */
export function wholeTokens(baseUnits: bigint, decimals: number): number {
  return Number(baseUnits) / 10 ** decimals;
}
