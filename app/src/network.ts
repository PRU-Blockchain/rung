// Which network the app talks to. Chosen when the app is built, from
// EXPO_PUBLIC_CLUSTER; without it the app is on devnet. Pure, with no React
// Native imports, so it is tested from client/test/app-network.test.ts.

export type Cluster = "devnet" | "mainnet-beta";

export interface NetworkConfig {
  cluster: Cluster;
  /** Shown under the app's title. */
  label: "devnet" | "mainnet";
  /** A public endpoint without a key: everything in the app bundle can be read. */
  rpcEndpoint: string;
  /** Mobile Wallet Adapter chain identifier. */
  chain: "solana:devnet" | "solana:mainnet";
}

const DEFAULTS: Record<Cluster, NetworkConfig> = {
  devnet: { cluster: "devnet", label: "devnet", rpcEndpoint: "https://api.devnet.solana.com", chain: "solana:devnet" },
  "mainnet-beta": {
    cluster: "mainnet-beta",
    label: "mainnet",
    rpcEndpoint: "https://api.mainnet-beta.solana.com",
    chain: "solana:mainnet",
  },
};

/** An RPC URL that can go into the bundle: https, and nothing in it that looks like a key. */
function keylessRpc(url: string): string {
  const refuse = () => new Error("EXPO_PUBLIC_RPC_URL must be an https URL without a key in it (the app bundle is readable)");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw refuse();
  }
  const longSegment = parsed.pathname.split("/").some((part) => part.length >= 16);
  if (parsed.protocol !== "https:" || parsed.search !== "" || parsed.username !== "" || parsed.password !== "" || longSegment) {
    throw refuse();
  }
  return url;
}

/**
 * `cluster` is EXPO_PUBLIC_CLUSTER, `rpcUrl` is EXPO_PUBLIC_RPC_URL (optional).
 * An unknown cluster throws: the app does not guess where real SOL goes.
 */
export function networkConfig(cluster: string | undefined, rpcUrl?: string): NetworkConfig {
  let chosen: Cluster;
  if (cluster === undefined || cluster === "" || cluster === "devnet") chosen = "devnet";
  else if (cluster === "mainnet-beta" || cluster === "mainnet") chosen = "mainnet-beta";
  else throw new Error("EXPO_PUBLIC_CLUSTER must be devnet or mainnet-beta");
  const base = DEFAULTS[chosen];
  return rpcUrl ? { ...base, rpcEndpoint: keylessRpc(rpcUrl) } : base;
}

/** Whether a receipt written on `receiptCluster` is listed in the build for `build`. Unknown (an old receipt) is listed. */
export const receiptShownOn = (receiptCluster: Cluster | undefined, build: Cluster): boolean =>
  receiptCluster === undefined || receiptCluster === build;

/**
 * The network of a receipt written before receipts carried one. `known` says
 * whether this build's network has the receipt's token (null: no answer).
 * A token mainnet does not have was not bought on mainnet, so it was bought
 * on devnet; devnet can be reset, so "not there" on devnet decides nothing.
 */
export function legacyReceiptCluster(build: Cluster, known: boolean | null): Cluster | undefined {
  if (known === true) return build;
  if (known === false && build === "mainnet-beta") return "devnet";
  return undefined;
}

export function explorerTxUrl(network: NetworkConfig, signature: string): string {
  const query = network.cluster === "mainnet-beta" ? "" : `?cluster=${network.cluster}`;
  return `https://explorer.solana.com/tx/${signature}${query}`;
}
