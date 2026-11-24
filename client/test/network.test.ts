// The script's network guard: which network an RPC is, and what the script
// refuses to do when the SOL is real.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEVNET_GENESIS_HASH,
  MAINNET_GENESIS_HASH,
  MAINNET_MAX_ORDER_LAMPORTS,
  checkMainnetRun,
  chooseNetwork,
  explorerAddress,
  explorerTx,
  hideRpc,
  mayOpenOrder,
  rpcHost,
} from "../../scripts/network";

const DEVNET_RPC = "https://api.devnet.solana.com";
const MAINNET_RPC = "https://mainnet.example-rpc.com/?api-key=SECRET-VALUE";
const LOCAL_RPC = "http://127.0.0.1:8899";

const choose = (over: Partial<Parameters<typeof chooseNetwork>[0]>) =>
  chooseNetwork({ genesisHash: DEVNET_GENESIS_HASH, rpc: DEVNET_RPC, localFork: false, mainnet: false, ...over });

test("a devnet RPC without flags is devnet", () => {
  assert.equal(choose({}), "devnet");
});

test("a mainnet RPC without --mainnet is refused", () => {
  assert.throws(() => choose({ genesisHash: MAINNET_GENESIS_HASH, rpc: MAINNET_RPC }), /MAINNET.*--mainnet.*nothing was sent/s);
});

test("a mainnet RPC with --mainnet is mainnet", () => {
  assert.equal(choose({ genesisHash: MAINNET_GENESIS_HASH, rpc: MAINNET_RPC, mainnet: true }), "mainnet");
});

test("--mainnet on a devnet RPC is refused", () => {
  assert.throws(() => choose({ mainnet: true }), /--mainnet.*devnet.*nothing was sent/s);
});

test("an unknown network is refused, with or without --mainnet", () => {
  const genesisHash = "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY"; // testnet
  assert.throws(() => choose({ genesisHash }), /neither devnet nor mainnet.*nothing was sent/s);
  assert.throws(() => choose({ genesisHash, mainnet: true }), /neither devnet nor mainnet.*nothing was sent/s);
});

test("--local-fork is accepted only for an RPC on this machine", () => {
  // A fork of mainnet reports mainnet's genesis hash.
  assert.equal(choose({ genesisHash: MAINNET_GENESIS_HASH, rpc: LOCAL_RPC, localFork: true }), "local fork");
  assert.equal(choose({ genesisHash: MAINNET_GENESIS_HASH, rpc: "http://localhost:8899", localFork: true }), "local fork");
  assert.equal(choose({ genesisHash: MAINNET_GENESIS_HASH, rpc: "http://[::1]:8899", localFork: true }), "local fork");
  assert.throws(
    () => choose({ genesisHash: MAINNET_GENESIS_HASH, rpc: MAINNET_RPC, localFork: true }),
    /only an RPC on this machine.*nothing was sent/s,
  );
  assert.throws(() => choose({ rpc: "not a url", localFork: true }), /--local-fork needs --rpc/);
});

test("a host that only starts like this machine is not this machine", () => {
  for (const rpc of ["http://127.0.0.1.example.com:8899", "http://localhost.example.com", "http://example.com/127.0.0.1"]) {
    assert.throws(() => choose({ genesisHash: MAINNET_GENESIS_HASH, rpc, localFork: true }), /only an RPC on this machine/);
  }
});

test("--mainnet and --local-fork together are refused", () => {
  assert.throws(
    () => choose({ genesisHash: MAINNET_GENESIS_HASH, rpc: LOCAL_RPC, localFork: true, mainnet: true }),
    /--mainnet and --local-fork cannot be used together/,
  );
});

test("--mainnet on an RPC on this machine is refused: a fork is not mainnet", () => {
  assert.throws(
    () => choose({ genesisHash: MAINNET_GENESIS_HASH, rpc: LOCAL_RPC, mainnet: true }),
    /on this machine.*--local-fork.*nothing was sent/s,
  );
});

test("a mainnet-fork on this machine without any flag is refused", () => {
  assert.throws(() => choose({ genesisHash: MAINNET_GENESIS_HASH, rpc: LOCAL_RPC }), /nothing was sent/);
});

// --- what the script refuses on mainnet ---------------------------------------------

const OK_FLAGS = { keypair: "~/.config/solana/some-wallet.json", "yes-real-sol": true };

test("on mainnet the wallet file must be named", () => {
  assert.throws(() => checkMainnetRun({ flags: {} }), /--keypair <file> is required on mainnet/);
  assert.throws(() => checkMainnetRun({ flags: { keypair: true } }), /--keypair <file> is required on mainnet/);
  assert.doesNotThrow(() => checkMainnetRun({ flags: { keypair: "w.json" } }));
});

test("on mainnet every test aid is refused", () => {
  for (const aid of ["push-after-open", "push-pct", "push-only", "wait-order"]) {
    assert.throws(
      () => checkMainnetRun({ flags: { ...OK_FLAGS, [aid]: "1" } }),
      new RegExp(`--${aid}.*test aid.*not available on mainnet.*nothing was sent`, "s"),
    );
  }
});

test("on mainnet an order is at most 0.01 SOL", () => {
  assert.equal(MAINNET_MAX_ORDER_LAMPORTS, 10_000_000n);
  assert.doesNotThrow(() => checkMainnetRun({ flags: OK_FLAGS, amountLamports: 10_000_000n }));
  assert.doesNotThrow(() => checkMainnetRun({ flags: OK_FLAGS, amountLamports: 5_000_000n }));
  assert.throws(
    () => checkMainnetRun({ flags: OK_FLAGS, amountLamports: 10_000_001n }),
    /at most 0\.01 SOL per order on mainnet.*nothing was sent/s,
  );
});

test("an order opens on mainnet only with --yes-real-sol", () => {
  assert.equal(mayOpenOrder("mainnet", { keypair: "w.json" }), false);
  assert.equal(mayOpenOrder("mainnet", { keypair: "w.json", "yes-real-sol": true }), true);
  // A value after the flag is not the bare flag: "--yes-real-sol false" must not send.
  assert.equal(mayOpenOrder("mainnet", { keypair: "w.json", "yes-real-sol": "false" }), false);
  assert.equal(mayOpenOrder("devnet", {}), true);
  assert.equal(mayOpenOrder("local fork", {}), true);
});

test("--dry-run never opens an order, on any network", () => {
  for (const network of ["devnet", "mainnet", "local fork"] as const) {
    assert.equal(mayOpenOrder(network, { ...OK_FLAGS, "dry-run": true }), false);
  }
});

// --- what is printed -------------------------------------------------------------------

test("explorer links carry the network", () => {
  assert.equal(explorerTx("devnet", "SIG"), "https://explorer.solana.com/tx/SIG?cluster=devnet");
  assert.equal(explorerTx("mainnet", "SIG"), "https://explorer.solana.com/tx/SIG");
  assert.equal(explorerTx("local fork", "SIG"), "(local fork; not on any explorer) SIG");
  assert.equal(explorerAddress("devnet", "ADDR"), "https://explorer.solana.com/address/ADDR?cluster=devnet");
  assert.equal(explorerAddress("mainnet", "ADDR"), "https://explorer.solana.com/address/ADDR");
});

test("only the host of an RPC URL is ever shown, never its key", () => {
  assert.equal(rpcHost(MAINNET_RPC), "mainnet.example-rpc.com");
  assert.equal(rpcHost("https://rpc.example.com/v2/SECRET-VALUE"), "rpc.example.com");
  assert.equal(rpcHost("https://user:SECRET-VALUE@rpc.example.com/"), "rpc.example.com");
  assert.equal(rpcHost("SECRET-VALUE not a url"), "(unreadable RPC URL)");
  for (const rpc of [MAINNET_RPC, "https://rpc.example.com/v2/SECRET-VALUE", "https://user:SECRET-VALUE@rpc.example.com/", "SECRET-VALUE not a url"]) {
    assert.ok(!rpcHost(rpc).includes("SECRET-VALUE"));
  }
});

test("an error text that quotes the RPC URL or its key is cleaned before printing", () => {
  const withQuery = "https://mainnet.example-rpc.com/?api-key=SECRET-VALUE";
  assert.equal(
    hideRpc(`request to ${withQuery} failed, reason: socket hang up`, withQuery),
    "request to (RPC mainnet.example-rpc.com) failed, reason: socket hang up",
  );
  // The key alone, without the rest of the URL.
  assert.equal(hideRpc("401 Unauthorized: invalid api key SECRET-VALUE", withQuery), "401 Unauthorized: invalid api key (hidden)");
  const withPath = "https://rpc.example.com/v2/SECRET-VALUE-IN-THE-PATH";
  assert.equal(hideRpc("bad key SECRET-VALUE-IN-THE-PATH", withPath), "bad key (hidden)");
  // Short, ordinary pieces of a URL are left alone, and so is a text without any of them.
  assert.equal(hideRpc("version v2 is not supported", withPath), "version v2 is not supported");
  assert.equal(hideRpc("order not found", "https://api.devnet.solana.com"), "order not found");
  assert.equal(hideRpc("anything", "not a url"), "anything");
});

test("no refusal message quotes the RPC URL", () => {
  const cases: Partial<Parameters<typeof chooseNetwork>[0]>[] = [
    { genesisHash: MAINNET_GENESIS_HASH, rpc: MAINNET_RPC },
    { genesisHash: MAINNET_GENESIS_HASH, rpc: MAINNET_RPC, localFork: true },
    { genesisHash: "x", rpc: MAINNET_RPC, mainnet: true },
    { rpc: "https://devnet.example.com/?api-key=SECRET-VALUE", mainnet: true },
  ];
  for (const c of cases) {
    try {
      choose(c);
      assert.fail("expected a refusal");
    } catch (e) {
      assert.ok(!(e as Error).message.includes("SECRET-VALUE"), (e as Error).message);
    }
  }
});
