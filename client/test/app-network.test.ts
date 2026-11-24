// Which network the Android app talks to. The choice is made at build time
// (EXPO_PUBLIC_CLUSTER) by a pure function in app/src/network.ts, tested here
// because the app itself has no test runner.
import assert from "node:assert/strict";
import { test } from "node:test";

import { explorerTxUrl, networkConfig } from "../../app/src/network";

test("without a setting the app is on devnet: real SOL only when asked for", () => {
  for (const value of [undefined, "", "devnet"]) {
    const n = networkConfig(value);
    assert.equal(n.cluster, "devnet");
    assert.equal(n.label, "devnet");
    assert.equal(n.rpcEndpoint, "https://api.devnet.solana.com");
    assert.equal(n.chain, "solana:devnet");
  }
});

test("mainnet is chosen by name, and the wallet is asked for the mainnet chain", () => {
  for (const value of ["mainnet-beta", "mainnet"]) {
    const n = networkConfig(value);
    assert.equal(n.cluster, "mainnet-beta");
    assert.equal(n.label, "mainnet");
    assert.equal(n.rpcEndpoint, "https://api.mainnet-beta.solana.com");
    // Mobile Wallet Adapter's chain identifiers are solana:mainnet, solana:devnet and solana:testnet.
    assert.equal(n.chain, "solana:mainnet");
  }
});

test("any other value stops the app instead of guessing a network", () => {
  for (const value of ["testnet", "Mainnet", "main", "prod", " devnet"]) {
    assert.throws(() => networkConfig(value), /EXPO_PUBLIC_CLUSTER must be devnet or mainnet-beta/);
  }
});

test("another RPC can be set, but never one that carries a key", () => {
  assert.equal(networkConfig("mainnet-beta", "https://rpc.example.com").rpcEndpoint, "https://rpc.example.com");
  assert.equal(networkConfig("devnet", "https://rpc.example.com/").rpcEndpoint, "https://rpc.example.com/");
  // Everything in the app bundle can be read by anyone who has the APK.
  for (const url of [
    "https://rpc.example.com/?api-key=SECRET-VALUE",
    "https://rpc.example.com/v2/0123456789abcdef0123456789abcdef",
    "https://user:SECRET-VALUE@rpc.example.com",
    "http://rpc.example.com",
    "not a url",
  ]) {
    assert.throws(() => networkConfig("mainnet-beta", url), /EXPO_PUBLIC_RPC_URL/);
    try {
      networkConfig("mainnet-beta", url);
    } catch (e) {
      assert.ok(!(e as Error).message.includes("SECRET-VALUE"));
    }
  }
  // An empty setting means "not set".
  assert.equal(networkConfig("mainnet-beta", "").rpcEndpoint, "https://api.mainnet-beta.solana.com");
});

test("explorer links carry the network", () => {
  assert.equal(explorerTxUrl(networkConfig("devnet"), "SIG"), "https://explorer.solana.com/tx/SIG?cluster=devnet");
  assert.equal(explorerTxUrl(networkConfig("mainnet-beta"), "SIG"), "https://explorer.solana.com/tx/SIG");
});
