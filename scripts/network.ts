// Which network the ladder script talks to, and what it refuses to do when the
// SOL is real. Pure functions: no RPC calls here, so every rule has a test
// (client/test/network.test.ts).

// `solana genesis-hash -u devnet` / `-u mainnet-beta`, checked 2026-11-23.
export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

export type Network = "devnet" | "mainnet" | "local fork";

export type Flags = Record<string, string | boolean>;

/** The most one order of this script may spend on mainnet: 0.01 SOL. Larger buys go through the app. */
export const MAINNET_MAX_ORDER_LAMPORTS = 10_000_000n;

/** Flags that buy on the venue from our own wallet to move the price. */
const TEST_AIDS = ["push-after-open", "push-pct", "push-only", "wait-order"];

/** Host of an RPC URL. The path, the query and the credentials can hold an API key and are never shown. */
export function rpcHost(rpc: string): string {
  try {
    return new URL(rpc).hostname;
  } catch {
    return "(unreadable RPC URL)";
  }
}

/**
 * `text` without the RPC URL and without the pieces of it that can be a key
 * (query values and path segments of 8 characters or more). Error messages of
 * the network layer can quote the URL; they pass through here before printing.
 */
export function hideRpc(text: string, rpc: string): string {
  let url: URL;
  try {
    url = new URL(rpc);
  } catch {
    return text;
  }
  let out = text.split(rpc).join(`(RPC ${url.hostname})`);
  const pieces = [...url.searchParams.values(), ...url.pathname.split("/"), url.username, url.password];
  for (const piece of pieces) {
    if (piece.length >= 8) out = out.split(piece).join("(hidden)");
  }
  return out;
}

function isThisMachine(rpc: string): boolean {
  let host: string;
  try {
    host = new URL(rpc).hostname;
  } catch {
    return false;
  }
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
}

/**
 * The network of this run, from the genesis hash the RPC reports and the two
 * flags. Throws, before anything is sent, whenever the flags and the RPC
 * disagree: real SOL moves only when `--mainnet` was typed and the RPC is
 * mainnet itself.
 */
export function chooseNetwork(input: { genesisHash: string; rpc: string; localFork: boolean; mainnet: boolean }): Network {
  const { genesisHash, rpc, localFork, mainnet } = input;
  if (localFork && mainnet) throw new Error("--mainnet and --local-fork cannot be used together; nothing was sent.");
  if (localFork) {
    try {
      new URL(rpc);
    } catch {
      throw new Error("--local-fork needs --rpc <http://127.0.0.1:PORT>");
    }
    if (!isThisMachine(rpc)) {
      throw new Error(`--local-fork accepts only an RPC on this machine, not ${rpcHost(rpc)}; nothing was sent.`);
    }
    return "local fork";
  }
  if (genesisHash === MAINNET_GENESIS_HASH) {
    // A fork of mainnet reports mainnet's genesis hash; it is not mainnet.
    if (isThisMachine(rpc)) {
      throw new Error("this RPC is on this machine and reports mainnet: it is a fork. Use --local-fork; nothing was sent.");
    }
    if (!mainnet) {
      throw new Error("this RPC is MAINNET (real SOL). Pass --mainnet to use it; nothing was sent.");
    }
    return "mainnet";
  }
  if (genesisHash === DEVNET_GENESIS_HASH) {
    if (mainnet) throw new Error("--mainnet was given but this RPC is devnet; nothing was sent.");
    return "devnet";
  }
  throw new Error(`this RPC is neither devnet nor mainnet (genesis ${genesisHash}); nothing was sent.`);
}

/**
 * Rules of a mainnet run. `amountLamports` is checked when the run opens an
 * order.
 */
export function checkMainnetRun(input: { flags: Flags; amountLamports?: bigint }): void {
  const { flags, amountLamports } = input;
  for (const aid of TEST_AIDS) {
    if (flags[aid] !== undefined) {
      throw new Error(`--${aid} is a test aid (a buy from our own wallet that moves the price); it is not available on mainnet; nothing was sent.`);
    }
  }
  if (typeof flags.keypair !== "string") {
    throw new Error("--keypair <file> is required on mainnet (there is no default wallet); nothing was sent.");
  }
  if (amountLamports !== undefined && amountLamports > MAINNET_MAX_ORDER_LAMPORTS) {
    throw new Error("this script sends at most 0.01 SOL per order on mainnet; nothing was sent.");
  }
}

/**
 * Whether this run may open an order. On mainnet that takes the bare flag
 * `--yes-real-sol`; without it the script prints the plan and stops.
 */
export function mayOpenOrder(network: Network, flags: Flags): boolean {
  if (flags["dry-run"] !== undefined) return false;
  if (network === "mainnet") return flags["yes-real-sol"] === true;
  return true;
}

/**
 * The allowances (basis points below the simulation) the sell of a test round
 * trip is tried with. On a token that moves, a sell with 1% often fails; each
 * new try simulates again and doubles the allowance, never above `maxBps`.
 */
export function sellSlippageSteps(firstBps: bigint, tries = 3, maxBps = 1_000n): bigint[] {
  const steps: bigint[] = [];
  let bps = firstBps;
  for (let i = 0; i < tries; i++) {
    steps.push(bps > maxBps ? maxBps : bps);
    bps *= 2n;
  }
  return steps;
}

const clusterQuery = (network: Network) => (network === "mainnet" ? "" : `?cluster=${network}`);

export function explorerTx(network: Network, signature: string): string {
  if (network === "local fork") return `(local fork; not on any explorer) ${signature}`;
  return `https://explorer.solana.com/tx/${signature}${clusterQuery(network)}`;
}

export function explorerAddress(network: Network, address: string): string {
  if (network === "local fork") return `(local fork; not on any explorer) ${address}`;
  return `https://explorer.solana.com/address/${address}${clusterQuery(network)}`;
}
