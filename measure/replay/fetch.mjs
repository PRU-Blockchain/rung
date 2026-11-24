// Step 1: fetch the bonding-curve history of each token from the public RPC (read-only, cached).
//
//   node fetch.mjs [mint ...]          (default: every mint in tokens.json)
//   WINDOW_SEC=1200 node fetch.mjs     (seconds after creation to fetch; default 1200 = 20 min,
//                                       10 min of buys + 10 min of later prices for part E)
//
// For each mint: page getSignaturesForAddress(bonding curve PDA) back to the curve's first
// transaction, then getTransaction for every successful signature in [creation, creation + WINDOW_SEC].
// Writes cache/sigs/<mint>.json (the signature list in the window) and appends progress to cache/fetch.log.
import fs from 'node:fs';
import path from 'node:path';
import { rpc, stats, CACHE_DIR, REPLAY_DIR } from './lib/rpc.mjs';
import { bondingCurvePda } from './lib/solana.mjs';

const WINDOW_SEC = Number(process.env.WINDOW_SEC || 1200);
const MAX_PAGES = Number(process.env.MAX_PAGES || 3000);
const LOG = path.join(CACHE_DIR, 'fetch.log');
fs.mkdirSync(path.join(CACHE_DIR, 'sigs'), { recursive: true });
const log = (...a) => {
  const line = `${new Date().toISOString()} ${a.join(' ')}`;
  console.log(line);
  fs.appendFileSync(LOG, line + '\n');
};

const TX_OPTS = { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'confirmed' };

async function allSignatures(curve) {
  const out = [];
  let before;
  for (let p = 0; p < MAX_PAGES; p++) {
    const opts = { limit: 1000, commitment: 'confirmed' };
    if (before) opts.before = before;
    const page = await rpc('getSignaturesForAddress', [curve, opts]);
    if (!page) return { out, complete: false, why: 'getSignaturesForAddress returned null' };
    out.push(...page);
    if (p % 20 === 0) log('  page', p, 'sigs', out.length, 'oldest slot', page.at(-1)?.slot, 'time', page.at(-1)?.blockTime ? new Date(page.at(-1).blockTime * 1000).toISOString() : '-');
    if (page.length < 1000) return { out, complete: true };
    before = page.at(-1).signature;
  }
  return { out, complete: false, why: `stopped after ${MAX_PAGES} pages` };
}

async function fetchMint(mint) {
  const curve = bondingCurvePda(mint);
  const sigFile = path.join(CACHE_DIR, 'sigs', `${mint}.json`);
  let rec;
  if (fs.existsSync(sigFile)) rec = JSON.parse(fs.readFileSync(sigFile, 'utf8'));
  if (!rec || !rec.complete) {
    log('mint', mint, 'curve', curve, 'paging signatures');
    const { out, complete, why } = await allSignatures(curve);
    if (!complete) {
      log('mint', mint, 'INCOMPLETE history:', why);
      rec = { mint, curve, complete: false, why, totalSigs: out.length };
      fs.writeFileSync(sigFile, JSON.stringify(rec));
      return rec;
    }
    // Oldest first. getSignaturesForAddress returns newest first.
    out.reverse();
    const t0 = out[0].blockTime;
    const win = out.filter((s) => s.blockTime != null && s.blockTime <= t0 + WINDOW_SEC);
    rec = {
      mint, curve, complete: true, totalSigs: out.length, windowSec: WINDOW_SEC,
      firstSig: out[0].signature, firstSlot: out[0].slot, t0,
      sigs: win.map((s) => ({ sig: s.signature, slot: s.slot, t: s.blockTime, ok: s.err ? 0 : 1 })),
    };
    fs.writeFileSync(sigFile, JSON.stringify(rec));
    log('mint', mint, 'total sigs', out.length, 'first slot', rec.firstSlot, 'created', new Date(t0 * 1000).toISOString(), 'in window', win.length, 'failed in window', win.filter((s) => s.err).length);
  }
  const want = rec.sigs.filter((s) => s.ok);
  let n = 0, missing = 0;
  for (const s of want) {
    const t = await rpc('getTransaction', [s.sig, TX_OPTS]);
    if (!t) missing++;
    if (++n % 200 === 0) log('  ', mint.slice(0, 8), 'tx', n, '/', want.length, 'missing', missing, 'reqs', stats.requests, '429s', stats.http429);
  }
  log('mint', mint, 'done; tx fetched', n, 'missing', missing);
  return rec;
}

const tokens = JSON.parse(fs.readFileSync(path.join(REPLAY_DIR, 'tokens.json'), 'utf8'));
const mints = process.argv.slice(2).length ? process.argv.slice(2) : tokens.map((t) => t.mint);
for (const m of mints) {
  try { await fetchMint(m); } catch (e) { log('mint', m, 'FAILED', e.message); }
}
log('all done', JSON.stringify(stats));
