// Public devnet endpoint; no RPC keys or secrets belong in the app.
export const CLUSTER = "devnet" as const;
export const RPC_ENDPOINT = "https://api.devnet.solana.com";
export const CHAIN_IDENTIFIER = `solana:${CLUSTER}` as const;

// MWA identity. Phantom declines signing without an HTTPS `uri`
// ("identityUri is not defined ... sign request declined", -3). `icon` is
// relative to `uri`.
export const APP_IDENTITY = {
  name: "Rung",
  uri: "https://rung-drab.vercel.app",
  icon: "favicon.ico",
};
