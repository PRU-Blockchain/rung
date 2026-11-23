#!/usr/bin/env node
// Downloads what `programs/rung/tests/real_pump.rs` needs to run Rung against
// the REAL pump.fun bonding-curve program inside LiteSVM:
//   - pump's executable (`solana program dump`), and
//   - the accounts of one live SOL-paired curve, taken from a recent successful
//     `buy_exact_quote_in_v3` / `buy_v3` on mainnet.
//
// Read only: it calls public RPC read methods and `solana program dump`. It never
// sends a transaction and never reads a key file.
//
// Usage:  node scripts/fetch-pump-fixtures.mjs   (from the repository root)
// Env:    RPC_URL (default https://api.mainnet-beta.solana.com)
//         SIG_LIMIT (signatures scanned per page, default 40)
// Output: programs/rung/tests/fixtures/pump/{pump.so,accounts.json,SOURCE.md}
//         (git-ignored; re-run this script to re-create it)

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RPC = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const SIG_LIMIT = Number(process.env.SIG_LIMIT || 40);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "programs/rung/tests/fixtures/pump");

const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUMP_FEES = "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const GLOBAL = "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf";
const FEE_CONFIG = "8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt";
const DISC = {
  buy_exact_quote_in_v3: [225, 247, 80, 30, 213, 179, 132, 136],
  buy_v3: [7, 5, 29, 196, 245, 23, 101, 80],
};
const NAMES = [
  "global", "base_mint", "quote_mint", "base_token_program", "quote_token_program",
  "bonding_curve", "associated_base_bonding_curve", "associated_quote_bonding_curve",
  "user", "associated_base_user", "associated_quote_user", "user_volume_accumulator",
  "fee_config", "buyback_fee_recipient", "system_program", "event_authority", "program",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(method, params) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (res.status === 429 || res.status >= 500) {
      const wait = 2000 * (attempt + 1);
      console.error(`${method}: HTTP ${res.status}, retrying in ${wait} ms`);
      await sleep(wait);
      continue;
    }
    const body = await res.json();
    if (body.error) {
      if (body.error.code === 429 || /rate/i.test(body.error.message)) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      throw new Error(`${method}: ${JSON.stringify(body.error)}`);
    }
    return body.result;
  }
  throw new Error(`${method}: gave up after retries`);
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58decode(s) {
  const bytes = [0];
  for (const c of s) {
    let carry = B58.indexOf(c);
    if (carry < 0) throw new Error("bad base58");
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const c of s) { if (c === "1") bytes.push(0); else break; }
  return Uint8Array.from(bytes.reverse());
}

const startsWith = (data, disc) => disc.every((b, i) => data[i] === b);
const u64 = (buf, o) => buf.readBigUInt64LE(o);

// BondingCurve: disc(8) vt vq rt rq supply (u64 x5) complete(1) creator(32)
// is_mayhem_mode(1) is_cashback_coin(1) quote_mint(32) ...
function parseCurve(b64) {
  const d = Buffer.from(b64, "base64");
  const q = d.length >= 115 ? d.subarray(83, 115) : Buffer.alloc(32);
  return {
    len: d.length,
    virtual_token_reserves: u64(d, 8).toString(),
    virtual_quote_reserves: u64(d, 16).toString(),
    real_token_reserves: u64(d, 24).toString(),
    real_quote_reserves: u64(d, 32).toString(),
    complete: d[48] !== 0,
    is_mayhem_mode: d.length > 81 ? d[81] !== 0 : false,
    is_cashback_coin: d.length > 82 ? d[82] !== 0 : false,
    quote_mint_is_default: q.every((b) => b === 0),
  };
}

function findBuys(tx) {
  const msg = tx.transaction.message;
  const keys = [
    ...msg.accountKeys,
    ...(tx.meta.loadedAddresses?.writable || []),
    ...(tx.meta.loadedAddresses?.readonly || []),
  ];
  const all = [...msg.instructions];
  for (const inner of tx.meta.innerInstructions || []) all.push(...inner.instructions);
  const found = [];
  for (const ix of all) {
    if (keys[ix.programIdIndex] !== PUMP || ix.accounts.length !== 17) continue;
    const data = b58decode(ix.data);
    for (const [name, disc] of Object.entries(DISC)) {
      if (startsWith(data, disc)) found.push({ name, accounts: ix.accounts.map((i) => keys[i]) });
    }
  }
  return found;
}

async function pickTransaction() {
  let before;
  let fallback = null;
  for (let page = 0; page < 6; page++) {
    const sigs = await rpc("getSignaturesForAddress", [PUMP, { limit: SIG_LIMIT, before }]);
    if (!sigs.length) break;
    before = sigs[sigs.length - 1].signature;
    for (const s of sigs) {
      if (s.err) continue;
      await sleep(400);
      const tx = await rpc("getTransaction", [
        s.signature,
        { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "confirmed" },
      ]);
      if (!tx || tx.meta.err) continue;
      for (const buy of findBuys(tx)) {
        const curveAddr = buy.accounts[5];
        const [curveAcc] = (await rpc("getMultipleAccounts", [[curveAddr], { encoding: "base64" }])).value;
        if (!curveAcc) continue;
        const curve = parseCurve(curveAcc.data[0]);
        const ok = !curve.complete && !curve.is_mayhem_mode && !curve.is_cashback_coin && curve.quote_mint_is_default;
        console.error(`${s.signature.slice(0, 12)}… ${buy.name} mint=${buy.accounts[1]} tp=${buy.accounts[3].slice(0, 6)} ok=${ok}`);
        if (!ok) continue;
        const pick = { signature: s.signature, slot: tx.slot, blockTime: tx.blockTime, ...buy, curve };
        if (buy.accounts[3] === TOKEN_2022) return pick;
        fallback ??= pick;
      }
    }
    if (fallback) return fallback;
  }
  if (fallback) return fallback;
  throw new Error("no suitable buy_exact_quote_in_v3 / buy_v3 found");
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  console.error("dumping pump program…");
  execFileSync("solana", ["program", "dump", "-u", RPC, PUMP, join(OUT, "pump.so")], { stdio: "inherit" });
  await sleep(1000);
  console.error("dumping Pump Fees program…");
  execFileSync("solana", ["program", "dump", "-u", RPC, PUMP_FEES, join(OUT, "pump_fees.so")], { stdio: "inherit" });

  const pick = await pickTransaction();
  console.error(`picked ${pick.signature} (${pick.name}) mint ${pick.accounts[1]}`);

  // The Rent sysvar too: mainnet's rent rate is not LiteSVM's default.
  const extra = { global: GLOBAL, fee_config: FEE_CONFIG, rent_sysvar: "SysvarRent111111111111111111111111111111111" };
  const list = [];
  pick.accounts.forEach((address, i) => list.push({ role: NAMES[i], address }));
  for (const [role, address] of Object.entries(extra)) list.push({ role: `extra_${role}`, address });
  const unique = [...new Set(list.map((x) => x.address))];

  const slot = await rpc("getSlot", [{ commitment: "confirmed" }]);
  const res = await rpc("getMultipleAccounts", [unique, { encoding: "base64", commitment: "confirmed" }]);
  let blockTime = null;
  try { blockTime = await rpc("getBlockTime", [res.context.slot]); } catch (e) { console.error(`getBlockTime: ${e.message}`); }

  const accounts = unique.map((address, i) => {
    const a = res.value[i];
    const roles = list.filter((x) => x.address === address).map((x) => x.role);
    if (!a) return { address, roles, exists: false };
    return {
      address, roles, exists: true, owner: a.owner, lamports: a.lamports,
      data: a.data[0], executable: a.executable, rent_epoch: String(a.rentEpoch),
    };
  });

  const out = {
    rpc: RPC,
    fetched_at: new Date().toISOString(),
    get_slot: slot,
    accounts_slot: res.context.slot,
    block_time: blockTime,
    source: {
      signature: pick.signature, slot: pick.slot, block_time: pick.blockTime,
      instruction: pick.name, mint: pick.accounts[1], base_token_program: pick.accounts[3],
      curve_at_fetch: pick.curve,
    },
    buy_accounts: pick.accounts.map((address, i) => ({ index: i, name: NAMES[i], address })),
    accounts,
  };
  writeFileSync(join(OUT, "accounts.json"), JSON.stringify(out, null, 2));

  const missing = accounts.filter((a) => !a.exists).map((a) => `${a.roles.join("/")} ${a.address}`);
  writeFileSync(
    join(OUT, "SOURCE.md"),
    [
      "# pump fixture source (generated by scripts/fetch-pump-fixtures.mjs)",
      "",
      `- RPC: ${RPC}`,
      `- fetched: ${out.fetched_at}`,
      `- source transaction: ${pick.signature}`,
      `- source slot: ${pick.slot}, block time: ${pick.blockTime}`,
      `- instruction: ${pick.name} (17 accounts)`,
      `- mint: ${pick.accounts[1]}`,
      `- base token program: ${pick.accounts[3]}${pick.accounts[3] === TOKEN_2022 ? " (Token-2022)" : " (SPL Token)"}`,
      `- accounts snapshot slot: ${res.context.slot}, block time: ${blockTime}, getSlot: ${slot}`,
      `- pump.so: ${statSync(join(OUT, "pump.so")).size} bytes; pump_fees.so: ${statSync(join(OUT, "pump_fees.so")).size} bytes`,
      `- missing accounts: ${missing.length ? missing.join("; ") : "none"}`,
      "",
    ].join("\n"),
  );
  console.error(`wrote ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
