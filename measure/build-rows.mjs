// Second measurement: per-window buy rows (rows_<W>.json) from the window's block files. Formerly build3.mjs.
// For every successful buy: situation (a/b/c/d), declared vs needed tolerance (quote k = 1..4 slots earlier),
// separable sandwich flag, signer class, fees, and the ladder simulation (anchor = the buy's post-trade state).
// Failed buys (fl) are listed separately with their error code, fees and declared Jito tip.
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { loadForRows } from './lib/load.mjs';
import { dataPath, getWindow, usageExit, fail } from './lib/config.mjs';

const USAGE = `Usage: node --max-old-space-size=10000 build-rows.mjs --window <W1|W2|W3> [--to <slot>]
  --to   cut the window at this end slot (inclusive), for partial data.
Reads <data>/<dir>/b_<slot>.json and <data>/pool_age_<w>.json (W1 falls back to <data>/pool_age.json);
writes <data>/rows_<W>.json.
Env: DIR (block folder override), AGE (pool-age file), OUT (output file); relative paths are under the data folder.`;
const { values: opt } = parseArgs({ options: { window: { type: 'string' }, to: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
if (opt.help) usageExit(USAGE, 0);
if (!opt.window) usageExit(USAGE);

const W = getWindow(opt.window);
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', AMM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const JUP = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', LH = 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95';
const SHARED_MIN = 25; // a program/account used by this many distinct signers is "shared" (not a private bot program)

const dirOverride = process.env.DIR; if (dirOverride) W.dir = dirOverride;
const bEnd = opt.to ? Number(opt.to) : W.b;
const D = loadForRows(W.dir, W.a, bEnd, `node fetch-blocks.mjs --window ${W.id}`);
console.log(W.id, 'blocks', D.nb, 'skipped', D.skipped, 'missing', D.missing, 'venues', D.venues.size, 'signers', D.sg.size);

const X100 = Math.round((100 / W.sol) * 1e9);
const V = [...D.venues.values()];
for (const v of V) {
  v.slots = v.tr.map((t) => t.slot);
  v.volume = v.tr.reduce((s, t) => s + (t.dS || 0), 0);
  let bad = 0, tot = 0;
  for (let i = 1; i < v.tr.length; i++) { const p = v.tr[i - 1], t = v.tr[i]; if (t.S0 == null) continue; tot++; if (Math.abs(t.S0 - p.S1) / p.S1 > 0.003) bad++; }
  v.dyn = v.key[0] === 'C' && tot >= 3 && bad / tot > 0.15; // "dynamic" curve: consecutive states often do not chain
}
const vmap = new Map(V.map((v) => [v.key, v]));
const stateAt = (v, L) => { let lo = 0, hi = v.slots.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (v.slots[m] <= L) { r = m; lo = m + 1; } else hi = m - 1; } return r < 0 ? null : v.tr[r]; };
const bt = (s) => { const x = D.slotInfo.get(s); if (x) return x.bt; let d = 1; while (d < 200) { const y = D.slotInfo.get(s - d) || D.slotInfo.get(s + d); if (y) return y.bt; d++; } return 0; };
const createSlot = new Map(D.creates.map((c) => [c.mint, c.slot]));
const migSlot = new Map(); for (const m of D.migs) for (const p of m.pools) migSlot.set('A:' + p, m.slot);
const ageFile = dataPath(process.env.AGE || `pool_age_${W.id.toLowerCase()}.json`);
let ageOk;
if (fs.existsSync(ageFile)) ageOk = JSON.parse(fs.readFileSync(ageFile));
else if (W.id === 'W1') {
  const legacy = dataPath('pool_age.json');
  if (!fs.existsSync(legacy)) fail(`pool-age file not found: ${ageFile} (or ${legacy})\n  run first: node pool-age.mjs --window W1`);
  ageOk = JSON.parse(fs.readFileSync(legacy));
} else ageOk = {};
if (!Object.keys(ageOk).length) console.log('WARNING: no pool-age file, situation (c) stays empty');
const topSet = new Set(V.filter((v) => v.key[0] === 'A').sort((a, b) => b.volume - a.volume).slice(0, 10).map((v) => v.key));
// Situations: (a) curve <= 120 s after create; (b) pool <= 300 s after migration; (c) old pool outside the top 10; (d) top-10 pools by SOL volume.
function sitKey(key, mint, L0) {
  const out = [];
  if (key[0] === 'C') { const c = createSlot.get(mint); if (c != null && L0 >= c && bt(L0) - bt(c) <= 120) out.push('a'); }
  else {
    const m = migSlot.get(key); if (m != null && L0 >= m && bt(L0) - bt(m) <= 300) out.push('b');
    if (ageOk[key.slice(2)] === true && !topSet.has(key)) out.push('c');
    if (topSet.has(key)) out.push('d');
  }
  return out;
}

// ---- signer class
const sharedPg = (p) => (D.pgSig.get(p)?.size || 0) >= SHARED_MIN;
const sharedXf = (p) => (D.xfSig.get(p)?.size || 0) >= 40;
function classify(f, txs) { // txs: this signer's record for this buy (for the program list), optional
  const g = D.sg.get(f); if (!g) return { cls: 'amb' };
  const pg = (txs?.pg || []).filter((p) => p !== PUMP && p !== AMM);
  const custom = pg.some((p) => !sharedPg(p));
  const router = pg.some((p) => sharedPg(p) && p !== JUP && p !== LH);
  const feeXf = (txs?.xf || []).some(([to]) => sharedXf(to));
  const term = router || feeXf;
  let cls;
  if (g.n >= 10 || g.mx >= 2 || custom) cls = 'bot';
  else if (g.n <= 3) cls = 'man';
  else cls = 'amb';
  return { cls, term, lh: pg.includes(LH), jup: pg.includes(JUP), custom, n: g.n, mx: g.mx };
}

// ---- buy rows
const q = (n) => n;
const effp = (S, T, X) => (S + X) / T;
const cost = (S, T, d) => (T > d ? (S * d) / (T - d) : null);
const rows = [];
const lastOf = bEnd - 20;
const swVictims = new Set();
for (const v of V) {
  const bySlot = new Map();
  for (const t of v.tr) { if (!bySlot.has(t.slot)) bySlot.set(t.slot, []); bySlot.get(t.slot).push(t); }
  for (const t of v.tr) {
    if (t.buy !== true || t.S0 == null || !(t.dT > 0) || !(t.dS > 0) || t.slot < W.a + 4) continue;
    const ssl = sitKey(v.key, t.mint, t.slot);
    const r = { v: v.key, kd: v.key[0], slot: t.slot, idx: t.idx, f: t.f, sol: t.dS / 1e9, usd: (t.dS / 1e9) * W.sol, ss: ssl, dyn: v.dyn ? 1 : 0 };
    // realised (o) / needed (req) / declared (dec), against the state k = 1..4 slots earlier
    r.o = []; r.req = []; r.dec = []; r.ex = null;
    const bx = t.bx;
    let typ = null;
    if (bx && /exact/.test(bx.n) && bx.a1 >= 0.95 * t.dS && bx.a1 <= 1.25 * t.dS && bx.a2 > 0 && bx.a2 <= t.dT * 1.0001) typ = 'ex';
    else if (bx && !/exact/.test(bx.n) && Math.abs(bx.a1 - t.dT) / t.dT < 0.02 && bx.a2 > 0) typ = 'mc';
    r.typ = typ; r.bxn = bx ? bx.n : null; if (bx && !typ) r.rb = [bx.a1, bx.a2, t.dS, t.dT]; r.lxp = t.T0 > t.dT ? Math.round(Math.log(t.S0 / (t.T0 - t.dT)) * 1e6) / 1e6 : null;
    const fr = t.feeR || 0;
    for (const k of [1, 2, 3, 4]) {
      const ref = stateAt(v, t.slot - k);
      if (!ref || !(t.dT < 0.3 * t.T0) || !(t.dT < 0.3 * ref.T1)) { r.o.push(null); r.req.push(null); r.dec.push(null); continue; }
      const c0 = cost(t.S0, t.T0, t.dT), c1 = cost(ref.S1, ref.T1, t.dT);
      r.o.push(c0 && c1 ? c0 / c1 - 1 : null);
      if (typ === 'ex') { const qtok = (ref.T1 * t.dS) / (ref.S1 + t.dS); r.req.push(1 - t.dT / qtok); r.dec.push(1 - bx.a2 / qtok); }
      else if (typ === 'mc') { const tot1 = c1 * (1 + fr); const totE = t.dS * (1 + fr); r.req.push(c1 ? totE / tot1 - 1 : null); r.dec.push(tot1 ? bx.a2 / tot1 - 1 : null); }
      else { r.req.push(null); r.dec.push(null); }
    }
    r.head = typ === 'ex' ? 1 - bx.a2 / t.dT : typ === 'mc' ? bx.a2 / (t.dS * (1 + fr)) - 1 : null;
    // sandwich: another signer's buy earlier in the same slot, followed by that signer's sell after this buy
    const sl = bySlot.get(t.slot); let sw = 0;
    for (const a of sl) { if (a.idx >= t.idx || a.buy !== true || a.f === t.f) continue; for (const c of sl) { if (c.idx > t.idx && c.buy === false && (c.f === a.f || (a.u && c.u === a.u))) { sw = 1; break; } } if (sw) break; }
    r.sw = sw;
    // signer class, fees
    const tx = t.tx; const c = classify(t.f, tx);
    r.cls = c.cls; r.term = c.term ? 1 : 0; r.lh = c.lh ? 1 : 0; r.jup = c.jup ? 1 : 0; r.custom = c.custom ? 1 : 0; r.sn = c.n; r.smx = c.mx;
    r.tip = tx ? (tx.tip || 0) + ((tx.xf || []).filter(([to]) => to === '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT').reduce((s, x) => s + x[1], 0)) : 0;
    r.pr = tx ? tx.pr : null; r.fee = tx ? tx.fee : null;
    // anchor: ladder simulation from the buy's post-trade state; landing delay d = 2,3,4; X = $100 and the buy's own amount
    if (t.slot <= lastOf && t.S1 > 0 && t.T1 > 0 && !(v.slots.length < 1)) {
      const Xo = Math.max(t.dS, 1e6);
      r.lad = {}; r.ladO = [];
      for (const d of [2, 3, 4]) {
        const ks = [];
        for (let k = 1; k <= 3; k++) { const sk = stateAt(v, t.slot + 4 * (k - 1) + d); ks.push(effp(sk.S1, sk.T1, X100) / effp(t.S1, t.T1, X100)); }
        r.lad['d' + d] = ks.map((x) => Math.round(x * 1e5) / 1e5);
      }
      for (let k = 1; k <= 3; k++) { const sk = stateAt(v, t.slot + 4 * (k - 1) + 3); r.ladO.push(Math.round((effp(sk.S1, sk.T1, Xo) / effp(t.S1, t.T1, Xo)) * 1e5) / 1e5); }
      r.anc = 1;
    }
    rows.push(r);
  }
}
// ---- failed buys
const SLIP = { P: new Set([6002, 6042]), A: new Set([6004, 6040]) }; // slippage error codes: pump / PumpSwap
const fl = [];
for (const x of D.fails) {
  const t = x.tx; const exact = /exact/.test(x.n);
  const key = (x.pr === 'A' ? 'A:' : 'C:') + x.ref;
  const mint = x.pr === 'A' ? (vmap.get(key)?.tr[0]?.mint) : x.ref;
  const c = classify(t.f, t);
  fl.push({ slot: x.slot, f: t.f, pr: x.pr, n: x.n, er: t.er, ep: t.ep, slip: (x.pr === 'P' && SLIP.P.has(t.er)) || (x.pr === 'A' && SLIP.A.has(t.er)) ? 1 : 0, direct: t.ep === x.pr ? 1 : 0, fee: t.fee, ns: t.ns, prio: t.pr, tipDecl: (t.tip || 0) + ((t.xf || []).filter(([to]) => to === '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT').reduce((s, y) => s + y[1], 0)), amt: exact ? x.a1 : x.a2, exact: exact ? 1 : 0, ss: sitKey(key, mint, x.slot), cls: c.cls, term: c.term ? 1 : 0, sig: t.s });
}
const meta = { W, nb: D.nb, skipped: D.skipped, missing: D.missing, nVenues: V.length, nSigners: D.sg.size, topSet: [...topSet], nCreate: D.creates.length, nMig: D.migs.length, nDyn: V.filter((v) => v.dyn).length, X100, sharedPg: [...D.pgSig].filter(([, s]) => s.size >= SHARED_MIN).map(([p, s]) => [p, s.size]).sort((a, b) => b[1] - a[1]).slice(0, 40), sharedXf: [...D.xfSig].filter(([, s]) => s.size >= 40).map(([p, s]) => [p, s.size]).sort((a, b) => b[1] - a[1]).slice(0, 30) };
const outName = dataPath(process.env.OUT || `rows_${W.id}.json`);
fs.writeFileSync(outName, JSON.stringify({ meta, rows, fl }));
console.log('rows', rows.length, 'anchors', rows.filter((r) => r.anc).length, 'failed buys', fl.length, 'saved', outName);
const cnt = {}; for (const r of rows) for (const s of r.ss) cnt[s] = (cnt[s] || 0) + 1; console.log('situation counts', JSON.stringify(cnt));
const cc = {}; for (const r of rows) cc[r.cls] = (cc[r.cls] || 0) + 1; console.log('class', JSON.stringify(cc));
