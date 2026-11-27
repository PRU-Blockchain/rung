// Two small rules behind the screens (Buğra, Nov 27):
// - the ladder gives a short vibration at each try and a different one at the
//   end, so the buyer feels "trying, trying, bought" without watching;
// - the "not bought" screen draws the cap and where the price went on one
//   line; where the two marks sit is this rule.
import assert from "node:assert/strict";
import { test } from "node:test";

import { capScale } from "../../app/src/screens/capScale";
import { vibrationFor } from "../../app/src/screens/ladderHaptics";

test("each try that is sent gives one short tick", () => {
  assert.equal(vibrationFor({ type: "sent", kind: "try" }), 12);
});

test("a buy gives two pulses; a refund one longer pulse", () => {
  assert.deepEqual(vibrationFor({ type: "result", attempt: { kind: "try", outcome: "filled" } }), [0, 28, 70, 28]);
  assert.equal(vibrationFor({ type: "sent", kind: "refund" }), 40);
});

test("nothing else vibrates: a missed try, the sweep, the results of the refund", () => {
  assert.equal(vibrationFor({ type: "result", attempt: { kind: "try", outcome: "slippage" } }), null);
  assert.equal(vibrationFor({ type: "result", attempt: { kind: "try", outcome: "order-filled" } }), null);
  assert.equal(vibrationFor({ type: "sent", kind: "sweep" }), null);
  assert.equal(vibrationFor({ type: "result", attempt: { kind: "refund", outcome: "ok" } }), null);
});

test("price above the cap: the price mark sits at 80% of the line, the cap in proportion", () => {
  // cap 3%, price 6% above the price seen
  assert.deepEqual(capScale(300, 6), { cap: 0.4, price: 0.8 });
  // just above the cap: the two marks are close, the cap stays left of the price
  const near = capScale(300, 3.1)!;
  assert.equal(near.price, 0.8);
  assert.ok(near.cap < near.price && near.cap > 0.75);
});

test("no line when there is nothing true to draw", () => {
  assert.equal(capScale(300, undefined), null); // the price after the last try is not known
  assert.equal(capScale(300, 2.5), null); // the price is back under the cap
  assert.equal(capScale(300, -1), null);
  assert.equal(capScale(0, 5), null);
});

test("a price far above the cap keeps the cap mark visible", () => {
  const far = capScale(300, 80)!; // 80% above
  assert.equal(far.price, 0.8);
  assert.ok(far.cap >= 0.06);
});
