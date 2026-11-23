// Pool age for situation (c): does the pool have any transaction before a reference signature taken
// ~20,000 slots (~72 min) before the window start? Read-only. Formerly pool_age3.mjs.
// Writes <data>/pool_age_<w>.json = { <pool>: true (old) | false (young) | null (no answer) }; resumable.
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { rpc, onlyEps } from './lib/rpc.mjs';
import { dataPath, getWindow, usageExit, fail } from './lib/config.mjs';

const USAGE = `Usage: node pool-age.mjs --window <W1|W2|W3> [--dir <folder>] [--from <slot>] [--to <slot>]
Reads <data>/<dir>/b_<slot>.json (from fetch-blocks.mjs), writes <data>/pool_age_<w>.json.
Env: OLD=1 drops publicnode (it does not serve older blocks), RPC_URLS overrides the endpoints.
Load: one getBlock (up to 40) plus one getSignaturesForAddress per pool with >= 3 trades (hundreds per window).`;
const { values: opt } = parseArgs({ options: { window: { type: 'string' }, dir: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
if (opt.help) usageExit(USAGE, 0);
if (!opt.window) usageExit(USAGE);
const W = getWindow(opt.window);
const id = W.id, dir = dataPath(opt.dir ?? W.dir), A = Number(opt.from ?? W.a), B = Number(opt.to ?? W.b);
if (!fs.existsSync(dir)) fail(`block folder not found: ${dir}\n  run first: node fetch-blocks.mjs --window ${id}`);
if (process.env.OLD) onlyEps(['vibestation', 'mainnet-beta', 'tatum', 'pocket']);
const cnt = new Map();
for (let s = A; s <= B; s++) { const f = `${dir}/b_${s}.json`; if (!fs.existsSync(f)) continue; const j = JSON.parse(fs.readFileSync(f)); if (j.skip) continue; for (const t of j.tx) if (t.ok && t.pl) for (const p of Object.keys(t.pl)) cnt.set(p, (cnt.get(p) || 0) + 1); }
const pools = [...cnt].filter(([, n]) => n >= 3).map(([p]) => p);
console.log('pools', pools.length);
const out = dataPath(`pool_age_${id.toLowerCase()}.json`);
let ref = null; const refSlot = A - 20000;
for (let s = refSlot; s < refSlot + 40 && !ref; s++) { const b = await rpc('getBlock', [s, { transactionDetails: 'signatures', rewards: false, maxSupportedTransactionVersion: 1, commitment: 'finalized' }]); if (b && b.signatures?.length) ref = { sig: b.signatures[0], slot: s, bt: b.blockTime }; }
console.log('reference', ref);
if (!ref) fail('no reference block found near slot ' + refSlot);
const res = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out)) : {};
let n = 0;
for (const p of pools) { if (p in res) continue; const r = await rpc('getSignaturesForAddress', [p, { before: ref.sig, limit: 1, commitment: 'finalized' }]); res[p] = Array.isArray(r) ? r.length > 0 : null; if (++n % 40 === 0) { fs.writeFileSync(out, JSON.stringify(res)); console.log(n); } }
fs.writeFileSync(out, JSON.stringify(res));
const v = Object.values(res); console.log('old', v.filter((x) => x === true).length, 'young', v.filter((x) => x === false).length, 'null', v.filter((x) => x === null).length, '->', out);
