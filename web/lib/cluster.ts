// Which network an RPC endpoint is on. The counter reads the endpoint the
// server is given (`RPC_URL`); before counting it asks for the genesis hash,
// so one network's orders are never shown under the other's name.
// Pure, tested from client/test/web-cluster.test.ts.

import type { Network } from "./status";

/** What `getGenesisHash` answers on each network (read from the public endpoints, Nov 26, 2026). */
export const GENESIS_HASH: Record<Network, string> = {
  "mainnet-beta": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
};

export const rpcIsOnNetwork = (network: Network, genesisHash: string | undefined): boolean =>
  genesisHash === GENESIS_HASH[network];
