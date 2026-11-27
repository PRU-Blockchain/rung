// Custom mode: one box per rung with arrows between them, instead of one line
// of text where the buyer had to know about commas and spaces (Buğra, on his
// phone, Nov 27). The boxes are another way of typing the same text the app
// already checks ("1, 2, 3"); these are the rules between the two.
import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_BOXES, boxesText, cleanBox, rungBoxes } from "../../app/src/screens/customBoxes";

test("the kept text opens as boxes: at least three, at most five", () => {
  assert.deepEqual(rungBoxes("1, 2, 3"), ["1", "2", "3"]);
  assert.deepEqual(rungBoxes("5"), ["5", "", ""]);
  assert.deepEqual(rungBoxes(""), ["", "", ""]);
  assert.deepEqual(rungBoxes("1, 2, 3, 5, 8"), ["1", "2", "3", "5", "8"]);
  assert.equal(MAX_BOXES, 5);
  assert.equal(rungBoxes("1 2 3 4 5 6 7").length, 5);
});

test("the boxes become the text the app checks; empty boxes are left out", () => {
  assert.equal(boxesText(["1", "2", "3"]), "1, 2, 3");
  assert.equal(boxesText(["1", "", "3"]), "1, 3");
  assert.equal(boxesText(["", "", ""]), "");
  assert.equal(boxesText(["1", "2.5", "4"]), "1, 2.5, 4");
});

test("inside a box a comma is a decimal point: a Turkish keypad types 1,5", () => {
  assert.equal(cleanBox("1,5"), "1.5");
  assert.equal(boxesText([cleanBox("1,5"), cleanBox("3"), ""]), "1.5, 3");
});

test("a box takes digits and one point only, and stays short", () => {
  assert.equal(cleanBox("12a%"), "12");
  assert.equal(cleanBox("1.2.3"), "1.23");
  assert.equal(cleanBox(" 7 "), "7");
  assert.equal(cleanBox("123456789"), "12345");
  assert.equal(cleanBox(""), "");
});

// The text check refuses a comma between two digits ("1,5": one rung or two?). The boxes never write one.
test("what the boxes write never has a comma between two digits", () => {
  for (const boxes of [["1.5", "2.5", "3.5"], [cleanBox("1,5"), cleanBox("2,5"), ""], ["1", "2", "3", "5", "8"]]) {
    assert.equal(/\d,\d/.test(boxesText(boxes)), false);
  }
});
