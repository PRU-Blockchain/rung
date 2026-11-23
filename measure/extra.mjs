// Extra cross-sections over the rows files (formerly extra3.mjs): sandwich rate, situation mix of the
// manual-like $5-500 subset, median buy size, failed-buy counts, shared programs and popular fee accounts.
// Prints to stdout only.
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { dataPath, requireFile, usageExit } from './lib/config.mjs';

const USAGE = `Usage: node extra.mjs [--windows W1,W2,W3]
Reads <data>/rows_<W>.json (from build-rows.mjs) and prints the cross-sections.`;
const { values: opt } = parseArgs({ options: { windows: { type: 'string', default: 'W1,W2,W3' }, help: { type: 'boolean', short: 'h' } } });
if (opt.help) usageExit(USAGE, 0);
const ids = opt.windows.split(','); const out = {};
for (const id of ids) requireFile(dataPath(`rows_${id}.json`), `node build-rows.mjs --window ${id}`);
const pgAll = new Map(), xfAll = new Map();
for (const id of ids) {
  const j = JSON.parse(fs.readFileSync(dataPath(`rows_${id}.json`), 'utf8')); const R = j.rows;
  const o = { n: R.length, sw: R.filter((r) => r.sw).length };
  o.swRate = o.sw / o.n;
  // manual-like ∩ $5-500: situation mix
  const S = R.filter((r) => r.anc && r.cls === 'man' && r.usd >= 5 && r.usd < 500); o.subN = S.length;
  o.comp = {}; for (const r of S) { const k = r.ss.length ? r.ss.join('+') : 'other'; o.comp[k] = (o.comp[k] || 0) + 1; }
  const A = R.filter((r) => r.anc); o.allComp = {}; for (const r of A) { const k = r.ss.length ? r.ss.join('+') : 'other'; o.allComp[k] = (o.allComp[k] || 0) + 1; }
  o.usdMed = R.map((r) => r.usd).sort((a, b) => a - b)[R.length >> 1];
  o.fail = j.fl.length; o.failSlip = j.fl.filter((f) => f.slip).length;
  for (const [p, n] of j.meta.sharedPg) pgAll.set(p, (pgAll.get(p) || 0) + n);
  for (const [p, n] of j.meta.sharedXf) xfAll.set(p, (xfAll.get(p) || 0) + n);
  out[id] = o;
}
console.log(JSON.stringify(out, null, 1));
console.log('shared programs (signer count summed over windows):', JSON.stringify([...pgAll].sort((a, b) => b[1] - a[1]).slice(0, 14)));
console.log('popular fee accounts:', JSON.stringify([...xfAll].sort((a, b) => b[1] - a[1]).slice(0, 6)));
