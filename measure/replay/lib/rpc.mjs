// Read-only JSON-RPC helper for the replay study: the public endpoint (or, optionally, a keyed
// one taken from the environment, see below), polite pacing,
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Optional keyed endpoint (same data, higher rate limit). Its address comes from the environment
// only (REPLAY_RPC_URL), is never written to a file and never printed. It is used up to a credit
// budget; past the budget, or if the endpoint refuses the key, the public endpoint takes over.
// Credits are counted conservatively: 10 for history calls, 1 for the rest, every request sent.
let keyedUrl = process.env.REPLAY_RPC_URL || null;
const CREDIT_LIMIT = Number(process.env.REPLAY_CREDIT_LIMIT || 240000);
const CREDIT_COST = { getBlock: 10, getTransaction: 10, getSignaturesForAddress: 10, getBlockTime: 10 };
const CREDIT_DIR = path.join(CACHE_DIR, 'keyed-credits');
const CREDIT_FILE = path.join(CREDIT_DIR, `${process.pid}.json`);
let ownCredits = 0, othersCredits = 0, sinceSync = 0;
function creditsOfOthers() {
  let sum = 0;
  if (!fs.existsSync(CREDIT_DIR)) return 0;
  for (const f of fs.readdirSync(CREDIT_DIR)) {
    if (f === `${process.pid}.json`) continue;
    try { sum += JSON.parse(fs.readFileSync(path.join(CREDIT_DIR, f), 'utf8')).credits || 0; } catch {}
  }
  return sum;
}
/** Count one keyed request; false when the budget is used up (the caller then uses the public endpoint). */
function spendCredit(method) {
  if (sinceSync === 0) othersCredits = creditsOfOthers();
  sinceSync = (sinceSync + 1) % 25;
  const cost = CREDIT_COST[method] ?? 1;
  if (ownCredits + othersCredits + cost > CREDIT_LIMIT) return false;
  ownCredits += cost;
  stats.keyedRequests++;
  stats.keyedCredits = ownCredits;
  fs.mkdirSync(CREDIT_DIR, { recursive: true });
  fs.writeFileSync(CREDIT_FILE, JSON.stringify({ credits: ownCredits, requests: stats.keyedRequests, at: new Date().toISOString() }));
  return true;
}
function leaveKeyed(why) {
  if (!keyedUrl) return;
  keyedUrl = null;
  gap = Math.max(gap, PUBLIC_GAP_MS);
  console.log(`${new Date().toISOString()} keyed endpoint off (${why}); the public endpoint continues`);
}

const PUBLIC_GAP_MS = Number(process.env.RPC_GAP_MS || 300); // <= ~3.3 requests/second
const KEYED_GAP_MS = Number(process.env.REPLAY_GAP_MS || 125); // <= 8 requests/second
const minGap = () => (keyedUrl ? KEYED_GAP_MS : PUBLIC_GAP_MS);

let next = 0;
let gap = minGap();
export const stats = { requests: 0, cacheHits: 0, http429: 0, errors: 0, keyedRequests: 0, keyedCredits: 0 };

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
    // Take the next send slot before sleeping, so workers running side by side stay `gap` apart.
    const at = Math.max(next, Date.now());
    next = at + gap;
    if (at > Date.now()) await sleep(at - Date.now());
    stats.requests++;
    if (keyedUrl && !spendCredit(method)) leaveKeyed('credit budget used');
    const keyed = !!keyedUrl;
    try {
      const r = await fetch(keyedUrl || RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(60000),
      });
      if (keyed && (r.status === 401 || r.status === 403)) { leaveKeyed(`HTTP ${r.status}`); continue; }
      if (r.status === 429 || r.status >= 500) {
        if (r.status === 429) stats.http429++;
        gap = Math.min(gap * 1.5, 8000);
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
      gap = Math.max(gap * 0.9, minGap());
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
