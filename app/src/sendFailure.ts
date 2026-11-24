// Pure: no React, no network. Tested from client/test/app-send-failure.test.ts.

export const TOO_SLOW = "Approval took too long. Nothing was sent. Try again.";

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
