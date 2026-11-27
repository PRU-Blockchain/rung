// "Recent buys" on the page shows the rung a buy filled on. A rung that belongs
// to none of the four modes (for example the 0.01% first rung of a measurement
// run) reads like a mistake without a word next to it, so the page marks it as
// a custom rung. The rule is here so it can be checked.
import assert from "node:assert/strict";
import { test } from "node:test";

import { isModeRung } from "../../web/lib/rungs";

test("the rungs of the four modes are mode rungs", () => {
  // Tight 1-2-3, Normal 2-3-5, Fast 5-10-15, Launch 10-20-30 (in basis points)
  for (const [index, bps] of [
    [0, 100], [1, 200], [2, 300],
    [0, 200], [1, 300], [2, 500],
    [0, 500], [1, 1000], [2, 1500],
    [0, 1000], [1, 2000], [2, 3000],
  ] as const) {
    assert.equal(isModeRung(index, bps), true, `${index}:${bps}`);
  }
});

test("a 0.01% first rung is not a mode rung", () => {
  assert.equal(isModeRung(0, 1), false);
});

test("a mode's slippage on another step is not a mode rung", () => {
  assert.equal(isModeRung(0, 300), false); // 3% is Tight's third rung, not a first rung
  assert.equal(isModeRung(2, 100), false);
});

test("a fourth or fifth rung is always custom: the modes have three", () => {
  assert.equal(isModeRung(3, 500), false);
  assert.equal(isModeRung(4, 800), false);
});
