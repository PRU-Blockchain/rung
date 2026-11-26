// Today's real state of the project, in one place. Change these lines when
// the state changes (mainnet deploy, APK published, tested on a phone).
// Lines marked `// verbatim` are quoted from the hand-off prompt; keep them
// word for word (scripts/check-verbatim.mjs compares them).

export type Network = "devnet" | "mainnet-beta";

export const STATUS = {
  /** Cluster the counter reads and the explorer links point at. */
  network: "devnet" as Network,
  /** Rung program on that cluster. */
  programId: "Ej2bWTwgPULuni3RVS7Krg1cNYrm5Em5WqfMcUVJUhio",
  /** Public endpoint used when the server-side `RPC_URL` is not set. */
  publicRpc: "https://api.devnet.solana.com",
  /** Short line under the intro. */
  networkLine:
    "The program is deployed on devnet and on mainnet. This page and the app read devnet (test SOL); the first two mainnet buys were made on Nov 24, 2026, through the command-line script.",
  audit: "unaudited, use small amounts", // verbatim
  devices: "Android emulator; not tested on a real device or Seeker", // verbatim
  /** `null` until an APK is published. */
  apkUrl: null as string | null,
  /**
   * `null` until the demo video is published (README: "Demo video: not yet").
   * Once set, the first screen shows "Watch the video" and the page embeds it:
   * a video file (.mp4, .webm) plays in a <video>, anything else in an <iframe>.
   */
  videoUrl: null as string | null,
  repoUrl: "https://github.com/PRU-Blockchain/rung",
  license: "MIT",
} as const;

/** Explorer link for a transaction or an address on the configured cluster. */
export function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}${clusterQuery()}`;
}

export function explorerAddress(address: string): string {
  return `https://explorer.solana.com/address/${address}${clusterQuery()}`;
}

function clusterQuery(): string {
  return STATUS.network === "mainnet-beta" ? "" : `?cluster=${STATUS.network}`;
}
