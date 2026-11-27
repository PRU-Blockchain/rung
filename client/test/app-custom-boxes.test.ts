// Custom mode: one box per rung with arrows between them, instead of one line
// of text where the buyer had to know about commas and spaces (Buğra, on his
// phone, Nov 27). The boxes are another way of typing the same text the app
// already checks ("1, 2, 3"); these are the rules between the two.
import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_BOXES, boxesText, cleanBox, pressBoxKey, pressPickedBox, rungBoxes } from "../../app/src/screens/customBoxes";

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

// The boxes are typed with the app's own keypad (Nov 27, late): with the system
// keyboard the cursor and the selection inside a box were unreliable (typing
// 0.01 gave 1 on the emulator and on Buğra's phone), and the keyboard squeezed
// the sheet. A key always acts on the end of the box's text.
test("the keypad types at the end of the box: 0.01 stays 0.01", () => {
  const type = (keys: string, from = "") => keys.split(" ").reduce((text, k) => pressBoxKey(text, k), from);
  assert.equal(type("0 . 0 1"), "0.01");
  assert.equal(type("2 . 5"), "2.5");
  assert.equal(type("1 0"), "10");
});

test("a leading zero is replaced by the next digit, but kept before a point", () => {
  assert.equal(pressBoxKey("0", "5"), "5");
  assert.equal(pressBoxKey("0", "."), "0.");
  assert.equal(pressBoxKey("", "."), "0.");
});

test("delete takes the last character away; on an empty box it does nothing", () => {
  assert.equal(pressBoxKey("0.01", "del"), "0.0");
  assert.equal(pressBoxKey("5", "del"), "");
  assert.equal(pressBoxKey("", "del"), "");
});

test("a box holds a percent: one point, two decimals, two digits before it", () => {
  assert.equal(pressBoxKey("1.5", "."), "1.5");
  assert.equal(pressBoxKey("0.01", "5"), "0.01");
  assert.equal(pressBoxKey("30", "0"), "30");
  assert.equal(pressBoxKey("30", "."), "30.");
});

// A box that was just picked is typed over, not added to: picking the box that
// says 3 and typing 0.01 gives 0.01, not 30.01 (seen on the emulator).
test("the first key after picking a box starts it over; the following keys add to it", () => {
  assert.equal(pressPickedBox("3", "0", true), "0");
  assert.equal(pressPickedBox("0", ".", false), "0.");
  assert.equal(pressPickedBox("0.0", "1", false), "0.01");
});

test("delete on a box that was just picked empties it", () => {
  assert.equal(pressPickedBox("2.5", "del", true), "");
  assert.equal(pressPickedBox("2.5", "del", false), "2.");
});
