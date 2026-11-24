// The receipt's "Difference" line. The first mainnet buy through the app paid
// the price it saw and the line read "-0%": a difference that rounds to nothing
// has no sign.
import assert from "node:assert/strict";
import { test } from "node:test";

import { signedPctText } from "../../app/src/percent";

test("a higher price paid is shown with a plus, a lower one with a minus", () => {
  assert.equal(signedPctText(0.28), "+0.28%");
  assert.equal(signedPctText(-6.14), "-6.14%");
  assert.equal(signedPctText(2), "+2%");
});

test("two decimals at most", () => {
  assert.equal(signedPctText(0.934), "+0.93%");
  assert.equal(signedPctText(-3.8949), "-3.89%");
});

test("a difference that rounds to nothing has no sign", () => {
  assert.equal(signedPctText(0), "0%");
  assert.equal(signedPctText(-0.0001), "0%");
  assert.equal(signedPctText(0.004), "0%");
  assert.equal(signedPctText(-0), "0%");
});
