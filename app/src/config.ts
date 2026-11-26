import { networkConfig } from "./network";

// The network is fixed when the app is built: EXPO_PUBLIC_CLUSTER=mainnet-beta
// for mainnet, nothing (or devnet) for devnet. Public endpoints only; no RPC
// keys or secrets belong in the app. Expo inlines these two variables.
// The casts only add the two names to the type; the code Expo sees is still
// `process.env.EXPO_PUBLIC_...`, which is what it inlines.
type PublicEnv = { EXPO_PUBLIC_CLUSTER?: string; EXPO_PUBLIC_RPC_URL?: string };
export const NETWORK = networkConfig(
  (process.env as PublicEnv).EXPO_PUBLIC_CLUSTER,
  (process.env as PublicEnv).EXPO_PUBLIC_RPC_URL,
);
export const CLUSTER = NETWORK.cluster;
export const RPC_ENDPOINT = NETWORK.rpcEndpoint;
export const CHAIN_IDENTIFIER = NETWORK.chain;

// MWA identity. Phantom declines signing without an HTTPS `uri`
// ("identityUri is not defined ... sign request declined", -3). `icon` is
// relative to `uri`.
export const APP_IDENTITY = {
  name: "Rung",
  uri: "https://rungbot.xyz",
  icon: "favicon.ico",
};
