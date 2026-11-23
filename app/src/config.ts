// Public devnet endpoint; no RPC keys or secrets belong in the app.
export const CLUSTER = "devnet" as const;
export const RPC_ENDPOINT = "https://api.devnet.solana.com";
export const CHAIN_IDENTIFIER = `solana:${CLUSTER}` as const;

export const APP_IDENTITY = {
  name: "Rung",
};
