// Signer-class check (formerly sigcheck.mjs): for a sample of signers from each class, how many hours do their
// last 100 transactions span? Read-only getSignaturesForAddress. Fixed-seed sampling.
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { rpc } from './lib/rpc.mjs';
import { dataPath, requireFile, usageExit } from './lib/config.mjs';

const USAGE = `Usage: node sig-check.mjs --window <W1|W2|W3> [--count 50]
Samples <count> signers per class (manual-like, ambiguous, bot-like) from <data>/rows_<W>.json and writes
<data>/sig-check_<W>.json. Load: one getSignaturesForAddress per sampled signer (3 x count requests).`;
const { values: opt } = parseArgs({ options: { window: { type: 'string' }, count: { type: 'string', default: '50' }, help: { type: 'boolean', short: 'h' } } });
if (opt.help) usageExit(USAGE, 0);
if (!opt.window) usageExit(USAGE);
const id = opt.window; const N = Number(opt.count);
requireFile(dataPath(`rows_${id}.json`), `node build-rows.mjs --window ${id}`);
const j = JSON.parse(fs.readFileSync(dataPath(`rows_${id}.json`))); const by = { man: new Set(), amb: new Set(), bot: new Set() };
for (const r of j.rows) by[r.cls].add(r.f);
let seed = 5; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const res = {};
for (const c of ['man', 'amb', 'bot']) {
  const a = [...by[c]]; const pick = []; while (pick.length < Math.min(N, a.length)) { const x = a[(rnd() * a.length) | 0]; if (!pick.includes(x)) pick.push(x); }
  const spans = []; let full = 0;
  for (const f of pick) { const r = await rpc('getSignaturesForAddress', [f, { limit: 100 }]); if (!Array.isArray(r) || !r.length) continue; const t0 = r[0].blockTime, t1 = r[r.length - 1].blockTime; if (r.length === 100) { spans.push((t0 - t1) / 3600); full++; } else spans.push(null); }
  const s = spans.filter((x) => x != null).sort((a, b) => a - b);
  res[c] = { n: pick.length, with100: full, medianHours: s.length ? s[s.length >> 1] : null, p25: s.length ? s[Math.floor(s.length * .25)] : null, p75: s.length ? s[Math.floor(s.length * .75)] : null, under100: pick.length - full };
  console.log(c, JSON.stringify(res[c]));
}
fs.writeFileSync(dataPath(`sig-check_${id}.json`), JSON.stringify(res));
