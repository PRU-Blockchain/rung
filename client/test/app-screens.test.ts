// Two small rules of the app's buy screen: what the keypad types, and how the
// token count under the amount is shortened ("≈ 40.8 CATE").
import assert from "node:assert/strict";
import { test } from "node:test";

import { pressKey } from "../../app/src/screens/amountKeys";
import { tokShort, wholeTokens } from "../../app/src/screens/tokShort";

const type = (keys: string, from = "") => keys.split(" ").reduce((text, k) => pressKey(text, k), from);

test("digits build the amount; a leading zero is replaced, not kept", () => {
  assert.equal(type("1 2"), "12");
  assert.equal(type("5", "0"), "5");
  assert.equal(type("5", "0.01"), "0.015");
});

test("one decimal point at most, and an empty amount starts with 0.", () => {
  assert.equal(type("."), "0.");
  assert.equal(type(". 5 ."), "0.5");
});

test("delete removes the last character, down to nothing", () => {
  assert.equal(type("del", "0.01"), "0.0");
  assert.equal(type("del del del del del", "0.01"), "");
});

test("no more than 9 decimals (a lamport) and 10 digits", () => {
  assert.equal(type("1", "0.123456789"), "0.123456789");
  assert.equal(type("1", "1234567890"), "1234567890");
});

test("the short token count: fewer decimals as the number grows", () => {
  assert.equal(tokShort(40.795274), "40.8");
  assert.equal(tokShort(41.33), "41.33");
  assert.equal(tokShort(479721.790898), "479,722");
  assert.equal(tokShort(1234), "1,234");
  assert.equal(tokShort(0.123456789), "0.123457");
  assert.equal(tokShort(1), "1");
  assert.equal(tokShort(0), "0");
  assert.equal(tokShort(Number.NaN), "0");
});

test("base units to whole tokens", () => {
  assert.equal(wholeTokens(40_795_274n, 6), 40.795274);
  assert.equal(wholeTokens(5n, 0), 5);
});
