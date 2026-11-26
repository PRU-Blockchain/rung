// When the wallet's approval comes after the transaction's lifetime, sending it
// fails. Seen on mainnet (Phantom, approval 84 s after the request): the RPC
// answered only "Transaction simulation failed." with empty logs, and the app
// showed that raw text instead of "Approval took too long. Nothing was sent.
// Try again."
import assert from "node:assert/strict";
import { test } from "node:test";

import { TOO_SLOW, WALLET_SILENT, WALLET_UNREACHABLE, sendFailureText, walletProblemText } from "../../app/src/sendFailure";

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

// What the wallet step can answer. Seen on the mainnet build (Nov 26, 2026):
// with Solflare locked behind its passcode the screen read "Something went
// wrong: com.solana.mobilewalletadapter.clientlib.scenario.LocalAssociation
// Scenario$ConnectionFailedException: Unable to connect to websocket server".
test("a wallet that cannot be reached is said in words, not as a Java exception", () => {
  const raw =
    "com.solana.mobilewalletadapter.clientlib.scenario.LocalAssociationScenario$ConnectionFailedException: Unable to connect to websocket server";
  assert.equal(walletProblemText(undefined, raw), WALLET_UNREACHABLE);
  assert.equal(WALLET_UNREACHABLE, "Could not reach the wallet. Open it, unlock it and try again. Nothing was sent.");
});

test("a wallet that never answers (it showed its own screen instead) is said in words", () => {
  assert.equal(walletProblemText(undefined, "java.util.concurrent.TimeoutException: Timed out waiting for response id=3"), WALLET_SILENT);
  assert.equal(WALLET_SILENT, "The wallet did not answer in time. Nothing was sent. Try again.");
});

test("the answers the app already worded keep their words", () => {
  assert.equal(walletProblemText(-3, "sign request declined"), "The wallet did not approve the buy. Nothing was sent.");
  assert.equal(walletProblemText(undefined, "User rejected the request"), "The wallet did not approve the buy. Nothing was sent.");
  assert.equal(
    walletProblemText(undefined, "java.util.concurrent.CancellationException: request cancelled"),
    "The wallet closed before approving. Nothing was sent.",
  );
  assert.equal(walletProblemText(undefined, "WRONG_ACCOUNT"), "The wallet approved with a different account. Nothing was sent.");
});

test("an error the wallet step does not explain is left to the caller", () => {
  assert.equal(walletProblemText(undefined, "Network request failed"), null);
  assert.equal(walletProblemText(undefined, "Cannot read property 'x' of undefined"), null);
});
