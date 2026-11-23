// Second-measurement tables (formerly report3.mjs). Reads <data>/rows_<W>.json (build-rows.mjs) and writes
// <data>/report-tables.md and <data>/report.json; the tables are also printed.
// Markdown labels are English. JSON keys keep the labels of the 2026-11-22 run (Turkish) so that a re-run can be
// compared key by key with results/report-2026-11-22.json; each label below is [JSON key, Markdown label].
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { dataPath, requireFile, usageExit } from './lib/config.mjs';

const USAGE = `Usage: node --max-old-space-size=8000 report.mjs [--windows W1,W2,W3] [--prefix rows_]
Reads <data>/<prefix><W>.json for each window (from build-rows.mjs); writes <data>/report-tables.md and <data>/report.json.`;
const { values: opt } = parseArgs({ options: { windows: { type: 'string', default: 'W1,W2,W3' }, prefix: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
if (opt.help) usageExit(USAGE, 0);
const ids = opt.windows.split(',');
const PR = opt.prefix || process.env.PREFIX || 'rows_';
for (const id of ids) requireFile(dataPath(`${PR}${id}.json`), `node build-rows.mjs --window ${id}`);

const data = {}; let ALL = []; let FL = [];
for (const id of ids) { const j = JSON.parse(fs.readFileSync(dataPath(`${PR}${id}.json`), 'utf8')); data[id] = j; for (const r of j.rows) { r.w = id; r.v = id + r.v; } for (const f of j.fl) { f.w = id; f.usdSol = j.meta.W.sol; } for (const r of j.rows) ALL.push(r); for (const f of j.fl) FL.push(f); }
const SOL = Object.fromEntries(ids.map((i) => [i, data[i].meta.W.sol]));
const out = []; const P = (s = '') => out.push(s);
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const f1 = (x, d = 1) => (x == null || !isFinite(x) ? '-' : (100 * x).toFixed(d) + '%');
const n0 = (x) => (x == null ? '-' : String(x));
const usd = (lam, w) => (lam / 1e9) * SOL[w];
const rng = (a) => { const b = a.filter((x) => x != null); return b.length ? `${f1(Math.min(...b))}–${f1(Math.max(...b))}` : '-'; };
// ---- ladder helpers
const LAD = { '1-2-3': [1, 2, 3], '2-3-5': [2, 3, 5], '5-10-15': [5, 10, 15], '10-20-30': [10, 20, 30] };
const SING = [2, 3, 5, 10, 20];
const hitL = (ks, L) => { for (let k = 0; k < 3; k++) if (ks[k] <= 1 + L[k] / 100) return { k: k + 1, paid: ks[k] - 1 }; return null; };
const hitS = (ks, s) => (ks[0] <= 1 + s / 100 ? { k: 1, paid: ks[0] - 1 } : null);
const ksOf = (r, mode) => (mode === 'own' ? r.ladO : r.lad.d3);
const ksD = (r, d) => r.lad['d' + d];
function rateBoot(R, fn, B = 200) { // cluster (venue) bootstrap
  const by = new Map(); for (const r of R) { let o = by.get(r.v); if (!o) { o = [0, 0]; by.set(r.v, o); } o[0]++; if (fn(r)) o[1]++; }
  const arr = [...by.values()]; const n = arr.reduce((s, x) => s + x[0], 0), h = arr.reduce((s, x) => s + x[1], 0);
  if (arr.length < 3) return { p: n ? h / n : null, lo: null, hi: null, n };
  const ps = []; let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let b = 0; b < B; b++) { let nn = 0, hh = 0; for (let i = 0; i < arr.length; i++) { const x = arr[(rnd() * arr.length) | 0]; nn += x[0]; hh += x[1]; } ps.push(hh / nn); }
  ps.sort((a, b) => a - b);
  return { p: h / n, lo: ps[(B * 0.025) | 0], hi: ps[(B * 0.975) | 0], n };
}
function diffBoot(R, inSub, fn, B = 300) { // subset rate − overall rate, venue-clustered
  const by = new Map();
  for (const r of R) { let o = by.get(r.v); if (!o) { o = [0, 0, 0, 0]; by.set(r.v, o); } o[0]++; const h = fn(r) ? 1 : 0; o[1] += h; if (inSub(r)) { o[2]++; o[3] += h; } }
  const arr = [...by.values()]; const tot = (a) => a.reduce((s, x) => [s[0] + x[0], s[1] + x[1], s[2] + x[2], s[3] + x[3]], [0, 0, 0, 0]);
  const t = tot(arr); const est = { sub: t[2] ? t[3] / t[2] : null, all: t[1] / t[0], diff: t[2] ? t[3] / t[2] - t[1] / t[0] : null, nSub: t[2], nAll: t[0], venues: arr.length };
  if (arr.length < 5 || !t[2]) return { ...est, lo: null, hi: null };
  const ds = []; let seed = 777; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let b = 0; b < B; b++) { let a0 = 0, a1 = 0, s0 = 0, s1 = 0; for (let i = 0; i < arr.length; i++) { const x = arr[(rnd() * arr.length) | 0]; a0 += x[0]; a1 += x[1]; s0 += x[2]; s1 += x[3]; } if (s0) ds.push(s1 / s0 - a1 / a0); }
  ds.sort((a, b) => a - b);
  return { ...est, lo: ds[(ds.length * 0.025) | 0], hi: ds[(ds.length * 0.975) | 0] };
}
// situations: [code, JSON key, label]
const SITS = [['a', '(a) açılış 2 dk', '(a) launch 2 min'], ['b', '(b) geçiş 5 dk', '(b) transition 5 min'], ['c', '(c) sıradan ≥70 dk', '(c) established ≥70 min'], ['d', '(d) üst-10 hacim', '(d) top-10 volume']];
const selS = (R, s) => R.filter((r) => r.ss.includes(s));
const ancR = ALL.filter((r) => r.anc);
const ALL_W = 'hepsi'; // JSON key for "all windows combined"
const wName = (id) => (id === ALL_W ? 'all' : id);

// ================= PART 1
P('## Part 1 · Ladder table per window (X = $100, landing delay d = 3 slots)');
P('Cell: fill rate / mean overpayment vs P0 among filled buys (drops count as 0, "clipped"). n = anchor buys (venues).');
const J1 = {};
for (const [s, , lbl] of SITS) {
  P(`\n### ${lbl}`);
  P('| window | n (venues) | 1-2-3 | 2-3-5 | 5-10-15 | 10-20-30 | single 2% | single 3% | single 5% | single 10% | single 20% |');
  P('|---|---|' + '---|'.repeat(9));
  for (const id of [...ids, ALL_W]) {
    const R = selS(id === ALL_W ? ancR : ancR.filter((r) => r.w === id), s);
    const nv = new Set(R.map((r) => r.v)).size;
    const cells = [];
    const fnL = (L) => (r) => hitL(ksOf(r, '100'), L);
    const ksO = (r) => r.lad.d3;
    for (const [nm, L] of Object.entries(LAD)) { const hs = R.map((r) => hitL(ksO(r), L)); const hh = hs.filter(Boolean); cells.push([nm, hh.length / (R.length || 1), mean(hh.map((x) => Math.max(x.paid, 0)))]); }
    for (const sg of SING) { const hs = R.map((r) => hitS(ksO(r), sg)); const hh = hs.filter(Boolean); cells.push(['s' + sg, hh.length / (R.length || 1), mean(hh.map((x) => Math.max(x.paid, 0)))]); }
    J1[`${s}|${id}`] = { n: R.length, nv, cells };
    P(`| ${wName(id)} | ${R.length} (${nv}) | ` + cells.map((c) => (R.length ? `${f1(c[1])} / ${f1(c[2], 2)}` : '-')).join(' | ') + ' |');
  }
  // range across windows (windows with n >= 100)
  const okW = ids.filter((id) => (J1[`${s}|${id}`]?.n || 0) >= 100);
  if (okW.length >= 2) {
    const rg = ['1-2-3', '2-3-5', '5-10-15', '10-20-30', 's2', 's3', 's5', 's10', 's20'].map((nm) => { const v = okW.map((id) => J1[`${s}|${id}`].cells.find((c) => c[0] === nm)); const t = v.map((c) => c[1]); const pd = v.map((c) => c[2]); return `${f1(Math.min(...t))}–${f1(Math.max(...t))}`; });
    P(`| **range (windows with n≥100: ${okW.join(',')})** | | ` + rg.join(' | ') + ' |');
    const rp = ['1-2-3', '2-3-5', '5-10-15', '10-20-30', 's2', 's3', 's5', 's10', 's20'].map((nm) => { const v = okW.map((id) => J1[`${s}|${id}`].cells.find((c) => c[0] === nm)[2]); return `${f1(Math.min(...v), 2)}–${f1(Math.max(...v), 2)}`; });
    P(`| **clipped payment range** | | ` + rp.join(' | ') + ' |');
  }
}
// CI (all windows): fill rate, ladders and singles
P('\n### Windows combined, 95% confidence interval (venue-clustered bootstrap), fill rate');
P('| situation | 1-2-3 | 2-3-5 | 5-10-15 | 10-20-30 | single 3% | single 20% |'); P('|---|---|---|---|---|---|---|');
for (const [s, , lbl] of SITS) {
  const R = selS(ancR, s); if (R.length < 50) { P(`| ${lbl} | n=${R.length} insufficient |`); continue; }
  const c = [...Object.values(LAD).map((L) => rateBoot(R, (r) => hitL(r.lad.d3, L))), rateBoot(R, (r) => hitS(r.lad.d3, 3)), rateBoot(R, (r) => hitS(r.lad.d3, 20))];
  P(`| ${lbl} n=${R.length} | ` + c.map((x) => `${f1(x.p)} (${f1(x.lo)}–${f1(x.hi)})`).join(' | ') + ' |');
}
// landing-delay sensitivity
P('\n### Landing-delay sensitivity (combined), 1-2-3 and 10-20-30 fill, d = 2 / 3 / 4 slots');
P('| situation | 1-2-3 d2 / d3 / d4 | 10-20-30 d2 / d3 / d4 |'); P('|---|---|---|');
for (const [s, , lbl] of SITS) { const R = selS(ancR, s); if (!R.length) continue; const g = (L, d) => f1(R.filter((r) => hitL(ksD(r, d), L)).length / R.length); P(`| ${lbl} | ${[2, 3, 4].map((d) => g(LAD['1-2-3'], d)).join(' / ')} | ${[2, 3, 4].map((d) => g(LAD['10-20-30'], d)).join(' / ')} |`); }

// ================= PART 2
P('\n## Part 2 · Subsets (3 windows combined; ladder simulated with the anchor buy\'s OWN amount, as a buy of its own size)');
const band = (r) => (r.usd < 5 ? '<5$' : r.usd < 50 ? '5–50$' : r.usd < 500 ? '50–500$' : '>500$');
// subsets: [JSON key, label, filter]
const SUBS = [
  ['tümü', 'all', () => true],
  ['<5 $', '<5 $', (r) => band(r) === '<5$'], ['5–50 $', '5–50 $', (r) => band(r) === '5–50$'], ['50–500 $', '50–500 $', (r) => band(r) === '50–500$'], ['>500 $', '>500 $', (r) => band(r) === '>500$'],
  ['elle-benzeri', 'manual-like', (r) => r.cls === 'man'], ['bot-benzeri', 'bot-like', (r) => r.cls === 'bot'], ['belirsiz', 'ambiguous', (r) => r.cls === 'amb'],
  ['elle ∩ 5–500 $', 'manual ∩ 5–500 $', (r) => r.cls === 'man' && r.usd >= 5 && r.usd < 500],
  ['elle ∩ 5–500 $ ∩ yönlendiricisiz', 'manual ∩ 5–500 $ ∩ no router', (r) => r.cls === 'man' && r.usd >= 5 && r.usd < 500 && !r.term],
  ['elle ∩ 5–500 $ ∩ yönlendirici/terminal', 'manual ∩ 5–500 $ ∩ router/terminal', (r) => r.cls === 'man' && r.usd >= 5 && r.usd < 500 && r.term],
  ['elle ∩ Jito ipucu var', 'manual ∩ has Jito tip', (r) => r.cls === 'man' && r.tip > 0],
  ['yönlendirici/terminal (tüm sınıflar)', 'router/terminal (all classes)', (r) => r.term],
  ['Lighthouse (Phantom koruması) var', 'has Lighthouse (Phantom guard)', (r) => r.lh],
  ['bot ∩ 5–500 $', 'bot ∩ 5–500 $', (r) => r.cls === 'bot' && r.usd >= 5 && r.usd < 500],
];
const J2 = {};
function tableSubs(titleKey, title, sitFilter, mode) {
  P(`\n### ${title}`);
  P('| subset | n | share | 1-2-3 | 2-3-5 | 10-20-30 | single 1% (tight first try) | single 3% | single 20% | clipped mean payment (2-3-5) |'); P('|---|---|---|---|---|---|---|---|---|---|');
  const base = sitFilter ? ancR.filter(sitFilter) : ancR;
  for (const [key, nm, f] of SUBS) {
    const R = base.filter(f); if (R.length < 30) { P(`| ${nm} | ${R.length} | insufficient |`); continue; }
    const ks = (r) => ksOf(r, mode);
    const g = (fn) => R.filter((r) => fn(ks(r))).length / R.length;
    const hh = R.map((r) => hitL(ks(r), LAD['2-3-5'])).filter(Boolean);
    const row = [g((k) => hitL(k, LAD['1-2-3'])), g((k) => hitL(k, LAD['2-3-5'])), g((k) => hitL(k, LAD['10-20-30'])), g((k) => hitS(k, 1)), g((k) => hitS(k, 3)), g((k) => hitS(k, 20))];
    J2[`${titleKey}|${key}`] = { n: R.length, row };
    P(`| ${nm} | ${R.length} | ${f1(R.length / base.length)} | ` + row.map((x) => f1(x)).join(' | ') + ` | ${f1(mean(hh.map((x) => Math.max(x.paid, 0))), 2)} |`);
  }
}
tableSubs('Tüm durumlar, kendi tutarıyla', 'All situations, own amount', null, 'own');
tableSubs('Tüm durumlar, X = 100 $ sabit (karşılaştırma)', 'All situations, fixed X = 100 $ (comparison)', null, '100');
for (const [s, key, lbl] of SITS) tableSubs(`${key}, kendi tutarıyla`, `${lbl}, own amount`, (r) => r.ss.includes(s), 'own');
P('\n### Does "manual-like ∩ 5–500 $" differ from the whole sample? (subset fill − whole; 95% CI, venue-clustered bootstrap)');
P('| situation | measure | subset (n) | whole (n) | difference | CI |'); P('|---|---|---|---|---|---|');
const J2d = [];
for (const [lblKey, lbl, filt] of [['tüm durumlar', 'all situations', null], ...SITS.map(([s, k, l]) => [k, l, (r) => r.ss.includes(s)])]) {
  const base = filt ? ancR.filter(filt) : ancR;
  for (const [mnKey, mn, fn] of [['1-2-3 (kendi tutarı)', '1-2-3 (own amount)', (r) => hitL(r.ladO, LAD['1-2-3'])], ['2-3-5 (kendi tutarı)', '2-3-5 (own amount)', (r) => hitL(r.ladO, LAD['2-3-5'])], ['tek %1', 'single 1%', (r) => hitS(r.ladO, 1)], ['1-2-3 (100 $)', '1-2-3 (100 $)', (r) => hitL(r.lad.d3, LAD['1-2-3'])], ['2-3-5 (100 $)', '2-3-5 (100 $)', (r) => hitL(r.lad.d3, LAD['2-3-5'])], ['tek %1 (100 $)', 'single 1% (100 $)', (r) => hitS(r.lad.d3, 1)]]) {
    const d = diffBoot(base, (r) => r.cls === 'man' && r.usd >= 5 && r.usd < 500, fn);
    if (!d.nSub) continue;
    J2d.push({ lbl: lblKey, mn: mnKey, ...d });
    P(`| ${lbl} | ${mn} | ${f1(d.sub)} (${d.nSub}) | ${f1(d.all)} (${d.nAll}) | ${f1(d.diff)} | ${d.lo == null ? '-' : `${f1(d.lo)} … ${f1(d.hi)}`} |`);
  }
}
// class distribution
P('\n### Class distribution (per buy, successful buys)');
P('| window | buys | manual-like | ambiguous | bot-like | router/terminal | has Jito tip | Lighthouse | median $ | 5–500 $ share |'); P('|---|---|---|---|---|---|---|---|---|---|');
for (const id of [...ids, ALL_W]) { const R = id === ALL_W ? ALL : ALL.filter((r) => r.w === id); const c = (fn) => f1(R.filter(fn).length / R.length); P(`| ${wName(id)} | ${R.length} | ${c((r) => r.cls === 'man')} | ${c((r) => r.cls === 'amb')} | ${c((r) => r.cls === 'bot')} | ${c((r) => r.term)} | ${c((r) => r.tip > 0)} | ${c((r) => r.lh)} | ${q(R.map((r) => r.usd), 0.5).toFixed(2)} | ${c((r) => r.usd >= 5 && r.usd < 500)} |`); }

// ================= PART 3
P('\n## Part 3 · Declared tolerance vs needed (k = 3 slots quote delay; k=2/4 sensitivity)');
const T0 = ALL.filter((r) => r.typ && r.dec[2] != null && r.req[2] != null && isFinite(r.dec[2]) && isFinite(r.req[2]));
// venues with a persistent deviation (e.g. transfer-fee / taxed token: pool vault and tokens reaching the user differ) are excluded
const vm = new Map(); for (const r of T0) { (vm.get(r.v) || vm.set(r.v, []).get(r.v)).push(r.req[2]); }
const badV = new Set(); for (const [v, a] of vm) if (a.length >= 15 && Math.abs(q(a, 0.5)) > 0.05) badV.add(v);
const T = T0.filter((r) => !badV.has(r.v));
for (const r of T) { r.unp = (r.typ === 'ex' ? r.dec[2] >= 0.99 : r.dec[2] >= 2) ? 1 : 0; for (let k = 0; k < 4; k++) if (r.dec[k] != null) r.dec[k] = Math.min(r.dec[k], 1); }
P(`Unprotected declaration (exact-in ≥99% / max_cost ≥200%) share: ${f1(T.filter((r) => r.unp).length / T.length)}.`);
P(`Excluded venues with persistent deviation (median needed > 5%: transfer-fee / taxed token): ${badV.size} venues, ${T0.length - T.length} buys.`);
P(`Successful buys with a recoverable tolerance: ${T.length} / ${ALL.length} (exact-in min_out: ${T.filter((r) => r.typ === 'ex').length}, max_cost: ${T.filter((r) => r.typ === 'mc').length}).`);
const J3 = {};
function gapRow(R, k, floor) {
  const d = R.map((r) => Math.max(r.dec[k], 0)), rq = R.map((r) => Math.max(r.req[k], 0)); const gap = R.map((r) => r.dec[k] - r.req[k]);
  const ratio = (m) => R.filter((r) => Math.max(r.dec[k], 0) > m * Math.max(r.req[k], floor)).length / R.length;
  return { n: R.length, dmed: q(d, .5), dq1: q(d, .25), dq3: q(d, .75), rmed: q(rq, .5), rq3: q(rq, .75), rp90: q(rq, .9), gmed: q(gap, .5), gq1: q(gap, .25), gq3: q(gap, .75), r5: ratio(5), r10: ratio(10) };
}
function gapTable(titleKey, title, subs, k = 2, floor = 0.005) {
  P(`\n### ${title}`);
  P('| group | n | declared: median [quartiles] | needed: median / p75 / p90 | gap (declared−needed) median [quartiles] | declared > 5× needed | declared > 10× needed |'); P('|---|---|---|---|---|---|---|');
  for (const [key, nm, f] of subs) { const R = T.filter(f); if (R.length < 30) { P(`| ${nm} | ${R.length} | insufficient |`); continue; } const g = gapRow(R, k, floor); J3[`${titleKey}|${key}`] = g; P(`| ${nm} | ${g.n} | ${f1(g.dmed)} [${f1(g.dq1)}–${f1(g.dq3)}] | ${f1(g.rmed, 2)} / ${f1(g.rq3, 2)} / ${f1(g.rp90, 2)} | ${f1(g.gmed)} [${f1(g.gq1)}–${f1(g.gq3)}] | ${f1(g.r5)} | ${f1(g.r10)} |`); }
}
const SUB3 = [['tümü', 'all', () => true], ...SITS.map(([s, k, l]) => [k, l, (r) => r.ss.includes(s)]), ['exact-in (min_out)', 'exact-in (min_out)', (r) => r.typ === 'ex'], ['max_cost tipi', 'max_cost type', (r) => r.typ === 'mc'], ['elle-benzeri', 'manual-like', (r) => r.cls === 'man'], ['bot-benzeri', 'bot-like', (r) => r.cls === 'bot'], ['elle ∩ 5–500 $', 'manual ∩ 5–500 $', (r) => r.cls === 'man' && r.usd >= 5 && r.usd < 500], ['yönlendirici/terminal', 'router/terminal', (r) => r.term], ['yönlendiricisiz', 'no router', (r) => !r.term], ['<5 $', '<5 $', (r) => r.usd < 5], ['5–50 $', '5–50 $', (r) => r.usd >= 5 && r.usd < 50], ['50–500 $', '50–500 $', (r) => r.usd >= 50 && r.usd < 500], ['>500 $', '>500 $', (r) => r.usd >= 500]];
gapTable('k = 3 (ana), gereken tabanı %0,5', 'k = 3 (main), needed floor 0.5%', SUB3, 2, 0.005);
gapTable('k = 3, gereken tabanı %1 (daha ihtiyatlı)', 'k = 3, needed floor 1% (more conservative)', SUB3.slice(0, 6), 2, 0.01);
gapTable('k = 2 (kotasyon 2 slot önce)', 'k = 2 (quote 2 slots earlier)', SUB3.slice(0, 6), 1, 0.005);
gapTable('k = 4 (kotasyon 4 slot önce)', 'k = 4 (quote 4 slots earlier)', SUB3.slice(0, 6), 3, 0.005);
// per window
P('\n### Per window (k = 3, floor 0.5%)');
P('| window | n | declared median [quartiles] | needed median / p90 | gap median | >5× | >10× |'); P('|---|---|---|---|---|---|---|');
for (const id of ids) { const R = T.filter((r) => r.w === id); if (R.length < 30) continue; const g = gapRow(R, 2, 0.005); P(`| ${id} | ${g.n} | ${f1(g.dmed)} [${f1(g.dq1)}–${f1(g.dq3)}] | ${f1(g.rmed, 2)} / ${f1(g.rp90, 2)} | ${f1(g.gmed)} | ${f1(g.r5)} | ${f1(g.r10)} |`); }
// declared distribution
P('\n### Declared tolerance distribution (k = 3)');
const ROUND = [1, 2, 3, 5, 10, 15, 20, 25, 30, 40, 50];
const stable = (r) => Math.abs(r.req[2]) < 0.003;
function histTable(title, subs) {
  P(`\n#### ${title}`);
  P('| group | n | ' + ROUND.map((x) => `±0.5pp @${x}%`).join(' | ') + ' | <0.5% | within ±0.5pp of any round value |'); P('|---|---|' + '---|'.repeat(ROUND.length + 2));
  for (const [nm, f] of subs) { const R = T.filter(f); if (R.length < 30) continue; const near = (x) => R.filter((r) => Math.abs(r.dec[2] * 100 - x) <= 0.5).length / R.length; const any = R.filter((r) => ROUND.some((x) => Math.abs(r.dec[2] * 100 - x) <= 0.5)).length / R.length; P(`| ${nm} | ${R.length} | ` + ROUND.map((x) => f1(near(x))).join(' | ') + ` | ${f1(R.filter((r) => r.dec[2] < 0.005).length / R.length)} | ${f1(any)} |`); }
}
histTable('Buys whose price stayed stable (|needed| < 0.3%: quote estimate most reliable), all windows', [['all', (r) => stable(r)], ['router/terminal', (r) => stable(r) && r.term], ['no router', (r) => stable(r) && !r.term], ['manual-like', (r) => stable(r) && r.cls === 'man'], ['bot-like', (r) => stable(r) && r.cls === 'bot'], ['exact-in', (r) => stable(r) && r.typ === 'ex'], ['max_cost', (r) => stable(r) && r.typ === 'mc'], ['has Lighthouse (Phantom)', (r) => stable(r) && r.lh]]);
histTable('All buys (with price-movement noise)', [['all', () => true], ['router/terminal', (r) => r.term], ['manual-like', (r) => r.cls === 'man']]);
for (const id of ids) histTable(`${id} (stable price)`, [['all', (r) => r.w === id && stable(r)]]);
// most frequent values at 1pp
P('\n#### Most frequent declared values (1pp rounding, stable-price buys, router/terminal separately)');
for (const [nm, f] of [['all', () => true], ['router/terminal', (r) => r.term], ['no router', (r) => !r.term], ['manual-like', (r) => r.cls === 'man']]) {
  const R = T.filter((r) => stable(r) && f(r)); const m = new Map(); for (const r of R) { const b = Math.round(Math.max(r.dec[2], 0) * 100); m.set(b, (m.get(b) || 0) + 1); }
  P(`- ${nm} (n=${R.length}): ` + [...m].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([b, c]) => `${b}%: ${f1(c / R.length)}`).join(', '));
}

// ---- matched comparison
P('\n### Does a wide tolerance really make the buy more expensive? (same venue, same slot bin; tight ≤5% vs wide ≥20% declared)');
function matched(binSlots, mode, filt) {
  const g = new Map();
  for (const r of T) { if (filt && !filt(r)) continue; const d = r.dec[2]; const grp = d <= 0.05 ? 'n' : d >= 0.20 ? 'w' : null; if (!grp) continue; if (filt && filt.agree) { const d1 = r.dec[0]; if (d1 == null || (grp === 'n' ? d1 > 0.05 : d1 < 0.20)) continue; } if (mode === 'o3' && r.o[2] == null) continue; if (mode === 'lxp' && r.lxp == null) continue; const key = r.v + '|' + Math.floor(r.slot / binSlots); let o = g.get(key); if (!o) { o = { n: [], w: [] }; g.set(key, o); } o[grp].push(mode === 'o3' ? r.o[2] : r.lxp); }
  const pairs = [...g.values()].filter((o) => o.n.length && o.w.length).map((o) => ({ n: mean(o.n), w: mean(o.w), nn: o.n.length, nw: o.w.length }));
  if (pairs.length < 20) return { pairs: pairs.length };
  const diffs = pairs.map((p) => p.w - p.n); const wts = pairs.map((p) => (p.nn * p.nw) / (p.nn + p.nw));
  const wm = (ds, ws) => ds.reduce((s, x, i) => s + x * ws[i], 0) / ws.reduce((s, x) => s + x, 0);
  const est = wm(diffs, wts); const med = q(diffs, .5);
  const bs = []; let seed = 99; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let b = 0; b < 400; b++) { const ds = [], ws = []; for (let i = 0; i < diffs.length; i++) { const j = (rnd() * diffs.length) | 0; ds.push(diffs[j]); ws.push(wts[j]); } bs.push(wm(ds, ws)); }
  bs.sort((a, b) => a - b);
  return { pairs: pairs.length, obsN: pairs.reduce((s, p) => s + p.nn, 0), obsW: pairs.reduce((s, p) => s + p.nw, 0), est, med, lo: bs[10], hi: bs[389] };
}
const MT = {};
P('| measure | slot bin | filter | matched (venue, bin) | tight buys / wide buys | difference (wide − tight) weighted mean | median difference | 95% CI |'); P('|---|---|---|---|---|---|---|---|');
for (const [mn, mode] of [['realised overpayment o3 (vs the k=3 quote)', 'o3'], ['execution price on common ground (log, ≈ %)', 'lxp']]) {
  for (const bs of [3, 10]) for (const [key, fn, ff] of [['tümü', 'all', null], ['sandwichsiz', 'no sandwich', (r) => !r.sw], ['elle-benzeri', 'manual-like', (r) => r.cls === 'man'], ['yalnız havuz (A)', 'pools only (A)', (r) => r.kd === 'A'], ['yalnız eğri (C)', 'curves only (C)', (r) => r.kd === 'C'], ['(a) açılış 2 dk', '(a) launch 2 min', (r) => r.ss.includes('a')], ['(c) sıradan havuz', '(c) established pool', (r) => r.ss.includes('c')], ['elle+belirsiz (bot hariç)', 'manual+ambiguous (bots excluded)', (r) => r.cls !== 'bot'], ['k=1 ve k=3 aynı grup', 'k=1 and k=3 same group', Object.assign((r) => true, { agree: true })], ['bot hariç ∩ k=1/k=3 aynı grup', 'bots excluded ∩ k=1/k=3 same group', Object.assign((r) => r.cls !== 'bot', { agree: true })]]) {
    const m = matched(bs, mode, ff); MT[`${mode}|${bs}|${key}`] = m;
    if (!m.est && m.est !== 0) { P(`| ${mn} | ${bs} | ${fn} | ${m.pairs} | insufficient |`); continue; }
    P(`| ${mn} | ${bs} | ${fn} | ${m.pairs} | ${m.obsN} / ${m.obsW} | ${f1(m.est, 2)} | ${f1(m.med, 2)} | ${f1(m.lo, 2)} … ${f1(m.hi, 2)} |`);
  }
}
// truncation: wide buys that filled within the tight cap (≤ 5% overpayment)
{
  const Wd = T.filter((r) => r.dec[2] >= 0.20 && r.o[2] != null), Nr = T.filter((r) => r.dec[2] <= 0.05 && r.o[2] != null);
  const tail = Wd.filter((r) => r.o[2] > 0.05);
  P(`\nTruncation check: tight buys n=${Nr.length} (o3 mean ${f1(mean(Nr.map((r) => r.o[2])), 2)}, median ${f1(q(Nr.map((r) => r.o[2]), .5), 2)}); wide buys n=${Wd.length} (mean ${f1(mean(Wd.map((r) => r.o[2])), 2)}, median ${f1(q(Wd.map((r) => r.o[2]), .5), 2)}); wide buys with o3 ≤ 5% (below the tight cap) n=${Wd.length - tail.length}, mean ${f1(mean(Wd.filter((r) => r.o[2] <= 0.05).map((r) => r.o[2])), 2)}; ${(100 * tail.length / (Wd.length || 1)).toFixed(1)}% of wide buys filled with an overpayment above 5% (mean ${f1(mean(tail.map((r) => r.o[2])), 1)}, "accepted tail").`);
  P(`Sandwich share: tight ≤5%: ${f1(Nr.filter((r) => r.sw).length / (Nr.length || 1), 2)}, wide ≥20%: ${f1(Wd.filter((r) => r.sw).length / (Wd.length || 1), 2)}.`);
  J3.trunc = { nN: Nr.length, nW: Wd.length, tailShare: tail.length / (Wd.length || 1), tailMean: mean(tail.map((r) => r.o[2])) };
}

// ---- declared tolerance of sandwich victims
P('\n### Declared tolerance of sandwich victims (separable = same slot, same signer buy–sell; lower bound)');
const swV = T.filter((r) => r.sw);
P(`Victim (buy) count over all buys: ${ALL.filter((r) => r.sw).length} / ${ALL.length} (${f1(ALL.filter((r) => r.sw).length / ALL.length, 3)}); victims with a recoverable tolerance: ${swV.length}.`);
P('| declared tolerance bucket (Bitquery bucket) | buys (tolerance known) | victims | this sample /10,000 | Wilson 95% | Bitquery bucket /10,000 (earlier report) |'); P('|---|---|---|---|---|---|');
const wil = (k, n) => { if (!n) return [null, null]; const z = 1.96, p = k / n; const den = 1 + z * z / n; const c = p + z * z / (2 * n); const h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - h) / den, (c + h) / den]; };
for (const [nm, lo, hi, bq] of [['≤3%', -9, 0.03, 8], ['3–10%', 0.03, 0.10, 44], ['10–20%', 0.10, 0.20, 87], ['>20%', 0.20, 99, 148], ['>20% and ≤50%', 0.20, 0.50, ''], ['>50%', 0.50, 99, '']]) {
  const R = T.filter((r) => r.dec[2] > lo && r.dec[2] <= hi); const k = R.filter((r) => r.sw).length; const [a, b] = wil(k, R.length);
  P(`| ${nm} | ${R.length} | ${k} | ${((k / (R.length || 1)) * 1e4).toFixed(1)} | ${a == null ? '-' : (a * 1e4).toFixed(1)}–${b == null ? '-' : (b * 1e4).toFixed(1)} | ${bq} |`);
}
{ const k = swV.length; P(`Victims' declared tolerance median ${f1(q(swV.map((r) => Math.max(r.dec[2], 0)), .5))} [quartiles ${f1(q(swV.map((r) => Math.max(r.dec[2], 0)), .25))}–${f1(q(swV.map((r) => Math.max(r.dec[2], 0)), .75))}], median among non-sandwiched buys ${f1(q(T.filter((r) => !r.sw).map((r) => Math.max(r.dec[2], 0)), .5))}.`); }
// sandwich rate by situation
P('\nSandwich rate (per buy, all buys): ' + SITS.map(([s, , l]) => { const R = selS(ALL, s); return `${l} ${f1(R.filter((r) => r.sw).length / (R.length || 1), 2)} (n=${R.length})`; }).join('; '));

// ================= PART 4
P('\n## Part 4 · Cost of a buy that failed on slippage');
const F = FL.filter((f) => f.slip);
P(`Transactions with a failed buy: ${FL.length}; of these, failed with a slippage error (pump 6002/6042, PumpSwap 6004/6040): ${F.length} (${f1(F.length / (FL.length || 1))}).`);
P(`Of these, failed directly in the pump/PumpSwap instruction (error code from that program): ${F.filter((f) => f.direct).length}; failed inside another program (router/bot): ${F.filter((f) => !f.direct).length} (same code, but 6xxx codes can collide across programs: upper bound).`);
const fc = {}; for (const f of FL) { const k = `${f.ep}:${f.er}`; fc[k] = (fc[k] || 0) + 1; } P('Failure code distribution (top 8): ' + Object.entries(fc).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, c]) => `${k} → ${c}`).join(', '));
P('\nBuys per window: successful buys / failed buys (slippage) / failure rate');
for (const id of ids) { const s = ALL.filter((r) => r.w === id).length, f = F.filter((x) => x.w === id).length; P(`- ${id}: ${s} / ${f} / ${f1(f / (s + f))}`); }
function feeTable(title, subs) {
  P(`\n### ${title}`);
  P('| group | n | base fee $ mean | priority fee $ median / p90 | total fee $ median / p90 / mean | declared Jito tip | priority fee > 0 | base fee share of total (median) |'); P('|---|---|---|---|---|---|---|---|');
  for (const [nm, f] of subs) {
    const R = F.filter(f); if (R.length < 20) { P(`| ${nm} | ${R.length} | insufficient |`); continue; }
    const base = R.map((x) => usd(5000 * x.ns, x.w)), pr = R.map((x) => usd(x.prio, x.w)), tot = R.map((x) => usd(x.fee, x.w));
    P(`| ${nm} | ${R.length} | ${mean(base).toFixed(5)} | ${q(pr, .5).toFixed(5)} / ${q(pr, .9).toFixed(5)} | ${q(tot, .5).toFixed(5)} / ${q(tot, .9).toFixed(5)} / ${mean(tot).toFixed(5)} | ${f1(R.filter((x) => x.tipDecl > 0).length / R.length)} | ${f1(R.filter((x) => x.prio > 0).length / R.length)} | ${f1(q(R.map((x) => (5000 * x.ns) / x.fee), .5))} |`);
  }
}
feeTable('Fee of a failed (slippage) buy, by situation and class (combined)', [['all', () => true], ...SITS.map(([s, , l]) => [l, (f) => f.ss.includes(s)]), ['situation unknown (other venue)', (f) => !f.ss.length], ['manual-like', (f) => f.cls === 'man'], ['ambiguous', (f) => f.cls === 'amb'], ['bot-like', (f) => f.cls === 'bot'], ['manual ∩ router/terminal', (f) => f.cls === 'man' && f.term], ['manual ∩ no router', (f) => f.cls === 'man' && !f.term], ['pump curve (P)', (f) => f.pr === 'P'], ['PumpSwap (A)', (f) => f.pr === 'A'], ['manual ∩ a launch', (f) => f.cls === 'man' && f.ss.includes('a')], ['manual ∩ b transition', (f) => f.cls === 'man' && f.ss.includes('b')], ['manual ∩ c established', (f) => f.cls === 'man' && f.ss.includes('c')], ['manual ∩ d top-10', (f) => f.cls === 'man' && f.ss.includes('d')]]);
for (const id of ids) feeTable(`${id}: fee of a failed (slippage) buy`, [['all', (f) => f.w === id], ['manual-like', (f) => f.w === id && f.cls === 'man']]);
P('\nFee structure of the successful buys for comparison (total fee of successful buys $, median / p90): ' + ids.map((id) => { const R = ALL.filter((r) => r.w === id && r.fee != null); return `${id} ${usd(q(R.map((r) => r.fee), .5), id).toFixed(5)} / ${usd(q(R.map((r) => r.fee), .9), id).toFixed(5)}`; }).join('; '));
P('\nFailed-buy share by class (failed / (failed + successful), per buy): ' + ['man', 'amb', 'bot'].map((c) => { const s = ALL.filter((r) => r.cls === c).length, f = F.filter((x) => x.cls === c).length; return `${c}: ${f1(f / (s + f))} (${f}/${s + f})`; }).join('; '));
P('\nPer manual-like signer: mean failed tries (signers with a failed buy): ' + (() => { const m = new Map(); for (const x of F.filter((x) => x.cls === 'man')) m.set(x.w + x.f, (m.get(x.w + x.f) || 0) + 1); const a = [...m.values()]; return `${a.length} signers, mean ${mean(a)?.toFixed(2)}, median ${q(a, .5)}, p90 ${q(a, .9)}`; })());

fs.writeFileSync(dataPath('report-tables.md'), out.join('\n'));
fs.writeFileSync(dataPath('report.json'), JSON.stringify({ J1, J2, J2d, J3, MT }, null, 1));
console.log(out.join('\n'));
