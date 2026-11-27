// The amount and the mode of the last buy, kept on the phone so the buy screen
// opens with them. Pure: the screen does the reading and writing of the store.

import type { Mode } from "../../../client/src";

export interface BuyPrefs {
  mode: Mode;
  /** The amount as the keypad typed it, e.g. "0.05". */
  amountText: string;
  /** The custom rungs as typed, e.g. "1, 2, 3"; kept also when the mode is another one. */
  customText: string;
}

export const DEFAULT_BUY_PREFS: BuyPrefs = { mode: "tight", amountText: "0.01", customText: "1, 2, 3" };

/** Where the screen keeps them (AsyncStorage). */
export const BUY_PREFS_KEY = "rung.buyPrefs";

const MODES: readonly Mode[] = ["tight", "normal", "fast", "launch", "custom"];

/** Digits with at most one dot, as the keypad makes them, and more than zero. */
const keptAmount = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 12 && /^\d+\.?\d*$/.test(v) && Number(v) > 0;

export const writeBuyPrefs = (prefs: BuyPrefs): string => JSON.stringify(prefs);

/** What was kept; every field that is missing or not what the screen could have made falls back to its default. */
export function readBuyPrefs(text: string | null): BuyPrefs {
  let kept: Record<string, unknown> = {};
  try {
    const parsed: unknown = text === null ? null : JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) kept = parsed as Record<string, unknown>;
  } catch {
    // damaged: the defaults
  }
  return {
    mode: MODES.includes(kept.mode as Mode) ? (kept.mode as Mode) : DEFAULT_BUY_PREFS.mode,
    amountText: keptAmount(kept.amountText) ? kept.amountText : DEFAULT_BUY_PREFS.amountText,
    customText:
      typeof kept.customText === "string" && kept.customText.length > 0 && kept.customText.length <= 40
        ? kept.customText
        : DEFAULT_BUY_PREFS.customText,
  };
}
