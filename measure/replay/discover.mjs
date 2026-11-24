// Step 0: for each token find (a) the creation transaction, (b) the migration to PumpSwap (curve completion),
// and (c) how large the token is now. Read-only, cached; cheap (a handful of requests per token).
//
//   node discover.mjs            -> cache/discover.json
//
// (a) oldest signature of the token's Metaplex metadata PDA (touched only at creation and rare updates);
//     fallback: none (the token is then dropped and the reason recorded).
// (b) the canonical PumpSwap pool's LP mint is touched only by create_pool / deposit / withdraw, so its
//     oldest signature is the migration transaction.
// (c) pool reserves x supply now (first answer cached, so reruns report the same snapshot).
import fs from 'node:fs';
import path from 'node:path';
import { rpc, CACHE_DIR, REPLAY_DIR } from './lib/rpc.mjs';
import { canonicalPoolPda, bondingCurvePda, PublicKey, b58 } from './lib/solana.mjs';

const MPL = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
const metadataPda = (mint) => PublicKey.findProgramAddressSync([Buffer.from('metadata'), new PublicKey(MPL).toBuffer(), new PublicKey(mint).toBuffer()], new PublicKey(MPL))[0].toBase58();

async function oldestSig(addr, maxPages = 20) {
  let before, last = null;
  for (let p = 0; p < maxPages; p++) {
    const opts = { limit: 1000, commitment: 'confirmed' };
    if (before) opts.before = before;
    const page = await rpc('getSignaturesForAddress', [addr, opts]);
    if (!page || !page.length) return last ? { ...last, complete: true } : null;
    last = page.at(-1);
    if (page.length < 1000) return { ...last, complete: true };
    before = last.signature;
  }
  return { ...last, complete: false };
}

const tokens = JSON.parse(fs.readFileSync(path.join(REPLAY_DIR, 'tokens.json'), 'utf8'));
const outFile = path.join(CACHE_DIR, 'discover.json');
const prev = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
const out = {};
for (const t of tokens) {
  const r = { mint: t.mint, curve: bondingCurvePda(t.mint), pool: canonicalPoolPda(t.mint), snapshotAt: prev[t.mint]?.snapshotAt || new Date().toISOString() };
  try {
    const c = await oldestSig(metadataPda(t.mint));
    if (c) r.create = { sig: c.signature, slot: c.slot, t: c.blockTime, complete: c.complete };
    else r.createError = 'metadata PDA has no signatures';
    const acc = await rpc('getAccountInfo', [r.pool, { encoding: 'base64', commitment: 'confirmed' }]);
    if (!acc?.value) r.poolError = 'no canonical PumpSwap pool';
    else {
      const d = Buffer.from(acc.value.data[0], 'base64');
      const lpMint = b58.encode(d.subarray(107, 139));
      const baseTa = b58.encode(d.subarray(139, 171));
      const quoteTa = b58.encode(d.subarray(171, 203));
      let vq = 0n;
      if (d.length >= 261) vq = (BigInt(d.readBigInt64LE(253)) << 64n) + d.readBigUInt64LE(245);
      const m = await rpc('getMultipleAccounts', [[baseTa, quoteTa], { encoding: 'base64', commitment: 'confirmed' }]);
      const bal = (v) => Buffer.from(v.data[0], 'base64').readBigUInt64LE(64);
      const base = bal(m.value[0]), quote = bal(m.value[1]);
      const sup = await rpc('getTokenSupply', [t.mint, { commitment: 'confirmed' }]);
      const supply = BigInt(sup.value.amount);
      r.poolSlot = acc.context?.slot;
      r.poolQuoteSol = Number(quote) / 1e9;
      r.poolVirtualQuoteSol = Number(vq) / 1e9;
      r.mcapSolNow = Number(((quote + vq) * supply) / base) / 1e9;
      r.lpMint = lpMint;
      const mg = await oldestSig(lpMint);
      if (mg) r.migration = { sig: mg.signature, slot: mg.slot, t: mg.blockTime, complete: mg.complete };
    }
  } catch (e) { r.error = e.message; }
  out[t.mint] = r;
  console.log(JSON.stringify(r));
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
