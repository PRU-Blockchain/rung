// Today's real state of the project, in one place. Change these lines when
// the state changes (mainnet deploy, APK published, tested on a phone).
// Lines marked `// verbatim` are quoted from the hand-off prompt; keep them
// word for word (scripts/check-verbatim.mjs compares them).

export type Network = "devnet" | "mainnet-beta";

export const STATUS = {
  /** Cluster the counter reads and the explorer links point at. */
  network: "mainnet-beta" as Network,
  /** Rung program on that cluster. */
  programId: "Ej2bWTwgPULuni3RVS7Krg1cNYrm5Em5WqfMcUVJUhio",
  /** Public endpoint used when the server-side `RPC_URL` is not set. */
  publicRpc: "https://api.mainnet-beta.solana.com",
  audit: "unaudited, use small amounts", // verbatim
  // The hand-off's line was "Android emulator; not tested on a real device or Seeker"; since Nov 27, 2026 the
  // app has been used on a real phone, so the line says what is true now.
  devices: "Tried on an Android 16 phone and on the Android emulator",
  /** The published APK (release v0.1.0, Nov 27, 2026: mainnet build, signed with Rung's release key). */
  apkUrl: "https://github.com/PRU-Blockchain/rung/releases/download/v0.1.0/rung-0.1.0-mainnet.apk" as string | null,
  /**
   * `null` until the demo video is published (README: "Demo video: not yet").
   * Once set, the first screen shows "Watch the video" and the page embeds it:
   * a video file (.mp4, .webm) plays in a <video>, anything else in an <iframe>.
   */
  videoUrl: null as string | null,
  repoUrl: "https://github.com/PRU-Blockchain/rung",
  license: "MIT",
  /** Where to reach the team: Buğra's X account (Nov 27; there is no project account yet). */
  contact: { handle: "@yavascan", url: "https://x.com/yavascan" },
  /** The two people who built Rung, as they write their names (Nov 28, 2026). */
  team: "Buğra Yavaşcan and Marwa İpek",
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
