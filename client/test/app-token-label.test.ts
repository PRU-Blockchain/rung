// How a token's name is written on the app's screens, and what stands in for
// its picture while there is none.
import assert from "node:assert/strict";
import { test } from "node:test";

import { tokenInitials, tokenTitle } from "../../app/src/tokenLabel";

test("name and symbol, the symbol once", () => {
  assert.equal(tokenTitle({ name: "Catecoin", symbol: "CATE" }), "Catecoin · CATE");
  assert.equal(tokenTitle({ name: "PURRL", symbol: "PURRL" }), "PURRL");
  assert.equal(tokenTitle({ name: "Fartcoin", symbol: "fartcoin" }), "Fartcoin");
  assert.equal(tokenTitle({ name: "", symbol: "CATE" }), "CATE");
  assert.equal(tokenTitle({ name: "Catecoin", symbol: "" }), "Catecoin");
  assert.equal(tokenTitle({ name: "", symbol: "" }), "");
  assert.equal(tokenTitle(null), "");
});

test("the first two characters of the name stand in for the picture", () => {
  assert.equal(tokenInitials({ name: "Catecoin", symbol: "CATE" }), "CA");
  assert.equal(tokenInitials({ name: "the King Of /b/", symbol: "PETER" }), "TH");
  assert.equal(tokenInitials({ name: "", symbol: "sheep" }), "SH");
  assert.equal(tokenInitials({ name: "X", symbol: "XX" }), "X");
  // Whole characters, never half of one.
  assert.equal(tokenInitials({ name: "🐱cat", symbol: "CAT" }), "🐱C");
  assert.equal(tokenInitials({ name: "a b", symbol: "" }), "AB");
  assert.equal(tokenInitials(null), "");
});
