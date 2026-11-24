// When the wallet's approval comes after the transaction's lifetime, sending it
// fails. Seen on mainnet (Phantom, approval 84 s after the request): the RPC
// answered only "Transaction simulation failed." with empty logs, and the app
// showed that raw text instead of "Approval took too long. Nothing was sent.
// Try again."
import assert from "node:assert/strict";
import { test } from "node:test";

import { TOO_SLOW, sendFailureText } from "../../app/src/sendFailure";

const RAW =
  "Simulation failed. \nMessage: Transaction simulation failed. \nLogs: \n[]. \nCatch the `SendTransactionError` and call `getLogs()` on it for full details.";

test("an expired transaction is reported as a slow approval, whatever the RPC says", () => {
  assert.equal(sendFailureText(RAW, true), TOO_SLOW);
});

test("a failure that names the blockhash is a slow approval even before the height is known", () => {
  assert.equal(sendFailureText("Transaction simulation failed: Blockhash not found", false), TOO_SLOW);
  assert.equal(sendFailureText("block height exceeded: the transaction has expired", false), TOO_SLOW);
});

test("any other failure keeps its reason", () => {
  const text = sendFailureText("Transaction simulation failed: insufficient funds for rent", false);
  assert.equal(text, "The buy could not be sent: Transaction simulation failed: insufficient funds for rent");
});

test("the developer hint and the empty log list of the RPC error are not shown", () => {
  const text = sendFailureText(RAW, false);
  assert.equal(text, "The buy could not be sent: Simulation failed. Message: Transaction simulation failed.");
});
