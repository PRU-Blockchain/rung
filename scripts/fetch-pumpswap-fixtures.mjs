#!/usr/bin/env node
// Downloads what `programs/rung/tests/real_pumpswap.rs` needs to run Rung against
// the REAL PumpSwap (pump.fun AMM) program inside LiteSVM:
//   - PumpSwap's executable (`solana program dump`), and
//   - the accounts of one live, canonical, SOL-paired pool that is neither a
//     mayhem nor a cashback pool, taken from a recent successful
//     `buy_exact_quote_in_v2` on mainnet, plus global_config, fee_config, the
//     buyback recipient's WSOL account, the WSOL mint and the Rent sysvar.
//
// It also proves the canonical-pool derivation on mainnet: for the picked mint
// it derives `pool_authority = PDA(["pool-authority", mint], pump)` and
// `pool = PDA(["pool", 0u16 LE, pool_authority, mint, WSOL], PumpSwap)` and
// checks, with getAccountInfo, that this address is the pool the trade used,
// that PumpSwap owns it and that its `creator` field is `pool_authority`.
//
// Read only: public RPC read methods and `solana program dump`. It never sends
// a transaction and never reads a key file.
//
// Needs `@solana/web3.js` from `client/node_modules` (run `npm ci` in client/).
// Usage:  node scripts/fetch-pumpswap-fixtures.mjs   (from the repository root)
// Env:    RPC_URL (default https://api.mainnet-beta.solana.com)
//         SIG_LIMIT (signatures scanned per page, default 40)
// Output: programs/rung/tests/fixtures/pumpswap/{pump_amm.so,accounts.json,SOURCE.md}
//         (git-ignored; re-run this script to re-create it)

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RPC = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const SIG_LIMIT = Number(process.env.SIG_LIMIT || 40);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "programs/rung/tests/fixtures/pumpswap");
const { PublicKey } = createRequire(join(ROOT, "client/package.json"))("@solana/web3.js");

const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUMP_SWAP = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const WSOL = "So11111111111111111111111111111111111111112";
const RENT = "SysvarRent111111111111111111111111111111111";
// idl/pump_amm.json: buy_exact_quote_in_v2 discriminator.
const BUY_EXACT_QUOTE_IN_V2 = [194, 171, 28, 70, 104, 77, 91, 47];
const POOL_DISC = [241, 154, 109, 4, 17, 177, 109, 188];
// PUMP_SWAP_TRADE_V2.md, "Accounts" (0-based here).
const NAMES = [
  "pool", "user", "global_config", "base_mint", "quote_mint",
  "user_base_token_account", "user_quote_token_account", "pool_base_token_account",
  "pool_quote_token_account", "base_token_program", "quote_token_program", "system_program",
  "user_volume_accumulator", "fee_config", "buyback_fee_recipient", "event_authority", "program",
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

const pk = (s) => new PublicKey(s);
const poolAuthority = (mint) =>
  PublicKey.findProgramAddressSync([Buffer.from("pool-authority"), pk(mint).toBuffer()], pk(PUMP))[0].toBase58();
const canonicalPool = (mint) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), Buffer.from([0, 0]), pk(poolAuthority(mint)).toBuffer(), pk(mint).toBuffer(), pk(WSOL).toBuffer()],
    pk(PUMP_SWAP),
  )[0].toBase58();

// Pool (idl/pump_amm.json): disc 8, pool_bump u8 @8, index u16 @9, creator @11,
// base_mint @43, quote_mint @75, lp_mint @107, pool_base_token_account @139,
// pool_quote_token_account @171, lp_supply u64 @203, coin_creator @211,
// is_mayhem_mode @243, is_cashback_coin @244, virtual_quote_reserves i128 @245,
// creator_fee_bps u64 @261, can_edit_creator_fee @269, is_holder_reward @270,
// protocol_fees u64 @271, creator_fees u64 @279. Shorter (older) pools: missing
// trailing fields read as 0 / false.
function parsePool(b64) {
  const d = Buffer.from(b64, "base64");
  const key = (o) => new PublicKey(d.subarray(o, o + 32)).toBase58();
  const byte = (o) => (d.length > o ? d[o] : 0);
  const u64 = (o) => (d.length >= o + 8 ? d.readBigUInt64LE(o).toString() : "0");
  let vqr = 0n;
  if (d.length >= 261) vqr = d.readBigUInt64LE(245) + (d.readBigInt64LE(253) << 64n);
  return {
    len: d.length,
    discriminator_ok: POOL_DISC.every((b, i) => d[i] === b),
    pool_bump: d[8],
    index: d.readUInt16LE(9),
    creator: key(11),
    base_mint: key(43),
    quote_mint: key(75),
    lp_mint: key(107),
    pool_base_token_account: key(139),
    pool_quote_token_account: key(171),
    coin_creator: key(211),
    is_mayhem_mode: byte(243) !== 0,
    is_cashback_coin: byte(244) !== 0,
    virtual_quote_reserves: vqr.toString(),
    creator_fee_bps: u64(261),
    is_holder_reward: byte(270) !== 0,
    protocol_fees: u64(271),
    creator_fees: u64(279),
  };
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
    if (keys[ix.programIdIndex] !== PUMP_SWAP || ix.accounts.length !== 17) continue;
    const data = b58decode(ix.data);
    if (BUY_EXACT_QUOTE_IN_V2.every((b, i) => data[i] === b)) {
      found.push({ accounts: ix.accounts.map((i) => keys[i]), data: Buffer.from(data).toString("hex") });
    }
  }
  return found;
}

async function pickTransaction(seen) {
  let before;
  for (let page = 0; page < 8; page++) {
    const sigs = await rpc("getSignaturesForAddress", [PUMP_SWAP, { limit: SIG_LIMIT, before }]);
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
        const poolAddr = buy.accounts[0];
        const [acc] = (await rpc("getMultipleAccounts", [[poolAddr], { encoding: "base64" }])).value;
        if (!acc) continue;
        const pool = parsePool(acc.data[0]);
        const canonical = pool.creator === poolAuthority(pool.base_mint) && poolAddr === canonicalPool(pool.base_mint);
        seen.push({
          signature: s.signature, pool: poolAddr, owner: acc.owner, canonical, quote_mint: pool.quote_mint,
          is_mayhem_mode: pool.is_mayhem_mode, is_cashback_coin: pool.is_cashback_coin,
        });
        const ok = acc.owner === PUMP_SWAP && pool.discriminator_ok && canonical && pool.quote_mint === WSOL &&
          pool.base_mint === buy.accounts[3] && !pool.is_mayhem_mode && !pool.is_cashback_coin;
        console.error(`${s.signature.slice(0, 12)}… pool=${poolAddr.slice(0, 8)} canonical=${canonical} quote=${pool.quote_mint.slice(0, 4)} mayhem=${pool.is_mayhem_mode} cashback=${pool.is_cashback_coin} ok=${ok}`);
        if (ok) return { signature: s.signature, slot: tx.slot, blockTime: tx.blockTime, ...buy, pool, poolOwner: acc.owner };
      }
    }
  }
  throw new Error("no suitable buy_exact_quote_in_v2 on a canonical SOL pool found");
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  console.error("dumping PumpSwap program…");
  execFileSync("solana", ["program", "dump", "-u", RPC, PUMP_SWAP, join(OUT, "pump_amm.so")], { stdio: "inherit" });

  const seen = [];
  const pick = await pickTransaction(seen);
  const mint = pick.accounts[3];
  const proof = {
    mint,
    pool_authority_seeds: '["pool-authority", mint] under pump 6EF8rr…F6P',
    pool_authority: poolAuthority(mint),
    pool_seeds: '["pool", [0,0] (index 0 as u16 LE), pool_authority, mint, WSOL] under PumpSwap pAMMBa…XEA',
    derived_pool: canonicalPool(mint),
    pool_in_trade: pick.accounts[0],
    onchain_owner: pick.poolOwner,
    onchain_creator: pick.pool.creator,
    onchain_index: pick.pool.index,
  };
  proof.matches = proof.derived_pool === proof.pool_in_trade && proof.onchain_creator === proof.pool_authority &&
    proof.onchain_owner === PUMP_SWAP && proof.onchain_index === 0;
  console.error(`picked ${pick.signature} mint ${mint}; canonical proof ${JSON.stringify(proof)}`);

  const extra = { rent_sysvar: RENT, pool_authority: proof.pool_authority };
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
  const poolNow = parsePool(accounts.find((a) => a.address === pick.accounts[0]).data);

  const out = {
    rpc: RPC,
    fetched_at: new Date().toISOString(),
    get_slot: slot,
    accounts_slot: res.context.slot,
    block_time: blockTime,
    source: {
      signature: pick.signature, slot: pick.slot, block_time: pick.blockTime,
      instruction: "buy_exact_quote_in_v2", instruction_data_hex: pick.data, mint,
      base_token_program: pick.accounts[9], pool_at_pick: pick.pool,
    },
    canonical_pool_proof: proof,
    pool_at_snapshot: poolNow,
    buy_accounts: pick.accounts.map((address, i) => ({ index: i, name: NAMES[i], address })),
    v2_buys_seen: seen,
    accounts,
  };
  writeFileSync(join(OUT, "accounts.json"), JSON.stringify(out, null, 2));

  const missing = accounts.filter((a) => !a.exists).map((a) => `${a.roles.join("/")} ${a.address}`);
  const flagged = seen.filter((x) => x.is_mayhem_mode || x.is_cashback_coin);
  writeFileSync(
    join(OUT, "SOURCE.md"),
    [
      "# PumpSwap fixture source (generated by scripts/fetch-pumpswap-fixtures.mjs)",
      "",
      `- RPC: ${RPC}`,
      `- fetched: ${out.fetched_at}`,
      `- source transaction: ${pick.signature}`,
      `- source slot: ${pick.slot}, block time: ${pick.blockTime}`,
      "- instruction: buy_exact_quote_in_v2 (17 accounts)",
      `- mint: ${mint}`,
      `- base token program: ${pick.accounts[9]}`,
      `- pool: ${pick.accounts[0]} (len ${poolNow.len}, virtual_quote_reserves ${poolNow.virtual_quote_reserves})`,
      `- canonical proof: pool_authority ${proof.pool_authority}; derived pool ${proof.derived_pool}; on-chain owner ${proof.onchain_owner}, creator ${proof.onchain_creator}, index ${proof.onchain_index}; matches: ${proof.matches}`,
      `- accounts snapshot slot: ${res.context.slot}, block time: ${blockTime}, getSlot: ${slot}`,
      `- pump_amm.so: ${statSync(join(OUT, "pump_amm.so")).size} bytes`,
      `- v2 buys scanned: ${seen.length}; on mayhem or cashback pools: ${flagged.length ? flagged.map((x) => `${x.signature} mayhem=${x.is_mayhem_mode} cashback=${x.is_cashback_coin}`).join("; ") : "none"}`,
      `- missing accounts: ${missing.length ? missing.join("; ") : "none"}`,
      "",
    ].join("\n"),
  );
  console.error(`wrote ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
