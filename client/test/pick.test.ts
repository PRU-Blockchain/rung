// `--mint busy`: which of the curves seen in recent trades the script buys on.
// The rule is a pure function so that it can be tested; the script only feeds
// it what it read from the chain.
import assert from "node:assert/strict";
import { test } from "node:test";

import { type CurveActivity, pickBusyCurve } from "../../scripts/pick";

const curve = (over: Partial<CurveActivity>): CurveActivity => ({
  mint: "MINT",
  usable: true,
  tradesLastMinute: 50,
  priceMoveBps: 100,
  ...over,
});

test("the busiest usable curve whose price is not falling is picked", () => {
  const picked = pickBusyCurve(
    [
      curve({ mint: "QUIET", tradesLastMinute: 31 }),
      curve({ mint: "BUSY", tradesLastMinute: 120 }),
      curve({ mint: "MIDDLE", tradesLastMinute: 60 }),
    ],
    30,
  );
  assert.equal(picked.mint, "BUSY");
});

test("a curve that cannot be bought on is never picked, however busy", () => {
  // Complete, cashback, mayhem or not paired with SOL: the script marks all of them unusable.
  const picked = pickBusyCurve([curve({ mint: "UNUSABLE", usable: false, tradesLastMinute: 500 }), curve({ mint: "OK", tradesLastMinute: 40 })], 30);
  assert.equal(picked.mint, "OK");
});

test("a falling price is not bought into", () => {
  const picked = pickBusyCurve([curve({ mint: "FALLING", tradesLastMinute: 300, priceMoveBps: -1 }), curve({ mint: "FLAT", tradesLastMinute: 40, priceMoveBps: 0 })], 30);
  assert.equal(picked.mint, "FLAT");
});

test("fewer trades than the minimum is not busy", () => {
  assert.equal(pickBusyCurve([curve({ mint: "EXACT", tradesLastMinute: 30 })], 30).mint, "EXACT");
  assert.throws(() => pickBusyCurve([curve({ tradesLastMinute: 29 })], 30), /no open curve.*at least 30 trades.*nothing was sent/s);
});

test("with nothing to pick the script stops before sending anything", () => {
  assert.throws(() => pickBusyCurve([], 30), /nothing was sent/);
  assert.throws(
    () => pickBusyCurve([curve({ usable: false }), curve({ priceMoveBps: -500 }), curve({ tradesLastMinute: 3 })], 30),
    /nothing was sent/,
  );
});

test("equal trade counts: the one that rose more comes first, then the order given", () => {
  assert.equal(pickBusyCurve([curve({ mint: "A", priceMoveBps: 10 }), curve({ mint: "B", priceMoveBps: 90 })], 30).mint, "B");
  assert.equal(pickBusyCurve([curve({ mint: "A" }), curve({ mint: "B" })], 30).mint, "A");
});
