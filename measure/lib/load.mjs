// Loads compact block files (b_<slot>.json written by fetch-blocks.mjs) and builds per-venue trade lists
// (venue = bonding curve "C:<mint>" or PumpSwap pool "A:<pool>").
// loadForRows  = former load3.mjs (second measurement: keeps the tx record, signer stats, missing-block count).
// loadForModes = former load.mjs  (mode measurement on the first window).
// loadTransitionSample = former loadB() in load.mjs (the (b2) post-migration sample of the first measurement).
import fs from 'node:fs';
import path from 'node:path';
import { dataPath, fail } from './config.mjs';

const SYS = '11111111111111111111111111111111';

function blockDir(dirName, hint) {
  const dir = dataPath(dirName);
  if (!fs.existsSync(dir)) fail(`block folder not found: ${dir}\n  run first: ${hint}`);
  return dir;
}

export function loadForRows(dirName, a, b, hint = 'node fetch-blocks.mjs --window <W>') {
  const dir = blockDir(dirName, hint);
  const venues = new Map(); const creates = []; const migs = []; const slotInfo = new Map(); const fails = [];
  const sg = new Map(), pgSig = new Map(), xfSig = new Map();

  const push = (k, tr) => { let v = venues.get(k); if (!v) { v = { key: k, tr: [] }; venues.set(k, v); } v.tr.push(tr); };
  let nb = 0, skipped = 0, missing = 0;
  for (let s = a; s <= b; s++) {
    const f = path.join(dir, `b_${s}.json`); if (!fs.existsSync(f)) { missing++; continue; }
    const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (j.skip) { skipped++; continue; }
    nb++; slotInfo.set(s, { bt: j.bt, n: j.n });
    for (const t of j.tx) {
      t.slot = s;
      // signer stats: tx count, max tx in one slot, tip count, buy-instruction count; programs and fee transfers by signer
      { let g = sg.get(t.f); if (!g) { g = { n: 0, ls: -1, c: 0, mx: 0, tip: 0, fl: 0 }; sg.set(t.f, g); } g.n++; if (g.ls === s) g.c++; else { g.ls = s; g.c = 1; } if (g.c > g.mx) g.mx = g.c; if (t.tip) g.tip++; if (t.bx) g.fl++;
        for (const p of t.pg || []) { let z = pgSig.get(p); if (!z) { z = new Set(); pgSig.set(p, z); } z.add(t.f); }
        for (const [to] of t.xf || []) { let z = xfSig.get(to); if (!z) { z = new Set(); xfSig.set(to, z); } z.add(t.f); } }
      for (const m of t.cr || []) creates.push({ slot: s, idx: t.i, mint: m });
      for (const m of t.mg || []) migs.push({ slot: s, idx: t.i, mint: m, pools: t.cp || [] });
      if (!t.ok) { for (const x of t.bx || []) fails.push({ slot: s, idx: t.i, tx: t, ...x }); continue; }
      const trs = [];
      for (const e of t.ev || []) {
        if (e.q && e.q !== SYS) continue; // non-SOL quote
        const S1 = e.vs, T1 = e.vt; if (!(S1 > 0 && T1 > 0)) continue;
        const S0 = e.b ? S1 - e.sol : S1 + e.sol, T0 = e.b ? T1 + e.tok : T1 - e.tok;
        trs.push({ k: 'C:' + e.m, mint: e.m, slot: s, idx: t.i, f: t.f, u: e.u, buy: e.b, S0, T0, S1, T1, dS: e.sol, dT: e.tok, ix: e.ix, feeR: e.sol > 0 ? ((e.fee || 0) + (e.cfee || 0)) / e.sol : 0, tx: t.bx ? t : null });
      }
      for (const [p, x] of Object.entries(t.pl || {})) {
        if (x.t0 == null || x.t1 == null || x.s0 == null || x.s1 == null) { if (x.s1 && x.t1) trs.push({ k: 'A:' + p, mint: x.m, slot: s, idx: t.i, f: t.f, buy: null, S0: null, T0: null, S1: x.s1, T1: x.t1, dS: 0, dT: 0, init: true, tx: null }); continue; }
        if (x.t1 === x.t0) continue;
        const buy = x.t1 < x.t0;
        trs.push({ k: 'A:' + p, mint: x.m, slot: s, idx: t.i, f: t.f, u: t.f, buy, S0: x.s0, T0: x.t0, S1: x.s1, T1: x.t1, dS: Math.abs(x.s1 - x.s0), dT: Math.abs(x.t1 - x.t0), feeR: 0.003, tx: t.bx ? t : null });
      }
      for (const tr of trs) {
        const m = (t.bx || []).filter((x) => x.ref === (tr.k.slice(2)));
        if (m.length === 1 && trs.filter((y) => y.k === tr.k).length === 1) tr.bx = m[0];
        push(tr.k, tr);
      }
    }
  }
  for (const v of venues.values()) v.tr.sort((x, y) => x.slot - y.slot || x.idx - y.idx);
  return { venues, creates, migs, slotInfo, fails, sg, pgSig, xfSig, nb, skipped, missing };
}

export function loadForModes(dirName, a, b, hint = 'node fetch-blocks.mjs --window W1') {
  const dir = blockDir(dirName, hint);
  const venues = new Map(); const creates = []; const migs = []; const pcreate = []; const slotInfo = new Map(); const fails = []; const bxAll = [];
  const push = (k, tr) => { let v = venues.get(k); if (!v) { v = { key: k, tr: [] }; venues.set(k, v); } v.tr.push(tr); };
  let nb = 0, skipped = 0;
  for (let s = a; s <= b; s++) {
    const f = path.join(dir, `b_${s}.json`); if (!fs.existsSync(f)) continue;
    const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (j.skip) { skipped++; continue; }
    nb++; slotInfo.set(s, { bt: j.bt, n: j.n });
    for (const t of j.tx) {
      for (const m of t.cr || []) creates.push({ slot: s, idx: t.i, mint: m });
      for (const m of t.mg || []) migs.push({ slot: s, idx: t.i, mint: m, pools: t.cp || [] });
      for (const p of t.cp || []) pcreate.push({ slot: s, idx: t.i, pool: p });
      if (!t.ok) { for (const x of t.bx || []) fails.push({ slot: s, idx: t.i, er: t.er, ...x }); continue; }
      const trs = [];
      for (const e of t.ev || []) {
        if (e.q && e.q !== SYS) continue; // non-SOL quote
        const S1 = e.vs, T1 = e.vt; if (!(S1 > 0 && T1 > 0)) continue;
        const S0 = e.b ? S1 - e.sol : S1 + e.sol, T0 = e.b ? T1 + e.tok : T1 - e.tok;
        trs.push({ k: 'C:' + e.m, mint: e.m, slot: s, idx: t.i, f: t.f, u: e.u, buy: e.b, S0, T0, S1, T1, dS: e.sol, dT: e.tok, ix: e.ix });
      }
      for (const [p, x] of Object.entries(t.pl || {})) {
        if (x.t0 == null || x.t1 == null || x.s0 == null || x.s1 == null) { if (x.s1 && x.t1) trs.push({ k: 'A:' + p, mint: x.m, slot: s, idx: t.i, f: t.f, buy: null, S0: null, T0: null, S1: x.s1, T1: x.t1, dS: 0, dT: 0, init: true }); continue; }
        if (x.t1 === x.t0) continue;
        const buy = x.t1 < x.t0;
        trs.push({ k: 'A:' + p, mint: x.m, slot: s, idx: t.i, f: t.f, u: t.f, buy, S0: x.s0, T0: x.t0, S1: x.s1, T1: x.t1, dS: Math.abs(x.s1 - x.s0), dT: Math.abs(x.t1 - x.t0) });
      }
      for (const x of t.bx || []) bxAll.push({ slot: s, idx: t.i, ...x });
      for (const tr of trs) {
        const m = (t.bx || []).filter((x) => x.ref === (tr.k.slice(2)));
        if (m.length === 1 && trs.filter((y) => y.k === tr.k).length === 1) tr.bx = m[0];
        push(tr.k, tr);
      }
    }
  }
  for (const v of venues.values()) v.tr.sort((x, y) => x.slot - y.slot || x.idx - y.idx);
  return { venues, creates, migs, pcreate, slotInfo, fails, bxAll, nb, skipped };
}

// (b2) sample: post-migration trades of candidate pools (<bpDir>/<pool>/b_<slot>.json), loaded per pool,
// listed in <metaFile> as [{ pool, mint, mig, minSlot, maxSlot }].
export function loadTransitionSample(metaFile, bpDir) {
  const hint = 'the (b2) sample comes from the first measurement; its fetch script is not part of this folder (see README, "Limits")';
  if (!fs.existsSync(dataPath(metaFile))) fail(`transition sample not found: ${dataPath(metaFile)}\n  ${hint}`);
  const metas = JSON.parse(fs.readFileSync(dataPath(metaFile), 'utf8'));
  const all = { venues: new Map(), creates: [], migs: [], pcreate: [], slotInfo: new Map(), fails: [], bxAll: [], nb: 0, skipped: 0, metas };
  for (const m of metas) {
    const D = loadForModes(path.join(bpDir, m.pool), m.minSlot, m.maxSlot, hint);
    for (const [k, v] of D.venues) if (k === 'A:' + m.pool) { v.endSlot = m.maxSlot; all.venues.set(k, v); }
    for (const [s, x] of D.slotInfo) all.slotInfo.set(s, x);
    all.migs.push({ slot: m.mig, mint: m.mint, pools: [m.pool] });
    all.nb += D.nb;
  }
  return all;
}
