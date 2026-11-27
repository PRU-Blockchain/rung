// Pure: no React, no network. Tested from client/test/app-send-failure.test.ts.

export const TOO_SLOW = "Approval took too long. Nothing was sent. Try again.";

export const WALLET_UNREACHABLE = "Could not reach the wallet. Open it, unlock it and try again. Nothing was sent.";
export const WALLET_SILENT = "The wallet did not answer in time. Nothing was sent. Try again.";

/**
 * What the screen says when the wallet step (connecting, or signing the
 * order) failed, or null when the error is not one the wallet step explains.
 * Nothing has been sent at that point: the app sends only after the wallet
 * signed.
 *
 * `code` is the Mobile Wallet Adapter error code when there is one (-3: the
 * request was declined); `text` is the error's message, often the name of a
 * Java exception from the wallet adapter.
 */
export function walletProblemText(code: unknown, text: string): string | null {
  if (code === -3 || /declin|not signed|reject/i.test(text)) return "The wallet did not approve the buy. Nothing was sent.";
  if (/CancellationException|cancel/i.test(text)) return "The wallet closed before approving. Nothing was sent.";
  // Connected with one wallet, approved in another: say how to switch (Nov 27; the old sentence stopped at
  // "approved with a different account").
  if (/WRONG_ACCOUNT/.test(text)) {
    return "That wallet holds a different account than the one connected here. Nothing was sent. To use it, tap your address at the top and disconnect first.";
  }
  // The wallet app did not open its side of the connection: locked, or still starting.
  if (/ConnectionFailedException|Unable to connect to websocket/i.test(text)) return WALLET_UNREACHABLE;
  // The wallet closed its side of the session before the request reached it (Solflare, Nov 27).
  if (/Cannot send in CLOSED|socket is closed/i.test(text)) return WALLET_UNREACHABLE;
  // The wallet took the request and never answered: it showed a screen of its own instead.
  if (/TimeoutException|timed out/i.test(text)) return WALLET_SILENT;
  return null;
}

/**
 * What the screen says when the signed order could not be sent.
 *
 * `blockhashExpired`: the chain is already past the transaction's last valid
 * block height. The RPC does not always say so (on mainnet it answered only
 * "Transaction simulation failed." with empty logs), so the caller checks the
 * height itself.
 */
export function sendFailureText(text: string, blockhashExpired: boolean): string {
  if (blockhashExpired || /blockhash not found|expired/i.test(text)) return TOO_SLOW;
  // web3.js appends the (often empty) log list and a hint for developers.
  const reason = text
    .split(/\s*\n\s*Logs:/)[0]
    .replace(/\s*\n\s*/g, " ")
    .trim();
  return `The buy could not be sent: ${reason}`;
}
