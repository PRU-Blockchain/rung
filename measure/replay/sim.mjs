// Stage 4: replay every real buy in the scenario windows against fixed slippage, the buyer's own
// typed slippage and the Rung ladder; write results/replay-<date>.json and .md.
//
//   node sim.mjs [--date 2026-11-24]
//
// Model (also printed in the "Method and limits" section):
//  - Each real buy B is "a user who wanted to buy at that moment", spending B's own total (SOL into the venue + fees).
//  - The user saw the venue at the end of slot (B.slot - k), k = quote age in slots (1, 3, 5).
//  - The fixed-slippage buy and Rung's order land exactly where B landed in the real tape (state just before B).
//  - Fixed X%: one transaction; fills if tokens obtainable there >= seen / (1 + X).
//  - Rung: the order records start = floor(seen * raw_now / raw_seen) where it lands (open_order, quote.ts).
//    Try i lands at slot B.slot + d + 4*i (d = first-try latency: 1, 3, 5, and 9 for the old sender), against
//    the venue state at the start of that slot. min = max(seen/(1+cap), start/(1+rung_i)) (math.rs);
//    the first try whose obtainable tokens reach min fills; none -> "not bought".
//  - Each counterfactual buy is replayed alone: the tape is not changed.
import fs from 'node:fs';
import path from 'node:path';
import { CACHE_DIR, REPLAY_DIR } from './lib/rpc.mjs';
import { rawQuote, quoteAfterFees, minTokensAt, minTokensForRung, expectedTokensStart, spot } from './lib/curve.mjs';

const args = process.argv.slice(2);
const DATE = args.includes('--date') ? args[args.indexOf('--date') + 1] : '2026-11-24';
const K_LIST = [1, 3, 5];
const D_LIST = [1, 3, 5, 9];
const K_MAIN = 3, D_MAIN = 5;
const FIXED = { 'Fixed 1%': 100, 'Fixed 3%': 300, 'Fixed 5%': 500, 'Fixed 10%': 1000, 'Fixed 20%': 2000, 'Fixed 25%': 2500 };
const RUNG = {
  'Rung Tight 1/2/3': [100, 200, 300],
  'Rung Normal 2/3/5': [200, 300, 500],
  'Rung Fast 5/10/15': [500, 1000, 1500],
  'Rung Launch 10/20/30': [1000, 2000, 3000],
  'Rung Custom 1/2/3/5/8': [100, 200, 300, 500, 800],
};
const SCEN = { S1: 'Hyped launch', S2: 'Volatile, not the launch', S3: 'Calm' };
const STRATS = [...Object.keys(FIXED), ...Object.keys(RUNG)];
// Extra rows for the "Bolder ladders and shorter waits" section (not in the main tables).
const FIXED_X = { 'Fixed 30%': 3000, 'Fixed 35%': 3500, 'Fixed 50%': 5000 };
const WINDOW_MAIN = 4; // slots between rungs in the app
const RUNG_X = {
  'Rung 15/25/35/50': [1500, 2500, 3500, 5000],
  'Rung 10/20/30/50': [1000, 2000, 3000, 5000],
  'Rung 20/35/50': [2000, 3500, 5000],
  'Rung 5/10/20/30/50': [500, 1000, 2000, 3000, 5000],
  // within the deployed program's limits (MAX_CAP_BPS = 3000, MAX_RUNGS = 5)
  'Rung 5/10/20/30': [500, 1000, 2000, 3000],
  'Rung 5/10/15/20/30': [500, 1000, 1500, 2000, 3000],
};
const WINDOW_VARIANTS = [1, 2];
const WINDOW_BASE = { 'Rung Tight 1/2/3': RUNG['Rung Tight 1/2/3'], 'Rung Fast 5/10/15': RUNG['Rung Fast 5/10/15'], 'Rung Launch 10/20/30': RUNG['Rung Launch 10/20/30'], 'Rung 15/25/35/50': RUNG_X['Rung 15/25/35/50'] };
// every ladder evaluated: name -> { rungs, window }
const LADDERS = {};
for (const [n, r] of Object.entries(RUNG)) LADDERS[n] = { rungs: r, window: WINDOW_MAIN };
for (const [n, r] of Object.entries(RUNG_X)) LADDERS[n] = { rungs: r, window: WINDOW_MAIN };
for (const [n, r] of Object.entries(WINDOW_BASE)) for (const w of WINDOW_VARIANTS) LADDERS[`${n} (wait ${w})`] = { rungs: r, window: w };
const FIXED_ALL = { ...FIXED, ...FIXED_X };
const STRATS_ALL = [...Object.keys(FIXED_ALL), ...Object.keys(LADDERS)];
const ck = (k, d) => `k${k}d${d}`;

const B = (x) => BigInt(x);
const q = (arr, p) => { const a = arr.filter((x) => x != null && Number.isFinite(x)); if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const pct = (x, dd = 1) => (x == null || !Number.isFinite(x) ? '–' : (100 * x).toFixed(dd) + '%');
const f2 = (x, dd = 2) => (x == null || !Number.isFinite(x) ? '–' : x.toFixed(dd));
const short = (m) => m.slice(0, 4) + '…' + m.slice(-4);

const tapeDir = path.join(CACHE_DIR, 'tape2');
const files = fs.existsSync(tapeDir) ? fs.readdirSync(tapeDir).filter((f) => f.endsWith('.json')).sort() : [];
const grads = fs.existsSync(path.join(CACHE_DIR, 'graduates.json')) ? JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'graduates.json'), 'utf8')) : {};
const ataRank = fs.existsSync(path.join(CACHE_DIR, 'ata-rank.json')) ? JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'ata-rank.json'), 'utf8')) : {};
const disc = fs.existsSync(path.join(CACHE_DIR, 'discover.json')) ? JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'discover.json'), 'utf8')) : {};

const rows = []; // one per real buy: { scen, seg, mint, spendSol, own, res: { [k d]: { [strategy]: result } }, later }
const segRows = [];
const excluded = [];
const sandwiches = [];
const validation = { curve: [], poolExactIn: [], poolMaxCost: [], curveMaxCost: [] };

for (const file of files) {
  const tp = JSON.parse(fs.readFileSync(path.join(tapeDir, file), 'utf8'));
  const T = tp.tape;
  const scen = tp.scenario;
  if (tp.nonSolQuote) { excluded.push({ id: tp.id, scenario: scen, mint: tp.mint, why: 'curve quoted in a token other than SOL (Rung buys with SOL)' }); continue; }
  const sr = {
    id: tp.id, scenario: scen, venue: tp.venue, mint: tp.mint, from: tp.from, to: tp.to, truncatedAt: tp.truncatedAt, okInWindow: tp.okInWindow, failedInWindow: tp.failedInWindow,
    slipFailedInWindow: tp.slipFailedInWindow, trades: T.length, buys: 0, txMissing: tp.txMissing, slots: tp.slots, multiTxSlots: tp.multiTxSlots, slotsChained: tp.slotsChained,
    slotsFallback: tp.slotsFallback, idxDisagree: tp.idxDisagree, tapeGaps: tp.tapeGaps, rank: tp.rank, gridPoints: tp.grid.length,
    blockMode: !!tp.blockMode, blocks: tp.blocks, txTouchingCurve: tp.txTouchingCurve, txFailedInBlocks: tp.txFailed, sampleTrades: tp.sampleTrades, sampleNoTrade: tp.sampleNoTrade,
    evChecked: tp.evChecked, evTokExact: tp.evTokExact, evVsMaxRel: tp.evVsMaxRel, kSpread: tp.kSpread, txNoTrade: tp.txNoTrade,
    slotsWithTrades: tp.slotsWithTrades,
    contigTrades: tp.sparse ? T.filter((x) => x.slot <= tp.contigLastSlot).length : T.length,
  };
  segRows.push(sr);
  if (!T.length) continue;
  const aft = T.map((x) => ({ vs: B(x.vs), vt: B(x.vt) }));
  const bef = T.map((x) => ({ vs: B(x.vs0), vt: B(x.vt0) }));
  const initial = bef[0];
  const lastIdxAtOrBefore = (s) => { let lo = 0, hi = T.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (T[m].slot <= s) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
  const endOfSlot = (s) => { const i = lastIdxAtOrBefore(s); return i < 0 ? initial : aft[i]; };
  const startOfSlot = (s) => endOfSlot(s - 1);
  const completeIdx = T.findIndex((x) => x.rt === 0);
  const completeBeforeSlot = (s) => completeIdx >= 0 && T[completeIdx].slot < s;
  const lastSlot = T.at(-1).slot;
  // price at a time: tape (fully fetched part) then the grid
  const pricePoints = [...T.map((x, i) => ({ t: x.t, p: spot(aft[i]), done: x.rt === 0 })), ...tp.grid.map((g) => ({ t: g.T, p: g.vs / g.vt, done: g.rt === 0 }))].sort((a, b) => a.t - b.t);
  const priceAt = (ts) => { let r = null; for (const pp of pricePoints) { if (pp.t <= ts) r = pp; else break; } return r; };
  // curve completion time: from a trade with real tokens 0 in the data, else the migration time of the token
  const migT = tp.venue === 'curve' && fs.existsSync(path.join(CACHE_DIR, 'atasigs', `${tp.mint}.json`)) ? JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'atasigs', `${tp.mint}.json`), 'utf8')).migrationT : null;
  const completedAtT = pricePoints.find((pp) => pp.done)?.t ?? migT;
  const dataEnd = Math.max(tp.gridTo ?? 0, T.at(-1).t);
  // window price range (measured): spot over the window from tape + grid
  const inWin = pricePoints.filter((pp) => pp.t >= tp.from && pp.t <= tp.to).map((pp) => pp.p);
  sr.priceRange = inWin.length ? Math.max(...inWin) / Math.min(...inWin) - 1 : null;
  const p0 = spot(initial);
  sr.priceStart = p0;
  sr.priceEnd = priceAt(tp.to)?.p ?? null;
  sr.priceChange = sr.priceEnd ? sr.priceEnd / p0 - 1 : null;
  sr.price60 = priceAt(tp.from + 60)?.p ? priceAt(tp.from + 60).p / p0 - 1 : null;
  sr.priceMax = inWin.length ? Math.max(...inWin) / p0 - 1 : null;
  sr.completedInWindow = completedAtT != null && completedAtT <= tp.to;

  const buys = T.filter((x) => x.isBuy && !x.liq && x.t >= tp.from && x.t <= tp.to && x.spend > 0);
  sr.buys = buys.length;
  sr.buySol = buys.reduce((s, x) => s + x.spend, 0) / 1e9;
  sr.sellSol = T.filter((x) => !x.isBuy && !x.liq).reduce((s, x) => s + x.sol, 0) / 1e9;
  sr.fetchedSeconds = T.at(-1).t - tp.from;
  sr.slotSeconds = T.at(-1).slot > T[0].slot ? (T.at(-1).t - T[0].t) / (T.at(-1).slot - T[0].slot) : null;
  for (const x of buys) {
    const i = x.i;
    const A = B(x.spend);
    const fees = x.fees.map(B);
    const land = bef[i];
    const obtainNow = quoteAfterFees(A, land, fees);
    if (obtainNow <= 0n) continue;
    const rawNow = rawQuote(A, land);
    // reconstruction checks
    // reconstruction check on every buy: formula on the reconstructed state vs tokens actually received
    (tp.venue === 'curve' ? validation.curve : validation.poolExactIn).push(Number(obtainNow) / x.tok - 1);
    // own typed slippage: room it left at execution (measured: instruction bound vs what it got)
    let own = null;
    if (x.ix?.kind === 'exactIn') own = x.ix.a2 > 0 ? x.tok / x.ix.a2 - 1 : Infinity;
    else if (x.ix?.kind === 'maxCost') own = x.spend > 0 ? x.ix.a2 / x.spend - 1 : null;
    const r = { scen, seg: tp.id, mint: tp.mint, venue: tp.venue, sig: x.sig, spendSol: x.spend / 1e9, own, typedVsSeen: {}, res: {} };
    for (const k of K_LIST) {
      // the quote seen must come from fetched data: a window that does not start at the curve's creation
      // cannot say what the state was before its first slot
      if (!tp.createSeen && x.slot - k < T[0].slot) continue;
      const seenSt = endOfSlot(x.slot - k);
      const seen = quoteAfterFees(A, seenSt, fees);
      if (seen <= 0n) continue;
      const rawSeen = rawQuote(A, seenSt);
      // typed slippage measured against the quote the buyer saw (instruction bound vs seen quote)
      if (x.ix?.kind === 'exactIn') r.typedVsSeen[k] = x.ix.a2 > 0 ? Number(quoteAfterFees(B(x.ix.a1), seenSt, fees)) / x.ix.a2 - 1 : Infinity;
      else if (x.ix?.kind === 'maxCost') { const tk = B(x.ix.a1); if (tk < seenSt.vt) { const c = (tk * seenSt.vs) / (seenSt.vt - tk); const cf = Number(c) * (1 + x.fees.reduce((s, b) => s + b, 0) / 1e4); r.typedVsSeen[k] = x.ix.a2 / cf - 1; } }
      const fixedRes = {};
      for (const [name, bps] of Object.entries(FIXED_ALL)) {
        const min = minTokensAt(seen, bps);
        fixedRes[name] = obtainNow >= min
          ? { f: 1, paid: Number(seen) / Number(obtainNow) - 1, room: Number(obtainNow) / Number(min) - 1, roomSol: (x.spend * (1 - Number(min) / Number(obtainNow))) / 1e9 }
          : { f: 0 };
      }
      const start = expectedTokensStart(seen, rawSeen, rawNow);
      for (const d of D_LIST) {
        const res = { ...fixedRes };
        for (const [name, { rungs, window }] of Object.entries(LADDERS)) {
          const cap = rungs.at(-1);
          const capFloor = minTokensAt(seen, cap);
          let out = { f: 0, why: 'no rung filled' };
          for (let j = 0; j < rungs.length; j++) {
            const due = x.slot + d + window * j;
            if (completeBeforeSlot(due)) { out = { f: 0, why: 'curve completed' }; break; }
            if (due > lastSlot + 1) { out = { f: 0, why: 'beyond fetched data', unknown: true }; break; }
            const st = startOfSlot(due);
            const obtain = quoteAfterFees(A, st, fees);
            const min = minTokensForRung(seen, start, rungs[j], cap);
            if (obtain >= min) {
              out = {
                f: 1, rung: j, paid: Number(seen) / Number(obtain) - 1,
                room: Number(obtain) / Number(min) - 1, roomSol: (x.spend * (1 - Number(min) / Number(obtain))) / 1e9,
                roomAdv: Number(obtain) / Number(capFloor) - 1, roomSolAdv: (x.spend * (1 - Number(capFloor) / Number(obtain))) / 1e9,
              };
              break;
            }
          }
          res[name] = out;
        }
        r.res[ck(k, d)] = res;
      }
      if (k === K_MAIN && !fixedRes['Fixed 3%'].f) {
        const pSeen = spot(seenSt);
        r.later = {};
        for (const mnt of [1, 5, 10]) {
          const ts = x.t + 60 * mnt;
          if (completedAtT != null && completedAtT <= ts) {
            // the completing trade if it is in the data, else the last curve price known before completion
            const pp = pricePoints.find((z) => z.done) || priceAt(completedAtT);
            r.later[mnt] = pp ? { rel: pp.p / pSeen - 1, completed: true } : { beyond: true };
            continue;
          }
          if (ts > dataEnd + 20) { r.later[mnt] = { beyond: true }; continue; }
          const pp = priceAt(ts);
          r.later[mnt] = pp ? { rel: pp.p / pSeen - 1 } : { beyond: true };
        }
      }
    }
    rows.push(r);
  }

  // sandwiches (pattern search over the whole fully fetched tape)
  for (let i = 0; i < T.length - 2; i++) {
    const F = T[i];
    if (!F.isBuy || F.liq) continue;
    for (let m = 1; m <= 3 && i + m + 1 < T.length; m++) {
      const V = T.slice(i + 1, i + 1 + m);
      const S = T[i + m + 1];
      if (S.slot - F.slot > 1) break;
      if (tp.sparse && S.slot > tp.contigLastSlot) break; // only where every transaction was fetched
      if (!V.every((v) => v.isBuy && !v.liq && v.signer !== F.signer && v.user !== F.user && v.sig !== F.sig && v.spend > 0)) break;
      if (S.isBuy || S.liq) continue;
      const sameWallet = S.signer === F.signer || S.user === F.user;
      const tokMatch = Math.abs(S.tok - F.tok) / F.tok <= 0.01;
      if (!sameWallet && !tokMatch) continue;
      if (V.some((v) => v.sig === S.sig)) break;
      const pre = bef[i];
      const victims = V.map((v) => {
        const A = B(v.spend), fees = v.fees.map(B);
        const qPre = quoteAfterFees(A, pre, fees);
        const overFrac = 1 - v.tok / Number(qPre);
        let typedPre = null;
        if (v.ix?.kind === 'exactIn') typedPre = v.ix.a2 > 0 ? Number(quoteAfterFees(B(v.ix.a1), pre, fees)) / v.ix.a2 - 1 : Infinity;
        else if (v.ix?.kind === 'maxCost') { const tk = B(v.ix.a1); if (tk < pre.vt) { const c = Number((tk * pre.vs) / (pre.vt - tk)) * (1 + v.fees.reduce((s, b) => s + b, 0) / 1e4); typedPre = v.ix.a2 / c - 1; } }
        // Rung Tight 1/2/3: seen = pre-attack state; the order lands where the victim landed (after the push);
        // tries at victim slot + d + 4i.
        const land = bef[v.i];
        const seen = qPre, start = expectedTokensStart(seen, rawQuote(A, pre), rawQuote(A, land));
        const rungAt = {};
        for (const d of D_LIST) {
          let rr = { outcome: 'not bought' };
          for (let j = 0; j < 3; j++) {
            const due = v.slot + d + 4 * j;
            if (completeBeforeSlot(due)) break;
            if (due > lastSlot + 1) { rr = { outcome: 'unknown (beyond data)' }; break; }
            const ob = quoteAfterFees(A, startOfSlot(due), fees);
            if (ob >= minTokensForRung(seen, start, [100, 200, 300][j], 300)) { rr = { outcome: `rung ${j + 1}`, paidVsPre: Number(seen) / Number(ob) - 1 }; break; }
          }
          rungAt[d] = rr;
        }
        return {
          sig: v.sig, signer: v.signer, spendSol: v.spend / 1e9, overpaidFrac: overFrac, overpaidSol: (v.spend * overFrac) / 1e9, typedVsPre: typedPre,
          fixed1FromSeen: quoteAfterFees(A, land, fees) >= minTokensAt(seen, 100), rungTight: rungAt,
        };
      });
      sandwiches.push({
        scen, seg: tp.id, mint: tp.mint, venue: tp.venue, slot: F.slot, slotSpan: S.slot - F.slot, kind: sameWallet ? 'same wallet' : 'two wallets, matched amount',
        front: F.sig, back: S.sig, bot: F.signer, pushed: spot(aft[i]) / spot(pre) - 1, botInSol: F.spend / 1e9, botOutSol: S.sol / 1e9, victims,
      });
      i = i + m;
      break;
    }
  }
}

// ---------------- aggregation ----------------
function aggregate(list, key) {
  const n = list.length;
  const out = { n, spendSol: list.reduce((s, r) => s + r.spendSol, 0), strategies: {} };
  for (const name of STRATS_ALL) {
    // buys whose later tries would land past the fetched data are left out of that strategy/timing cell
    const all = list.map((r) => r.res[key]?.[name]).filter(Boolean);
    const rs = all.filter((x) => !x.unknown);
    const fills = rs.filter((x) => x.f);
    const unknown = all.length - rs.length;
    const o = { n: rs.length, fill: rs.length ? fills.length / rs.length : null, filled: fills.length, unknown };
    o.paid = { median: q(fills.map((x) => x.paid), 0.5), p90: q(fills.map((x) => x.paid), 0.9), mean: mean(fills.map((x) => x.paid)) };
    o.roomSol = fills.reduce((s, x) => s + x.roomSol, 0);
    o.roomMean = mean(fills.map((x) => x.room));
    o.roomMedian = q(fills.map((x) => x.room), 0.5);
    if (LADDERS[name]) {
      o.rungShare = LADDERS[name].rungs.map((_, j) => (rs.length ? fills.filter((x) => x.rung === j).length / rs.length : null));
      o.notBought = rs.length ? 1 - o.fill : null;
      o.curveCompleted = rs.filter((x) => x.why === 'curve completed').length;
      o.roomSolAdv = fills.reduce((s, x) => s + x.roomSolAdv, 0);
      o.roomMeanAdv = mean(fills.map((x) => x.roomAdv));
      const f0 = fills.filter((x) => x.rung === 0);
      o.firstTry = { filled: f0.length, fill: rs.length ? f0.length / rs.length : null, roomMean: mean(f0.map((x) => x.room)), roomSol: f0.reduce((s, x) => s + x.roomSol, 0) };
    }
    out.strategies[name] = o;
  }
  // own typed slippage: measured room at execution of the real buys
  const own = list.map((r) => r.own).filter((x) => x != null);
  const ownFin = own.filter((x) => Number.isFinite(x) && x < 0.99);
  const ownUnprot = list.filter((r) => r.own != null && (!Number.isFinite(r.own) || r.own >= 0.99));
  out.own = {
    decoded: own.length, roomMedian: q(ownFin, 0.5), roomMean: mean(ownFin), roomP90: q(ownFin, 0.9),
    roomSolProtected: list.filter((r) => r.own != null && Number.isFinite(r.own) && r.own < 0.99).reduce((s, r) => s + (r.spendSol * r.own) / (1 + r.own), 0),
    unprotected: ownUnprot.length, unprotectedSpendSol: ownUnprot.reduce((s, r) => s + r.spendSol, 0),
  };
  const tv = list.map((r) => r.typedVsSeen[K_MAIN]).filter((x) => x != null);
  out.typed = {
    n: tv.length, median: q(tv.filter((x) => Number.isFinite(x) && x < 0.99), 0.5), p25: q(tv.filter((x) => Number.isFinite(x) && x < 0.99), 0.25), p75: q(tv.filter((x) => Number.isFinite(x) && x < 0.99), 0.75),
    le3: tv.length ? tv.filter((x) => x <= 0.03).length / tv.length : null, le5: tv.length ? tv.filter((x) => x <= 0.05).length / tv.length : null,
    ge10: tv.length ? tv.filter((x) => x >= 0.1).length / tv.length : null, ge20: tv.length ? tv.filter((x) => x >= 0.2).length / tv.length : null,
    unprotected: tv.length ? tv.filter((x) => !Number.isFinite(x) || x >= 0.99).length / tv.length : null,
  };
  return out;
}
function missed(list) {
  const miss = list.filter((r) => r.later);
  const e = { n: miss.length };
  for (const m of [1, 5, 10]) {
    const have = miss.filter((r) => r.later[m] && r.later[m].rel != null);
    e[m] = { n: have.length, median: q(have.map((r) => r.later[m].rel), 0.5), higher: have.length ? have.filter((r) => r.later[m].rel > 0).length / have.length : null, completed: have.filter((r) => r.later[m].completed).length, beyond: miss.filter((r) => r.later[m]?.beyond).length };
  }
  return e;
}
function sandwichSummary(list) {
  const v = list.flatMap((s) => s.victims.map((x) => ({ ...x, pushed: s.pushed, kind: s.kind })));
  const out = {
    count: list.length, sameWallet: list.filter((s) => s.kind === 'same wallet').length, twoWallet: list.filter((s) => s.kind !== 'same wallet').length,
    victims: v.length, victimSpendSol: v.reduce((s, x) => s + x.spendSol, 0), overpaidSol: v.reduce((s, x) => s + Math.max(0, x.overpaidSol), 0),
    overpaidMedian: q(v.map((x) => x.overpaidFrac), 0.5), pushMedian: q(list.map((s) => s.pushed), 0.5), pushP90: q(list.map((s) => s.pushed), 0.9),
    typedDecoded: v.filter((x) => x.typedVsPre != null).length, typedMedian: q(v.map((x) => x.typedVsPre).filter((x) => x != null && Number.isFinite(x) && x < 0.99), 0.5),
    typedUnprotected: v.filter((x) => x.typedVsPre === Infinity || x.typedVsPre >= 0.99).length,
    fixed1FromSeen: v.filter((x) => x.fixed1FromSeen).length, rungTight: {},
  };
  for (const d of D_LIST) {
    const c = {};
    for (const x of v) { const o = x.rungTight[d].outcome; c[o] = (c[o] || 0) + 1; }
    out.rungTight[d] = { counts: c, paidVsPreMedian: q(v.map((x) => x.rungTight[d].paidVsPre), 0.5) };
  }
  return out;
}

const results = {
  date: DATE,
  model: { K_LIST, D_LIST, K_MAIN, D_MAIN, FIXED, RUNG, tryTiming: 'try i lands at buy slot + d + 4*i', firstTry: 'order lands at the real buy position; first try d slots later' },
  segments: segRows, excluded, scenarios: {}, validation: {},
};
for (const [kind, arr] of Object.entries(validation)) results.validation[kind] = { n: arr.length, medianAbs: q(arr.map(Math.abs), 0.5), p99Abs: q(arr.map(Math.abs), 0.99), within1bp: arr.length ? arr.filter((x) => Math.abs(x) <= 1e-4).length / arr.length : null };
for (const s of Object.keys(SCEN)) {
  const list = rows.filter((r) => r.scen === s);
  const segs = segRows.filter((x) => x.scenario === s);
  const sc = { name: SCEN[s], tokens: new Set(segs.map((x) => x.mint)).size, windows: segs.length, buys: list.length, grid: {}, missed: missed(list), sandwiches: sandwichSummary(sandwiches.filter((x) => x.scen === s)) };
  for (const k of K_LIST) for (const d of D_LIST) sc.grid[ck(k, d)] = aggregate(list, ck(k, d));
  sc.main = sc.grid[ck(K_MAIN, D_MAIN)];
  sc.okInWindows = segs.reduce((a, x) => a + (x.okInWindow || 0), 0);
  sc.failedInWindows = segs.reduce((a, x) => a + (x.failedInWindow || 0), 0);
  sc.slipFailedInWindows = segs.reduce((a, x) => a + (x.slipFailedInWindow || 0), 0);
  sc.priceRange = { median: q(segs.map((x) => x.priceRange), 0.5), min: q(segs.map((x) => x.priceRange), 0), max: q(segs.map((x) => x.priceRange), 1) };
  sc.examples = sandwiches.filter((x) => x.scen === s && x.kind === 'same wallet').sort((a, b) => b.victims.reduce((t, v) => t + v.overpaidSol, 0) - a.victims.reduce((t, v) => t + v.overpaidSol, 0)).slice(0, 5);
  results.scenarios[s] = sc;
}
results.sandwichList = sandwiches;
fs.mkdirSync(path.join(REPLAY_DIR, 'results'), { recursive: true });
fs.writeFileSync(path.join(REPLAY_DIR, 'results', `replay-${DATE}.json`), JSON.stringify(results, (k, v) => (v === Infinity ? 'unprotected' : v)));

// ---------------- markdown ----------------
const L = [];
const P = (s = '') => L.push(s);
P(`# Rung replay on real pump.fun trading: three scenarios (${DATE})`);
P();
P('Every number below comes from real mainnet trades fetched with read-only JSON-RPC calls (the public `api.mainnet-beta.solana.com` for the candidate scans, and an authorized keyed endpoint serving the same methods for most of the window data) and cached under `measure/replay/cache/`. Two kinds of numbers appear, and each is labelled:');
P();
P('- **[chain]** measured directly from transactions: trade counts, failed transactions and their error codes, prices, reserves, typed slippage bounds, sandwiches.');
P('- **[sim]** simulated on the real tape: what a fixed-slippage buy or a Rung order *would* have done if placed at the moment of each real buy, with that buy\'s SOL amount. The tape itself is not changed.');
P();
P(`Headline setting: quote age k = ${K_MAIN} slots (price seen ${K_MAIN} slots before the order lands), Rung first try ${D_MAIN} slots after the order (first try sent together with the order, measured: 3, 4, 4 and 10 slots on mainnet with the script, 5 on devnet with the app; the old sender's median was 9), later tries 4 slots apart. One slot ≈ 0.215 s in this data. Sensitivity tables follow each scenario.`);
P();
P('## Summary across the three scenarios [sim, except where marked]');
P();
P('| | ' + Object.keys(SCEN).map((s) => `${s} ${SCEN[s]}`).join(' | ') + ' |');
P('|---|---|---|---|');
const sc = results.scenarios;
const cell = (fn) => Object.keys(SCEN).map((s) => fn(sc[s])).join(' | ');
P(`| tokens / windows / real buys replayed [chain] | ${cell((x) => `${x.tokens} / ${x.windows} / ${x.buys.toLocaleString()}`)} |`);
P(`| window price range, median (min–max) [chain] | ${cell((x) => `${pct(x.priceRange.median)} (${pct(x.priceRange.min)}–${pct(x.priceRange.max)})`)} |`);
P(`| in the windows: failed txs with slippage codes / all failed / successful txs touching the venue (S1, S2 include bots' no-op checks) [chain] | ${cell((x) => `${x.slipFailedInWindows} / ${x.failedInWindows} / ${x.okInWindows}`)} |`);
for (const name of STRATS) P(`| fill: ${name} (n) | ${cell((x) => `${pct(x.main.strategies[name].fill)} (${x.main.strategies[name].n})`)} |`);
P(`| Rung Tight: filled on 1st / 2nd / 3rd try | ${cell((x) => x.main.strategies['Rung Tight 1/2/3'].rungShare.map((v) => pct(v)).join(' / '))} |`);
for (const name of STRATS) P(`| paid vs seen, median / p90: ${name} | ${cell((x) => `${pct(x.main.strategies[name].paid.median, 2)} / ${pct(x.main.strategies[name].paid.p90, 2)}`)} |`);
P(`| typed slippage of real buyers vs quote seen, median [chain+k] | ${cell((x) => `${pct(x.main.typed.median)} (n=${x.main.typed.n})`)} |`);
P(`| room to a sandwich bot, own typed slippage, SOL summed [chain] | ${cell((x) => `${f2(x.main.own.roomSolProtected)} (+${x.main.own.unprotected} unprotected buys, ${f2(x.main.own.unprotectedSpendSol)} SOL)`)} |`);
for (const name of STRATS) P(`| room, SOL summed (mean %): ${name} | ${cell((x) => `${f2(x.main.strategies[name].roomSol)} (${pct(x.main.strategies[name].roomMean, 2)})`)} |`);
P(`| real sandwiches found / victims / victims overpaid SOL [chain] | ${cell((x) => `${x.sandwiches.count} / ${x.sandwiches.victims} / ${f2(x.sandwiches.overpaidSol, 3)}`)} |`);
{
  const fx = (name) => (x) => { const o = x.main.strategies[name]; return `fill ${pct(o.fill)} (n=${o.n}), room ${pct(o.roomMean, 2)} / ${f2(o.roomSol)} SOL`; };
  const ft = (name) => (x) => { const o = x.main.strategies[name].firstTry; return `1st try fills ${pct(o.fill)} (n=${x.main.strategies[name].n}), room ${pct(o.roomMean, 2)} / ${f2(o.roomSol)} SOL`; };
  P(`| like for like: Fixed 5% vs Rung Fast 5/10/15 (all tries) | ${cell((x) => `${fx('Fixed 5%')(x)} vs ${fx('Rung Fast 5/10/15')(x)}`)} |`);
  P(`| like for like: Fixed 10% vs Rung Launch 10/20/30 (first try only) | ${cell((x) => `${fx('Fixed 10%')(x)} vs ${ft('Rung Launch 10/20/30')(x)}`)} |`);
  P(`| like for like: Fixed 20% / Fixed 25% vs Rung Launch 10/20/30 (all tries) | ${cell((x) => `${fx('Fixed 20%')(x)}; ${fx('Fixed 25%')(x)} vs ${fx('Rung Launch 10/20/30')(x)}`)} |`);
}
P(`| fixed 3% misses: price 5 min later, median, share higher | ${cell((x) => `${pct(x.missed[5].median)}, ${pct(x.missed[5].higher)} (n=${x.missed[5].n})`)} |`);
P();

for (const s of Object.keys(SCEN)) {
  const x = sc[s];
  const m = x.main;
  P(`## ${s}. ${SCEN[s]}`);
  P();
  if (s === 'S1') {
    P('**How the tokens were chosen [chain]:** all pump.fun curves that graduated (migrated to PumpSwap) in the 24 hours before the scan anchor, found through pump\'s `withdraw_authority` (every migration references it), plus the tokens named in `tokens.json`; the 40 with the most successful curve-account transactions in the first 60 s were re-ranked by successful transactions on the curve\'s token account (every trade moves it; see the note under the table) and the top 12 were taken (SOL volume was not used for ranking: it needs every transaction). Window: the first 60 s after creation (or to the curve\'s completion if earlier). These launches run at 30–60 successful curve transactions per second and most of those are bots\' no-op checks that never call pump, which a signature list cannot tell apart from trades. So every block of the window is read (`getBlock` with `transactionDetails: "accounts"`: each transaction\'s accounts and balances before/after, no instruction data) and every transaction that changed the curve\'s token balance is a trade, in block order, with exact reserves (balances + offsets calibrated on pump\'s TradeEvent in a fully fetched sample of 120 transactions). Typed slippage is known only for the sampled trades. The dev buy inside the create transaction is not in the tape. Prices 1, 5 and 10 min later come from a 30 s grid after the window.');
    P();
    P('| token | created (UTC) | first 60 s: ok tx on the curve account / on its token account (≈ trades), trades/s [chain] | first 60 s: failed token-account tx (slippage codes) [chain] | price at +60 s vs first trade [chain] | highest price in window vs first trade [chain] | curve lifetime [chain] | replayed: trades / buys / SOL bought |');
    P('|---|---|---|---|---|---|---|---|');
    for (const r of segRows.filter((z) => z.scenario === 'S1')) {
      const gr = grads[r.mint] || {}, ar = ataRank[r.mint] || {};
      P(`| \`${r.mint}\` | ${(gr.created || '').slice(0, 16)} | ${gr.first60?.ok ?? '–'} / ${ar.first60?.ok ?? '–'}, ${ar.first60 ? f2(ar.first60.ok / 60, 0) : '–'} | ${ar.first60?.failed ?? '–'} (${ar.first60?.failedSlippage ?? '–'}) | ${pct(r.price60)} | ${pct(r.priceMax)} | ${gr.curveMinutes != null ? f2(gr.curveMinutes, 1) + ' min' : '–'} | ${r.trades} / ${r.buys} / ${f2(r.buySol, 1)} |`);
    }
    const s1 = segRows.filter((z) => z.scenario === 'S1').map((r) => ataRank[r.mint]).filter(Boolean);
    const s1c = segRows.filter((z) => z.scenario === 'S1').map((r) => grads[r.mint]).filter(Boolean);
    const f60 = s1.reduce((a, g) => a + g.first60.failed, 0), o60 = s1.reduce((a, g) => a + g.first60.ok, 0), sl60 = s1.reduce((a, g) => a + g.first60.failedSlippage, 0);
    const c60 = s1c.reduce((a, g) => a + g.first60.ok, 0), cf60 = s1c.reduce((a, g) => a + g.first60.failed, 0);
    P();
    P(`Across these ${s1.length} launches, first 60 s [chain]: ${c60.toLocaleString()} successful and ${cf60.toLocaleString()} failed transactions touched the bonding-curve account, but only ${o60.toLocaleString()} successful ones touched the curve's token account, which every trade moves: most successful "curve transactions" in a hyped launch are bots reading the curve and exiting without trading. On the token account: ${f60.toLocaleString()} failed transactions, ${sl60.toLocaleString()} with pump's slippage error codes (6002/6003/6042). The code is read from the transaction error whichever program raised it, so a router's own error with the same number would also count; the many other failures are mostly bots' own checks (other codes) and are not slippage failures of the pump instruction.`);
    P();
  } else {
    P(s === 'S2'
      ? '**How the windows were chosen [chain]:** among the 30 graduates (curve lifetime ≥ 15 min) with the busiest 5-minute curve-account window after minute 10, the 5-minute window starting ≥ 10 min after creation with the most successful transactions on the curve\'s token account (≈ trades); the busiest windows were taken, one per token. Chosen by activity, not by price range; the measured price range is shown. At most 600 successful transactions from the window start are fetched in full (whole slots); most of them are bots\' no-op checks, so the replayed part covers the first 27–264 s of each window (column "first N s").'
      : '**How the windows were chosen [chain]:** the canonical PumpSwap pools of the deep tokens marked `calmPool` in `tokens.json` (signatures of the pool\'s base token account); 10-minute windows at fixed times (every 72,000 slots, about 8 h, back from the plan\'s anchor slot, so about 7 days), not chosen by calmness; the measured price range is shown.');
    P();
    P('| window | venue | from (UTC) | ok tx in window [chain] | failed (slippage) [chain] | trades replayed / buys | price range in window [chain] |');
    P('|---|---|---|---|---|---|---|');
    for (const r of segRows.filter((z) => z.scenario === s)) P(`| ${short(r.mint)} | ${r.venue} | ${new Date(r.from * 1000).toISOString().slice(0, 16)} | ${r.okInWindow} | ${r.failedInWindow} (${r.slipFailedInWindow}) | ${r.trades} / ${r.buys}${r.truncatedAt ? ` (first ${r.truncatedAt - r.from} s)` : ''} | ${pct(r.priceRange, 2)} |`);
    P();
  }
  for (const e of excluded.filter((z) => z.scenario === s)) P(`Excluded from the plan's selection: \`${e.mint}\` — ${e.why}.`);
  P();
  P(`Sample: ${x.tokens} tokens, ${x.windows} windows, **${x.buys.toLocaleString()} real buys** (${f2(m.spendSol, 1)} SOL).`);
  P();
  P(`**Typed slippage of the real buyers [chain, against the quote ${K_MAIN} slots earlier]:** decoded for ${m.typed.n}; median ${pct(m.typed.median)} (p25–p75 ${pct(m.typed.p25)}–${pct(m.typed.p75)}); ≤3%: ${pct(m.typed.le3)}; ≤5%: ${pct(m.typed.le5)}; ≥10%: ${pct(m.typed.ge10)}; ≥20%: ${pct(m.typed.ge20)}; unprotected (min out 0 or ≥99%): ${pct(m.typed.unprotected)}.`);
  P();
  P(`**Fill, price paid vs seen, room [sim, k=${K_MAIN}, first try +${D_MAIN} slots]:**`);
  P();
  P('n = buys evaluated for that strategy at this setting (buys whose quote or later tries fall outside the fetched data are left out of that cell).');
  P();
  P('| strategy | fill (n) | 1st / 2nd / 3rd / 4th / 5th try | not bought | paid vs seen median / p90 | room to sandwich: mean % / SOL summed | if the bot also moves the order\'s start: mean % / SOL |');
  P('|---|---|---|---|---|---|---|');
  P(`| own typed slippage [chain] | 100% of landed buys (survivors); ${x.slipFailedInWindows} slippage-failed txs in the windows | | | 0 by definition | ${pct(m.own.roomMean, 2)} / ${f2(m.own.roomSolProtected)} SOL (+${m.own.unprotected} unprotected) | |`);
  for (const name of STRATS) {
    const o = m.strategies[name];
    P(`| ${name} | ${pct(o.fill)} (${o.n}) | ${o.rungShare ? o.rungShare.map((v) => pct(v)).join(' / ') : ''} | ${o.notBought != null ? pct(o.notBought) : ''} | ${pct(o.paid.median, 2)} / ${pct(o.paid.p90, 2)} | ${pct(o.roomMean, 2)} / ${f2(o.roomSol)} | ${o.roomSolAdv != null ? `${pct(o.roomMeanAdv, 2)} / ${f2(o.roomSolAdv)}` : ''} |`);
  }
  P();
  P('**Sensitivity [sim]: fill of Rung Tight 1/2/3 (and fixed 3%) by quote age k and first-try latency d:**');
  P();
  P('| k \\ d | ' + D_LIST.map((d) => `d=${d}${d === 9 ? ' (old sender)' : ''}`).join(' | ') + ' | fixed 3% | fixed 5% |');
  P('|---|' + D_LIST.map(() => '---').join('|') + '|---|---|');
  for (const k of K_LIST) P(`| k=${k} | ${D_LIST.map((d) => pct(x.grid[ck(k, d)].strategies['Rung Tight 1/2/3'].fill)).join(' | ')} | ${pct(x.grid[ck(k, 1)].strategies['Fixed 3%'].fill)} | ${pct(x.grid[ck(k, 1)].strategies['Fixed 5%'].fill)} |`);
  P();
  P('| all Rung modes, k=3 | ' + D_LIST.map((d) => `d=${d}`).join(' | ') + ' |');
  P('|---|' + D_LIST.map(() => '---').join('|') + '|');
  for (const name of Object.keys(RUNG)) P(`| ${name} | ${D_LIST.map((d) => pct(x.grid[ck(K_MAIN, d)].strategies[name].fill)).join(' | ')} |`);
  P();
  const sw = x.sandwiches;
  P(`**Real sandwiches [chain]:** ${sw.count} found (${sw.sameWallet} same wallet, ${sw.twoWallet} two-wallet by matched amount), ${sw.victims} victims who spent ${f2(sw.victimSpendSol)} SOL and overpaid ${f2(sw.overpaidSol, 4)} SOL against the pre-attack price (median ${pct(sw.overpaidMedian, 2)}). Front-run push: median ${pct(sw.pushMedian, 2)}, p90 ${pct(sw.pushP90, 2)}. Victims' typed slippage vs the pre-attack price: median ${pct(sw.typedMedian)} (decoded ${sw.typedDecoded}; ${sw.typedUnprotected} unprotected).`);
  P();
  if (sw.victims) {
    P(`**What Rung Tight 1/2/3 would have done for these victims [sim]** (quote seen = pre-attack state; order lands where the victim landed, i.e. after the push; tries at +d, +d+4, +d+8 slots): ` + D_LIST.map((d) => `d=${d}: ${Object.entries(sw.rungTight[d].counts).map(([o, c]) => `${o} ${c}`).join(', ')} (paid vs pre-attack median ${pct(sw.rungTight[d].paidVsPreMedian, 2)})`).join('; ') + `. A fixed 1% from the seen quote, landing where the victim did, would have filled ${sw.fixed1FromSeen} of ${sw.victims}.`);
    P();
  }
  if (x.examples.length) {
    P('Clearest examples (same wallet, largest overpayment):');
    P();
    P('| token | slot | push | victim overpaid | victim typed | Rung Tight (d=5) | front-run | victim | back-run |');
    P('|---|---|---|---|---|---|---|---|---|');
    for (const e of x.examples) {
      const v = [...e.victims].sort((a, b) => b.overpaidSol - a.overpaidSol)[0];
      const rt = v.rungTight[D_MAIN];
      P(`| ${short(e.mint)} | ${e.slot} | ${pct(e.pushed, 2)} | ${f2(v.overpaidSol, 4)} SOL (${pct(v.overpaidFrac, 2)}) | ${v.typedVsPre == null ? 'not decoded' : v.typedVsPre === Infinity || v.typedVsPre >= 0.99 ? 'unprotected (≥99%)' : pct(v.typedVsPre, 1)} | ${rt.outcome}${rt.paidVsPre != null ? ` (${pct(rt.paidVsPre, 2)} vs pre)` : ''} | \`${e.front}\` | \`${v.sig}\` | \`${e.back}\` |`);
    }
    P();
  }
  const e = x.missed;
  P(`**Buys fixed 3% would have missed: price later vs the price seen [chain prices, sim selection; an opportunity figure, not a profit]:** n=${e.n}. +1 min: median ${pct(e[1].median)}, higher in ${pct(e[1].higher)} (n=${e[1].n}); +5 min: ${pct(e[5].median)}, ${pct(e[5].higher)} (n=${e[5].n}); +10 min: ${pct(e[10].median)}, ${pct(e[10].higher)} (n=${e[10].n}). Curve completed before that time (last curve price used): ${e[1].completed} / ${e[5].completed} / ${e[10].completed}; no price data: ${e[1].beyond} / ${e[5].beyond} / ${e[10].beyond}.`);
  P();
}

P('## Method and limits');
P();
P('**Data [chain].** `scan-graduates.mjs` lists migrations through pump\'s `withdraw_authority` and pages each graduate\'s bonding-curve signatures (`getSignaturesForAddress`, which also gives each transaction\'s index in its block and the error code of failed ones). `fetch-scenarios.mjs` chooses the windows (rules above, fixed before looking at any replay result) and fetches every successful transaction in them (`getTransaction`, `maxSupportedTransactionVersion: 1`), plus one transaction every 15 s (60 s in S3) for 11 min after each window for part E. `build.mjs` decodes the trades; `sim.mjs` replays. Read-only calls only (`getSignaturesForAddress`, `getTransaction`, `getBlock`, `getAccountInfo`, `getMultipleAccounts`, `getTokenSupply`, `getSlot`), paced with back-off; build and sim run strictly from the cache (`node --import ./tools/offline.mjs …` stops on any network request).');
P();
P('**Decoding.** Curve: pump\'s TradeEvent (SOL and token amounts, virtual reserves after the trade, fee rates) paired with the buy instruction (typed bound). Pool: reserves from the pool\'s base and quote token-account balances before/after, plus PumpSwap\'s `virtual_quote_reserves` read from the pool account at fetch time; fee rates and the buyer\'s total spend from PumpSwap\'s BuyEvent, used only when the event\'s reserves equal the balances.');
P();
{
  const v = results.validation;
  P(`**Reconstruction checks [chain vs formula].** Quote formula (client/src/quote.ts) on the reconstructed pre-trade state vs tokens actually received, every replayed buy: curve buys n=${v.curve.n}, median |error| ${v.curve.medianAbs?.toExponential(2) ?? '–'}, p99 ${v.curve.p99Abs?.toExponential(2) ?? '–'}, within 0.01%: ${pct(v.curve.within1bp)}; pool buys n=${v.poolExactIn.n}, median ${v.poolExactIn.medianAbs?.toExponential(2) ?? '–'}, p99 ${v.poolExactIn.p99Abs?.toExponential(2) ?? '–'}, within 0.01%: ${pct(v.poolExactIn.within1bp)}. Execution order: ${segRows.reduce((a, r) => a + (r.slotsChained || 0), 0)} slots chained by reserves, ${segRows.reduce((a, r) => a + (r.slotsFallback || 0), 0)} fell back to the RPC's transaction index; ${segRows.reduce((a, r) => a + (r.idxDisagree || 0), 0)} chained pairs disagreed with the transaction index; ${segRows.reduce((a, r) => a + (r.tapeGaps || 0), 0)} reserve gaps in the tapes; ${segRows.reduce((a, r) => a + (r.txMissing || 0), 0)} transactions the RPC did not return.`);
}
P();
{
  const ss = segRows.map((r) => r.slotSeconds).filter((x) => x != null && x > 0);
  P(`**Slot length [chain].** Block time over slot number in the tapes: median ${f2(q(ss, 0.5), 3)} s per slot (p10–p90 ${f2(q(ss, 0.1), 3)}–${f2(q(ss, 0.9), 3)} s, ${ss.length} windows; block times have 1 s resolution). So 4 slots between Rung tries is about ${f2(4 * q(ss, 0.5), 1)} s, and a quote age of 3 slots is about ${f2(3 * q(ss, 0.5), 1)} s.`);
  P();
}
{
  const b = segRows.filter((r) => r.blockMode);
  const sum = (k) => b.reduce((a, r) => a + (r[k] || 0), 0);
  if (b.length) P(`**Block reads (S1) [chain].** ${sum('blocks')} blocks; ${sum('txTouchingCurve').toLocaleString()} transactions touched the curves, ${sum('txFailedInBlocks').toLocaleString()} of them failed, and ${segRows.filter((r) => r.blockMode).reduce((a, r) => a + r.trades, 0).toLocaleString()} changed the curve's token balance (trades). In the fully fetched samples, ${sum('sampleNoTrade')} of ${sum('sampleNoTrade') + sum('sampleTrades')} successful transactions did not trade. Cross-check against pump's own TradeEvent for ${sum('evChecked')} sampled trades: token amount and virtual tokens identical in ${sum('evTokExact')}; virtual SOL (from k / virtual tokens) within ${(Math.max(...b.map((r) => r.evVsMaxRel || 0))).toExponential(1)} relative; k varied by at most ${(Math.max(...b.map((r) => r.kSpread || 0))).toExponential(1)} across samples. The curve account's lamports are not used for reserves: on the curve checked by hand (tools/check-offsets.mjs) its lamport change differs from the event's SOL amount by 0.775% of it on both buys and sells, i.e. part of the fee stays in the curve account.`);
  const g = segRows.filter((r) => !r.blockMode && r.txNoTrade != null);
  if (g.length) P(`**No-op share elsewhere [chain].** Of the successful transactions fetched in full in S2/S3 windows, ${g.reduce((a, r) => a + r.txNoTrade, 0).toLocaleString()} touched the venue without trading (bots' conditional transactions), next to ${g.reduce((a, r) => a + r.trades, 0).toLocaleString()} trades.`);
  P();
}
{
  const dcf = path.join(REPLAY_DIR, 'results', 'decoder-check.json');
  if (fs.existsSync(dcf)) {
    const dc = JSON.parse(fs.readFileSync(dcf, 'utf8'));
    const c = dc.curve, pb = dc.pool.reduce((a, p) => a + p.buys, 0), pm = dc.pool.reduce((a, p) => a + p.eventMatched, 0);
    P(`**Explorer-style decoder check [chain] (tools/check-decoder.mjs, S2 and S3 tapes).** ${c.length} curve trades: decoded token amount equals the change of the curve's token-account balance in ${c.filter((x) => x.tokMatch).length}; the decoded SOL amount equals the curve account's lamport change in ${c.filter((x) => x.solMatch).length} (in the others the curve also keeps a fee share, 0.775% of the amount). Pool buys: PumpSwap's BuyEvent reserves equal the pool token-account balances in ${pm} of ${pb}.`);
    P();
  }
}
P('**Simulation assumptions [sim].**');
P(`1. Quote age k ∈ {${K_LIST.join(', ')}}: the user saw the venue at the end of slot (buy slot − k). Buys in a window's first k slots of a fresh curve "saw" the reserves before the window's first trade.`);
P('2. The fixed buy and Rung\'s order land exactly where the real buy landed (state just before it). Rung\'s `start` is computed there.');
P(`3. Rung try i lands at buy slot + d + 4·i with d ∈ {${D_LIST.join(', ')}} (d = 9 is the old sender), against the state at the start of that slot. A try due after the curve completed fails ("curve completed"). Tries past the fetched data count as not filled and are counted (\`unknown\` in the JSON).`);
P('4. Each counterfactual buy is alone: it does not move the tape; other traders (including sandwich bots) act as they did. A bot facing a tighter bound would push less or skip, so the sandwich section shows what the bound allowed, not how bots would adapt.');
P('5. Spend = the real buy\'s total (SOL into the venue + fees). Fee rates from the trade\'s own event; curve events without fee fields (older layout): 1%; pool buys without a readable BuyEvent: 0.20% + 0.05% + 0.05%.');
P('6. "Room to a sandwich bot" = tokens obtainable / minimum accepted − 1, in SOL spend × (1 − minimum/obtainable): an upper bound of what a sandwich could take from that buy, not money anyone took. For own typed slippage it is measured (what the instruction allowed vs what the buy got). For Rung the first reading uses the filled try\'s bound; the second assumes a bot also front-runs the order-opening transaction, which lowers `start`, so only the cap protects. The first reading is what one same-block sandwich around the try that fills can take. The second needs a separate, earlier manipulation: a buy placed before the order-opening transaction (it can be sold right after it, even in the same block, because `start` stays stored) that the bot pays round-trip fees on without any Rung buy to profit from at that moment, followed by a sandwich around the later try; it is not a single same-block sandwich, but it also does not require holding the position for d slots. When the price fell between the quote and the landing, a fixed X% buy has more than X% of room (the bound is set from the older, higher price); that is why mean room can exceed the nominal slippage in S1.');
P('7. Part E uses the spot price (virtual quote / virtual tokens) from the tape and the 15-second (S3: 60-second) grid; after a curve completed, the last curve price stands in.');
P();
P('**Reproduce.** From `measure/replay/` (Node from `client/`\'s toolchain, no extra dependencies): `node discover.mjs` → `HOURS=24 node scan-graduates.mjs` → `node scan-ata.mjs` → `N_S1=12 S1_SEC=60 SAMPLE_S1=120 N_S2=14 CAP_S2=600 S3_WINDOWS=10 CAP_S3=250 node fetch-scenarios.mjs plan` → `node fetch-scenarios.mjs fetch S1` (then `S2`, `S3`) → `node build.mjs` → `node sim.mjs` → `node tools/check-decoder.mjs 20`. Every RPC response is cached under `cache/` (block reads as per-slot extracts in `cache/blocks/`), so a rerun with the cache present makes no requests and reproduces these tables exactly; `scan-anchor.json` and `s3-anchor.json` pin "now" for the candidate lists and the calm windows.');
P();
P('**Not covered / limits.** Only the first CAP successful transactions of very busy windows are replayed (marked "first N s"); fees paid by failed transactions are not counted; PumpSwap pool windows use the pool\'s current `virtual_quote_reserves` for the whole window; sandwich detection is pattern-based (order + wallet or matched amount, same or next slot): a lower bound for multi-wallet bots, and a sell that happens to match an amount can be a false positive; graduates with more than 25,000 curve signatures were not ranked; 2024 tokens that graduated to Raydium were not used.');

// ---------------- bolder ladders and shorter waits ----------------
P();
P('## Bolder ladders and shorter waits [sim]');
P();
P(`Same windows, same buys, same rule as the other Rung rows (min = max(seen/(1+cap), start/(1+rung)); try i lands at buy slot + d + wait·i). Headline k=${K_MAIN}, d=${D_MAIN}, wait 4 slots unless stated. Room: first reading = the filled try\'s bound (what one same-block sandwich around that try can take); second reading = cap bound (a bot that also moved the order\'s \`start\`). For one-shot buys there is only one reading. Upper bounds, not money taken. n = buys evaluated in that cell.`);
P();
const ONE_SHOT = ['Fixed 3%', 'Fixed 5%', 'Fixed 10%', 'Fixed 20%', 'Fixed 25%', 'Fixed 30%', 'Fixed 35%', 'Fixed 50%'];
const LADDER_ROWS = ['Rung Tight 1/2/3', 'Rung Fast 5/10/15', 'Rung Launch 10/20/30', ...Object.keys(RUNG_X).filter((n) => RUNG_X[n].at(-1) > 3000)];
const CAP30_ROWS = ['Fixed 20%', 'Fixed 25%', 'Fixed 30%', 'Rung Launch 10/20/30', 'Rung 5/10/20/30', 'Rung 5/10/15/20/30'];
const sameCap = (name) => { const c = LADDERS[name].rungs.at(-1) / 100; const f = `Fixed ${c}%`; return FIXED_ALL[f] ? f : null; };
const row = (o, name, extra = '') => `| ${name}${extra} | ${pct(o.fill)} (${o.n}) | ${pct(o.paid.median, 2)} / ${pct(o.paid.p90, 2)} | ${pct(o.roomMean, 2)} / ${f2(o.roomSol)} | ${o.roomSolAdv != null ? f2(o.roomSolAdv) : '= first'} |`;
results.bolder = {};
for (const s of ['S1', 'S2', 'S3']) {
  const g = results.scenarios[s].grid;
  const m = g[ck(K_MAIN, D_MAIN)].strategies;
  const f25 = m['Fixed 25%'];
  const winners = Object.keys(LADDERS).filter((n) => m[n].fill >= f25.fill && m[n].roomSol < f25.roomSol && m[n].roomSolAdv < f25.roomSol);
  results.bolder[s] = { winnersVsFixed25: winners, fixed25: { fill: f25.fill, n: f25.n, roomSol: f25.roomSol } };
  if (s === 'S3') {
    P(`**S3 calm:** every one-shot and every ladder above fills ${pct(Math.min(...[...ONE_SHOT, ...Object.keys(LADDERS)].map((n) => m[n].fill)))}–${pct(Math.max(...[...ONE_SHOT, ...Object.keys(LADDERS)].map((n) => m[n].fill)))} (n=${m['Fixed 25%'].n} one-shot, ${m['Rung 15/25/35/50'].n} ladder); first-reading room grows with the first rung (Tight ${f2(m['Rung Tight 1/2/3'].roomSol)} SOL, 15/25/35/50 ${f2(m['Rung 15/25/35/50'].roomSol)} SOL, Fixed 25% ${f2(f25.roomSol)} SOL, Fixed 50% ${f2(m['Fixed 50%'].roomSol)} SOL).`);
    P();
    continue;
  }
  P(`### ${s} ${SCEN[s]} (k=${K_MAIN}, d=${D_MAIN}, wait 4)`);
  P();
  P('| strategy | fill (n) | paid vs seen median / p90 | room first reading: mean % / SOL | room second reading: SOL |');
  P('|---|---|---|---|---|');
  for (const n of ONE_SHOT) P(row(m[n], n));
  for (const n of LADDER_ROWS) { const sc = sameCap(n); P(row(m[n], n, sc ? ` (same cap: ${sc} ${pct(m[sc].fill)}, ${f2(m[sc].roomSol)} SOL)` : '')); }
  P();
  P(`**Shorter wait between rungs (${s}):** fill (n) and first-reading room mean % / SOL.`);
  P();
  P('| ladder | d | wait 4 | wait 2 | wait 1 |');
  P('|---|---|---|---|---|');
  for (const base of Object.keys(WINDOW_BASE)) for (const d of [3, 5]) {
    const st = g[ck(K_MAIN, d)].strategies;
    const c = (n) => `${pct(st[n].fill)} (${st[n].n}); ${pct(st[n].roomMean, 2)} / ${f2(st[n].roomSol)}`;
    P(`| ${base} | ${d} | ${c(base)} | ${c(`${base} (wait 2)`)} | ${c(`${base} (wait 1)`)} |`);
  }
  P();
  P(`**Fills at least as often as Fixed 25% (${pct(f25.fill)}, n=${f25.n}) while leaving less room than its ${f2(f25.roomSol)} SOL under both readings (k=${K_MAIN}, d=${D_MAIN}, all ladders and waits above):** ${winners.length ? winners.map((n) => `${n}: fill ${pct(m[n].fill)} (n=${m[n].n}), room ${f2(m[n].roomSol)} / ${f2(m[n].roomSolAdv)} SOL`).join('; ') : 'none'}.`);
  P();
}
P('### Within today\'s 30% cap');
P();
P('The deployed program allows at most 5 rungs and a cap of 30% (`MAX_RUNGS = 5`, `MAX_CAP_BPS = 3000`). **The 50%-cap ladders above (15/25/35/50, 10/20/30/50, 20/35/50, 5/10/20/30/50) cannot be opened today; they need a program change.** The two ladders below can be typed in Custom mode today. Same setting: k=3, d=5, wait 4.');
P();
results.cap30 = {};
for (const s of ['S1', 'S2', 'S3']) {
  const m = results.scenarios[s].grid[ck(K_MAIN, D_MAIN)].strategies;
  results.cap30[s] = Object.fromEntries(CAP30_ROWS.map((n) => [n, m[n]]));
  if (s === 'S3') {
    P(`**S3 calm:** all six rows fill 100% (n=${m['Fixed 30%'].n} one-shot, ${m['Rung 5/10/20/30'].n} ladder); first-reading room: Fixed 20% / 25% / 30% ${f2(m['Fixed 20%'].roomSol)} / ${f2(m['Fixed 25%'].roomSol)} / ${f2(m['Fixed 30%'].roomSol)} SOL, Launch 10/20/30 ${f2(m['Rung Launch 10/20/30'].roomSol)}, 5/10/20/30 ${f2(m['Rung 5/10/20/30'].roomSol)}, 5/10/15/20/30 ${f2(m['Rung 5/10/15/20/30'].roomSol)} SOL (second reading ${f2(m['Rung Launch 10/20/30'].roomSolAdv)} / ${f2(m['Rung 5/10/20/30'].roomSolAdv)} / ${f2(m['Rung 5/10/15/20/30'].roomSolAdv)} SOL).`);
    P();
    continue;
  }
  P(`**${s} ${SCEN[s]}**`);
  P();
  P('| strategy | fill (n) | 1st / 2nd / 3rd / 4th / 5th try | paid vs seen median / p90 | room first reading: mean % / SOL | room second reading: SOL |');
  P('|---|---|---|---|---|---|');
  for (const n of CAP30_ROWS) {
    const o = m[n];
    P(`| ${n} | ${pct(o.fill)} (${o.n}) | ${o.rungShare ? o.rungShare.map((v) => pct(v)).join(' / ') : 'one shot'} | ${pct(o.paid.median, 2)} / ${pct(o.paid.p90, 2)} | ${pct(o.roomMean, 2)} / ${f2(o.roomSol)} | ${o.roomSolAdv != null ? f2(o.roomSolAdv) : '= first'} |`);
  }
  P();
}
fs.writeFileSync(path.join(REPLAY_DIR, 'results', `replay-${DATE}.json`), JSON.stringify(results, (k, v) => (v === Infinity ? 'unprotected' : v)));
fs.writeFileSync(path.join(REPLAY_DIR, 'results', `replay-${DATE}.md`), L.join('\n'));
console.log(L.join('\n'));
