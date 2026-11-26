// "Not enough SOL in the wallet for this buy." blocks the buy button. Seen on
// the mainnet build: after Disconnect the line stayed, with the balance of the
// wallet that had just left, and the button that should connect the next wallet
// stayed blocked. With no wallet connected nothing can be short.
import assert from "node:assert/strict";
import { test } from "node:test";

import { BALANCE_SLACK_LAMPORTS, orderDepositPaid, walletIsShort } from "../../app/src/funds";

const TOTAL = 10_000_000n;

test("a connected wallet with less than the buy takes is short", () => {
  assert.equal(walletIsShort(true, 0n, TOTAL), true);
  assert.equal(walletIsShort(true, TOTAL - 1n, TOTAL), true);
});

test("the buy needs a little more than what leaves the wallet, for the wallet's own fee", () => {
  assert.equal(walletIsShort(true, TOTAL, TOTAL), true);
  assert.equal(walletIsShort(true, TOTAL + BALANCE_SLACK_LAMPORTS - 1n, TOTAL), true);
  assert.equal(walletIsShort(true, TOTAL + BALANCE_SLACK_LAMPORTS, TOTAL), false);
});

test("with no wallet connected nothing is short: the button connects a wallet first", () => {
  // The balance of the wallet that was just disconnected may still be on the screen.
  assert.equal(walletIsShort(false, 0n, TOTAL), false);
  assert.equal(walletIsShort(false, null, TOTAL), false);
});

test("an unknown balance or an unknown cost is not called short", () => {
  assert.equal(walletIsShort(true, null, TOTAL), false);
  assert.equal(walletIsShort(true, 0n, null), false);
});

// The receipt's "order record deposit" line. The order record is created by a
// user's first order and reused by the later ones; the receipt showed its whole
// deposit on every buy, also on buys that paid none.
const RECORD = 2_011_440n;

test("the first order pays the order record's deposit", () => {
  assert.equal(orderDepositPaid(false, 0n, RECORD), RECORD);
});

test("a later order reuses the record and pays no deposit", () => {
  assert.equal(orderDepositPaid(true, RECORD, RECORD), 0n);
});

test("only what this order added counts, and never less than nothing", () => {
  assert.equal(orderDepositPaid(true, RECORD, RECORD + 500n), 500n);
  assert.equal(orderDepositPaid(true, RECORD + 500n, RECORD), 0n);
});

test("a record that is gone after the order holds no deposit", () => {
  assert.equal(orderDepositPaid(false, 0n, null), 0n);
  assert.equal(orderDepositPaid(true, RECORD, null), 0n);
});
