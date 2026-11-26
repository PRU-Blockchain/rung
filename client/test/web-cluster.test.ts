// The page's counter reads whatever RPC the server is given (RPC_URL). If that
// endpoint is on another network than the page says, the page would show one
// network's orders under the other's name. The counter asks the endpoint for
// its genesis hash first and refuses a mismatch.
import assert from "node:assert/strict";
import { test } from "node:test";

import { GENESIS_HASH, rpcIsOnNetwork } from "../../web/lib/cluster";

test("the genesis hashes are the ones the public endpoints report (read Nov 26, 2026)", () => {
  assert.equal(GENESIS_HASH["mainnet-beta"], "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d");
  assert.equal(GENESIS_HASH.devnet, "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
});

test("an endpoint is accepted only for its own network", () => {
  assert.equal(rpcIsOnNetwork("mainnet-beta", GENESIS_HASH["mainnet-beta"]), true);
  assert.equal(rpcIsOnNetwork("devnet", GENESIS_HASH.devnet), true);
  assert.equal(rpcIsOnNetwork("mainnet-beta", GENESIS_HASH.devnet), false);
  assert.equal(rpcIsOnNetwork("devnet", GENESIS_HASH["mainnet-beta"]), false);
  assert.equal(rpcIsOnNetwork("mainnet-beta", ""), false);
  assert.equal(rpcIsOnNetwork("devnet", undefined), false);
});
