// The buy screen opens with the amount and the mode of the last buy (Buğra,
// Nov 27). What is kept is a small text on the phone; whatever comes back from
// it is checked, so a damaged or old value can never put the screen in a state
// the keypad and the mode list could not have produced.
import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_BUY_PREFS, readBuyPrefs, writeBuyPrefs } from "../../app/src/screens/buyPrefs";

test("nothing kept yet: the defaults (Tight, 0.01 SOL, custom rungs 1, 2, 3)", () => {
  assert.deepEqual(readBuyPrefs(null), DEFAULT_BUY_PREFS);
  assert.deepEqual(DEFAULT_BUY_PREFS, { mode: "tight", amountText: "0.01", customText: "1, 2, 3" });
});

test("what was written is read back", () => {
  const prefs = { mode: "launch", amountText: "0.25", customText: "1, 2, 3" } as const;
  assert.deepEqual(readBuyPrefs(writeBuyPrefs(prefs)), prefs);
  const custom = { mode: "custom", amountText: "0.5", customText: "1, 2, 3, 5, 8" } as const;
  assert.deepEqual(readBuyPrefs(writeBuyPrefs(custom)), custom);
});

test("damaged text gives the defaults", () => {
  assert.deepEqual(readBuyPrefs("not json"), DEFAULT_BUY_PREFS);
  assert.deepEqual(readBuyPrefs("[1,2]"), DEFAULT_BUY_PREFS);
  assert.deepEqual(readBuyPrefs("null"), DEFAULT_BUY_PREFS);
});

test("each field is checked on its own: a bad one falls back, the good ones stay", () => {
  const read = (o: unknown) => readBuyPrefs(JSON.stringify(o));
  assert.deepEqual(read({ mode: "turbo", amountText: "0.1", customText: "2, 4" }), {
    mode: "tight",
    amountText: "0.1",
    customText: "2, 4",
  });
  assert.equal(read({ mode: "fast", amountText: "abc" }).amountText, "0.01");
  assert.equal(read({ mode: "fast", amountText: "abc" }).mode, "fast");
  assert.equal(read({ amountText: "1e5" }).amountText, "0.01");
  assert.equal(read({ amountText: "-1" }).amountText, "0.01");
  assert.equal(read({ amountText: 5 }).amountText, "0.01");
  assert.equal(read({ customText: "x".repeat(200) }).customText, "1, 2, 3");
});

test("an empty or zero amount is not kept: the screen would open on nothing", () => {
  const read = (amountText: string) => readBuyPrefs(JSON.stringify({ amountText })).amountText;
  assert.equal(read(""), "0.01");
  assert.equal(read("0"), "0.01");
  assert.equal(read("0."), "0.01");
  assert.equal(read("0.000"), "0.01");
  assert.equal(read("0.5"), "0.5");
  assert.equal(read("2"), "2");
});
