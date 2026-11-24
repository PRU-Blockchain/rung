// How large did each token become? Reads the token's canonical PumpSwap pool now (read-only) and
// computes its market cap in SOL from the pool reserves: (quote balance + virtual quote) / base balance * supply.
// The first answer is cached (cache/rpc/...), so reruns report the same snapshot; cache/size.json records when.
//
//   node size.mjs
import fs from 'node:fs';
import path from 'node:path';
import { rpc, CACHE_DIR, REPLAY_DIR } from './lib/rpc.mjs';
import { canonicalPoolPda, b58 } from './lib/solana.mjs';

const tokens = JSON.parse(fs.readFileSync(path.join(REPLAY_DIR, 'tokens.json'), 'utf8'));
const outFile = path.join(CACHE_DIR, 'size.json');
const prev = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
const out = {};
for (const t of tokens) {
  const pool = canonicalPoolPda(t.mint);
  const r = { pool, snapshotAt: prev[t.mint]?.snapshotAt || new Date().toISOString() };
  try {
    const acc = await rpc('getAccountInfo', [pool, { encoding: 'base64', commitment: 'confirmed' }]);
    if (!acc?.value) { r.error = 'canonical PumpSwap pool not found'; out[t.mint] = r; continue; }
    const d = Buffer.from(acc.value.data[0], 'base64');
    const baseTa = b58.encode(d.subarray(139, 171));
    const quoteTa = b58.encode(d.subarray(171, 203));
    let vq = 0n;
    if (d.length >= 261) { const lo = d.readBigUInt64LE(245); const hi = d.readBigInt64LE(253); vq = (hi << 64n) + lo; }
    const m = await rpc('getMultipleAccounts', [[baseTa, quoteTa], { encoding: 'base64', commitment: 'confirmed' }]);
    const bal = (v) => Buffer.from(v.data[0], 'base64').readBigUInt64LE(64);
    const base = bal(m.value[0]);
    const quote = bal(m.value[1]);
    const sup = await rpc('getTokenSupply', [t.mint, { commitment: 'confirmed' }]);
    const supply = BigInt(sup.value.amount);
    r.baseTokens = Number(base) / 10 ** sup.value.decimals;
    r.quoteSol = Number(quote) / 1e9;
    r.virtualQuoteSol = Number(vq) / 1e9;
    r.supply = Number(supply) / 10 ** sup.value.decimals;
    r.mcapSol = Number(((quote + vq) * supply) / base) / 1e9;
    r.slot = acc.context?.slot;
  } catch (e) { r.error = e.message; }
  out[t.mint] = r;
  console.log(t.mint, JSON.stringify(r));
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
