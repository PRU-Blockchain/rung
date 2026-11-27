// Custom mode's boxes, one per rung. They are another way of typing the text
// the app already checks ("1, 2, 3", see parseCustomRungs in flow/plan.ts):
// these functions go from the text to the boxes and back. Pure.

/** The program takes at most five rungs. */
export const MAX_BOXES = 5;
/** A fresh custom ladder shows three boxes. */
const MIN_BOXES = 3;

/** The kept text as boxes: at least three (empty ones to fill in), at most five. */
export function rungBoxes(text: string): string[] {
  const boxes = text
    .split(/[,\s]+/)
    .filter(Boolean)
    .slice(0, MAX_BOXES);
  while (boxes.length < MIN_BOXES) boxes.push("");
  return boxes;
}

/** The boxes as the text the app checks; empty boxes are left out. */
export const boxesText = (boxes: string[]): string => boxes.filter((b) => b !== "").join(", ");

/**
 * What a box keeps of what was typed: digits and one decimal point, five
 * characters at most. A comma is a decimal point here (a Turkish keypad types
 * "1,5"); between boxes there is nothing to separate any more.
 */
export function cleanBox(typed: string): string {
  let out = "";
  for (const ch of typed.replace(/,/g, ".")) {
    if (ch >= "0" && ch <= "9") out += ch;
    else if (ch === "." && !out.includes(".")) out += ch;
    if (out.length === 5) break;
  }
  return out;
}
