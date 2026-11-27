// The rungs of the four modes, in basis points (the same ladders as the modes
// table on the page: Tight, Normal, Fast, Launch).
const MODE_LADDERS: readonly (readonly number[])[] = [
  [100, 200, 300],
  [200, 300, 500],
  [500, 1000, 1500],
  [1000, 2000, 3000],
];

/**
 * True when a rung (its place in the ladder, from 0, and its slippage) is a
 * rung of one of the four modes. Anything else can only come from a custom
 * ladder. A custom ladder may also use a mode's rung; that cannot be told from
 * the fill alone, so the page marks only the rungs that are certainly custom.
 */
export const isModeRung = (rungIndex: number, rungBps: number): boolean =>
  MODE_LADDERS.some((ladder) => ladder[rungIndex] === rungBps);
