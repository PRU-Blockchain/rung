// Downloads blocks with read-only getBlock and writes one compact record per slot (<data>/<dir>/b_<slot>.json, see lib/parse.mjs).
// Formerly blkfetch3.mjs. Already-present slots are skipped, so an interrupted run can be resumed.
// A -32007/-32009 ("skipped / not available") answer is recorded as a skipped slot only when 3 different endpoints
// say so (older blocks can be missing on a single endpoint).
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { parseBlock, loadInstructionNames } from './lib/parse.mjs';
import { dataPath, getWindow, rpcUrls, usageExit, fail } from './lib/config.mjs';

const USAGE = `Usage:
  node fetch-blocks.mjs --window <W1|W2|W3>            fetch the window's slot range from windows.json
  node fetch-blocks.mjs --from <slot> --to <slot> --dir <folder>   fetch an explicit range (inclusive)
Options: --window can be combined with --from/--to/--dir to override parts of the window.
Writes <data>/<dir>/b_<slot>.json (data = MEASURE_DATA_DIR, default measure/data).
Env: RPC_URLS (comma-separated endpoints), PER (workers per endpoint, default 3), MINGAP (min ms between
requests per endpoint, default 350), NOPN=1 (drop publicnode), ONLY=<substring> (keep matching endpoints only).
Load warning: a full window (3,600 slots) takes ~20-25 minutes and sends thousands of requests to public endpoints.`;

const { values: opt } = parseArgs({ options: { window: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, dir: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
if (opt.help) usageExit(USAGE, 0);
if (!opt.window && !(opt.from && opt.to && opt.dir)) usageExit(USAGE);
const W = opt.window ? getWindow(opt.window) : {};
const a = Number(opt.from ?? W.a), b = Number(opt.to ?? W.b), dirName = opt.dir ?? W.dir;
if (!Number.isInteger(a) || !Number.isInteger(b) || b < a) fail(`bad slot range: ${opt.from ?? W.a}..${opt.to ?? W.b}`);

loadInstructionNames(); // fail early (before any request) if the pump IDLs are missing
const DIR = dataPath(dirName); fs.mkdirSync(DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EPS = rpcUrls().filter((u) => !(process.env.NOPN && /publicnode/.test(u))).filter((u) => !process.env.ONLY || u.includes(process.env.ONLY)).map((url) => ({ url, gap: 700, next: 0, ok: 0, lim: 0, dead: 0, sk: 0 }));
if (!EPS.length) fail('no RPC endpoint left after RPC_URLS / NOPN / ONLY filters');
const todo = [];
for (let s = a; s <= b; s++) if (!fs.existsSync(path.join(DIR, `b_${s}.json`))) todo.push(s);
console.log('to fetch', todo.length, 'slots into', DIR);
let done = 0, inflight = 0; const t0 = Date.now();
async function tryOne(ep, slot) { // 'skip' | 'lim' | {res}
  const at = Math.max(ep.next, Date.now()); ep.next = at + ep.gap; const w = at - Date.now(); if (w > 0) await sleep(w);
  try {
    const r = await fetch(ep.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBlock', params: [slot, { encoding: 'json', transactionDetails: 'full', rewards: false, maxSupportedTransactionVersion: 1, commitment: 'finalized' }] }), signal: AbortSignal.timeout(40000) });
    if (r.status === 429 || r.status >= 500) { ep.lim++; ep.gap = Math.min(ep.gap * 1.3, 4000); ep.next = Date.now() + ep.gap * 2; return 'lim'; }
    const j = await r.json();
    if (j.error) { if (j.error.code === -32007 || j.error.code === -32009) { ep.sk++; return 'skip'; } ep.lim++; ep.gap = Math.min(ep.gap * 1.4, 10000); return 'lim'; }
    if (!j.result) { ep.lim++; return 'lim'; }
    ep.ok++; ep.gap = Math.max(ep.gap * 0.97, Number(process.env.MINGAP || 350));
    return { res: j.result };
  } catch (e) { ep.dead++; ep.next = Date.now() + 3000; return 'lim'; }
}
async function worker(ep) {
  while (todo.length || inflight > 0) {
    const slot = todo.shift();
    if (slot === undefined) { await sleep(500); continue; }
    inflight++;
    let ok = false; const skipped = new Set();
    for (let tr = 0; tr < 40 && !ok; tr++) {
      // next endpoint: this worker's own first; once it answered "skipped", the other endpoints
      const cand = skipped.has(ep.url) ? EPS.filter((e) => !skipped.has(e.url)).sort((x, y) => x.next - y.next)[0] : ep;
      if (!cand) break;
      const o = await tryOne(cand, slot);
      if (o === 'skip') { skipped.add(cand.url); if (skipped.size >= Math.min(3, EPS.length)) { fs.writeFileSync(path.join(DIR, `b_${slot}.json`), JSON.stringify({ slot, skip: true })); ok = true; } continue; }
      if (o === 'lim') continue;
      fs.writeFileSync(path.join(DIR, `b_${slot}.json`), JSON.stringify(parseBlock(o.res, slot))); ok = true;
    }
    inflight--;
    if (!ok) todo.push(slot); else done++;
    // progress: endpoint host prefix ok/limited/dead/skipped@gap
    if (ok && done % 100 === 0) console.log(`${done} / ${(Date.now() - t0) / 1000 | 0}s`, EPS.map((e) => `${e.url.slice(8, 16)}:${e.ok}/${e.lim}/${e.dead}/${e.sk}@${e.gap | 0}`).join(' '));
  }
}
const PER = Number(process.env.PER || 3);
await Promise.all(EPS.flatMap((e) => Array.from({ length: PER }, () => worker(e))));
console.log('done', (Date.now() - t0) / 1000 | 0, 's');
