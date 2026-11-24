// Pure: no React, no network. Tested from client/test/app-percent.test.ts.

/**
 * A difference in percent with its sign, two decimals at most: "+0.28%",
 * "-6.14%". A difference that rounds to nothing is "0%", without a sign.
 */
export function signedPctText(pct: number): string {
  const rounded = Number(Math.abs(pct).toFixed(2));
  if (rounded === 0) return "0%";
  return `${pct > 0 ? "+" : "-"}${rounded}%`;
}
