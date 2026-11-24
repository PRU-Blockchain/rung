// Read-only JSON-RPC helper for the replay study: one public endpoint, polite pacing,
// back-off on HTTP 429 / 5xx, and an on-disk cache so reruns do not refetch.
// Only read methods are ever called (getSignaturesForAddress, getTransaction, getAccountInfo, ...).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const REPLAY_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CACHE_DIR = path.join(REPLAY_DIR, 'cache');
export const RPC_URL = 'https://api.mainnet-beta.solana.com';

const READ_METHODS = new Set(['getSignaturesForAddress', 'getTransaction', 'getAccountInfo', 'getMultipleAccounts', 'getTokenAccountBalance', 'getTokenSupply', 'getSlot', 'getBlockTime', 'getBlock']);
const MIN_GAP_MS = Number(process.env.RPC_GAP_MS || 300); // <= ~3.3 requests/second
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let next = 0;
let gap = MIN_GAP_MS;
export const stats = { requests: 0, cacheHits: 0, http429: 0, errors: 0 };

function cacheFile(method, params) {
  const h = crypto.createHash('sha256').update(method + JSON.stringify(params)).digest('hex');
  const sub = method === 'getTransaction' ? 'tx' : method;
  return path.join(CACHE_DIR, 'rpc', sub, h.slice(0, 2), h + '.json.gz');
}

/** Cached call. `cache: false` skips the cache (used for "what is the chain like now" lookups only). */
export async function rpc(method, params, { cache = true, tries = 12 } = {}) {
  if (!READ_METHODS.has(method)) throw new Error(`refusing non-read method ${method}`);
  const f = cacheFile(method, params);
  if (cache && fs.existsSync(f)) {
    stats.cacheHits++;
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString()).result;
  }
  for (let i = 0; i < tries; i++) {
    const w = next - Date.now();
    if (w > 0) await sleep(w);
    next = Date.now() + gap;
    stats.requests++;
    try {
      const r = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(60000),
      });
      if (r.status === 429 || r.status >= 500) {
        if (r.status === 429) stats.http429++;
        gap = Math.min(gap * 2, 20000);
        next = Date.now() + gap * 2;
        continue;
      }
      const j = await r.json();
      if (j.error) {
        stats.errors++;
        const msg = JSON.stringify(j.error);
        if (/rate|limit|many/i.test(msg)) { gap = Math.min(gap * 2, 20000); next = Date.now() + gap * 2; continue; }
        // Permanent errors (e.g. history not available) are cached too, so reruns see the same answer.
        if (i >= 2) { save(f, { error: j.error, result: null }); return null; }
        await sleep(1000 * (i + 1));
        continue;
      }
      gap = Math.max(gap * 0.9, MIN_GAP_MS);
      if (cache) save(f, { result: j.result });
      return j.result;
    } catch (e) {
      stats.errors++;
      next = Date.now() + 3000 * (i + 1);
    }
  }
  throw new Error(`RPC ${method} failed after ${tries} tries`);
}

function save(f, obj) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, zlib.gzipSync(JSON.stringify(obj)));
  fs.renameSync(tmp, f);
}

export function isCached(method, params) {
  return fs.existsSync(cacheFile(method, params));
}
