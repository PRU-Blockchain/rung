// What the buy screen takes from the clipboard: a token address, also when it
// sits inside a link or a message ("https://pump.fun/coin/<address>"). Pure, so
// it can be tested without a phone.

import { PublicKey } from "../../../client/src";

/** Runs of base58 characters; an address is 32 to 44 of them. */
const BASE58_RUN = /[1-9A-HJ-NP-Za-km-z]+/g;

/**
 * The first token address in `text`, or null when there is none. A run of
 * base58 characters counts when it is 32–44 long and decodes to 32 bytes, so a
 * transaction signature (about 88 characters) or an ordinary word is not taken.
 */
export function addressInText(text: string): string | null {
  for (const run of text.match(BASE58_RUN) ?? []) {
    if (run.length < 32 || run.length > 44) continue;
    try {
      new PublicKey(run);
      return run;
    } catch {
      // not 32 bytes: keep looking
    }
  }
  return null;
}
