// Step 3: replay every real buy on the tapes against fixed slippage and the Rung ladder.
//
//   node sim.mjs [--date 2026-11-24]
//
// Reads cache/tape/<mint>.json (build.mjs) and cache/size.json (size.mjs); writes
// results/replay-<date>.json and results/replay-<date>.md.
//
// Model (see the "Method and limits" section of the .md):
//  - Every real buy B on the curve in the first BUY_SEC seconds after the curve's first trade is
//    "a user who wanted to buy at that moment" with B's own spend (SOL into the curve + fees).
//  - The user saw the quote at the end of slot (B.slot - k), k = quote age in slots (1, 3, 5).
//  - The order lands exactly where B landed in the real tape (state just before B).
//  - Fixed X%: one transaction; fills if tokens obtainable there >= seen / (1 + X).
//  - Rung: open_order + first try in that same transaction; try i at B.slot + 4*i, against the
//    curve state at the start of that slot. min = max(seen/(1+cap), start/(1+rung)), start =
//    floor(seen * raw_now / raw_seen) at open (math.rs / quote.ts). First filling rung wins.
//  - Counterfactual buys do not change the tape (each user is replayed alone).
import fs from 'node:fs';
import path from 'node:path';
import { CACHE_DIR, REPLAY_DIR } from './lib/rpc.mjs';
import { rawQuote, quoteAfterFees, costForTokens, minTokensAt, minTokensForRung, expectedTokensStart, spot } from './lib/curve.mjs';

const args = process.argv.slice(2);
const DATE = args.includes('--date') ? args[args.indexOf('--date') + 1] : '2026-11-24';
const BUY_SEC = Number(process.env.BUY_SEC || 600);
const K_LIST = [1, 3, 5];
const K_MAIN = 3;
const WINDOW_SLOTS = 4;
const FIXED = { 'Fixed 1%': 100, 'Fixed 3%': 300, 'Fixed 5%': 500 };
const RUNG = {
  'Rung Tight 1/2/3': [100, 200, 300],
  'Rung Normal 2/3/5': [200, 300, 500],
  'Rung Fast 5/10/15': [500, 1000, 1500],
  'Rung Launch 10/20/30': [1000, 2000, 3000],
  'Rung Custom 1/2/3/5/8': [100, 200, 300, 500, 800],
};
const STRATS = [...Object.keys(FIXED), ...Object.keys(RUNG)];

const B = (x) => BigInt(x);
const q = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
const pct = (x, d = 1) => (x == null ? '–' : (100 * x).toFixed(d) + '%');
const sol = (x, d = 3) => (x == null ? '–' : x.toFixed(d));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

const sizes = fs.existsSync(path.join(CACHE_DIR, 'size.json')) ? JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'size.json'), 'utf8')) : {};
const tokens = JSON.parse(fs.readFileSync(path.join(REPLAY_DIR, 'tokens.json'), 'utf8'));
const tapeDir = path.join(CACHE_DIR, 'tape');

const tokenRows = [];
const rows = { 1: [], 3: [], 5: [] }; // per-buy results per quote age
const sandwiches = [];
const typed = [];
const validation = [];
const fetchNotes = [];

for (const tk of tokens) {
  const f = path.join(tapeDir, `${tk.mint}.json`);
  const sigF = path.join(CACHE_DIR, 'sigs', `${tk.mint}.json`);
  if (!fs.existsSync(f)) {
    let why = 'not fetched';
    if (fs.existsSync(sigF)) { const s = JSON.parse(fs.readFileSync(sigF, 'utf8')); if (!s.complete) why = `history not retrievable: ${s.why} (${s.totalSigs} signatures paged)`; }
    fetchNotes.push({ mint: tk.mint, name: tk.name || null, why });
    continue;
  }
  const tp = JSON.parse(fs.readFileSync(f, 'utf8'));
  const T = tp.tape;
  if (!T.length) { fetchNotes.push({ mint: tk.mint, why: 'no curve trades decoded' }); continue; }
  const aft = T.map((x) => ({ vs: B(x.vs), vt: B(x.vt) }));
  const bef = T.map((x) => ({ vs: B(x.vs0), vt: B(x.vt0) }));
  const initial = bef[0];
  const firstSlot = T[0].slot;
  const t0 = T[0].t;
  const completeIdx = T.findIndex((x) => x.rt === 0);
  const lastIdxAtOrBefore = (s) => { let lo = 0, hi = T.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (T[m].slot <= s) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
  const endOfSlot = (s) => { const i = lastIdxAtOrBefore(s); return i < 0 ? initial : aft[i]; };
  const startOfSlot = (s) => endOfSlot(s - 1);
  const completeBeforeSlot = (s) => completeIdx >= 0 && T[completeIdx].slot < s;
  const lastIdxAtTime = (ts) => { let r = -1; for (let i = 0; i < T.length && T[i].t <= ts; i++) r = i; return r; };
  const spend = (x) => B(x.sol) + B(x.fee ?? Math.ceil(x.sol / 100)) + B(x.cfee ?? 0);
  const feesOf = (x) => (x.feeBps != null ? [B(x.feeBps), B(x.cfeeBps ?? 0)] : [100n]);

  const buys = T.filter((x) => x.isBuy && x.t <= t0 + BUY_SEC);
  const sz = sizes[tk.mint] || {};
  tokenRows.push({
    mint: tk.mint, name: tk.name || null, group: tk.group, created: new Date(t0 * 1000).toISOString(), firstSlot,
    trades: T.length, buysInWindow: buys.length, failedSigsInWindow: tp.failedSigsInWindow,
    curveCompleted: completeIdx >= 0, completedAfterSec: completeIdx >= 0 ? T[completeIdx].t - t0 : null,
    peakCurveMcapSol: Math.max(...T.map((x) => (x.vs / x.vt) * 1e9)) / 1e9 * 1, // vs/vt * 1e9 supply (lamports) -> SOL below
    poolMcapSolNow: sz.mcapSol ?? null, poolSnapshotAt: sz.snapshotAt ?? null, poolError: sz.error ?? null,
    chain: { slots: tp.slots, multiTxSlots: tp.multiTxSlots, slotsChained: tp.slotsChained, slotsFallback: tp.slotsFallback, tapeGaps: tp.tapeGaps, txMissing: tp.txMissing },
  });
  // peak curve market cap in SOL: price (lamports per base unit) * 1e9 tokens * 1e6 decimals / 1e9 lamports
  tokenRows.at(-1).peakCurveMcapSol = Math.max(...T.map((x) => x.vs / x.vt)) * 1e15 / 1e9;

  for (const x of buys) {
    const i = x.i;
    const A = spend(x);
    const fees = feesOf(x);
    const land = bef[i];
    const obtainNow = quoteAfterFees(A, land, fees);
    const rawNow = rawQuote(A, land);
    if (x.ix?.kind === 'exactIn' && x.tok > 0) validation.push(Number(obtainNow) / x.tok - 1);
    const phase = x.slot - firstSlot < 10 ? 'first 10 slots' : 'after 10 slots';

    // Typed slippage (decoded from the buy instruction), against the quote seen k=3 slots earlier and the state at landing.
    if (x.ix && x.ix.a2 != null) {
      const seen3 = endOfSlot(x.slot - K_MAIN);
      const typedVs = (st) => {
        if (x.ix.kind === 'exactIn') {
          if (x.ix.a2 === 0) return Infinity;
          return Number(quoteAfterFees(B(x.ix.a1), st, fees)) / x.ix.a2 - 1;
        }
        if (x.ix.kind === 'maxCost') { const c = costForTokens(B(x.ix.a1), st, fees); return c ? x.ix.a2 / Number(c) - 1 : null; }
        return null;
      };
      typed.push({ mint: tk.mint, kind: x.ix.kind, n: x.ix.n, vsSeen: typedVs(seen3), vsLand: typedVs(land), phase });
    }

    for (const k of K_LIST) {
      const seenSt = endOfSlot(x.slot - k);
      const seen = quoteAfterFees(A, seenSt, fees);
      const rawSeen = rawQuote(A, seenSt);
      if (seen <= 0n || obtainNow <= 0n) continue;
      const r = { mint: tk.mint, sig: x.sig, slot: x.slot, phase, spendSol: Number(A) / 1e9, moveAtLand: Number(seen) / Number(obtainNow) - 1, s: {} };
      for (const [name, bps] of Object.entries(FIXED)) {
        const min = minTokensAt(seen, bps);
        const fill = obtainNow >= min;
        r.s[name] = fill
          ? { f: 1, rung: 0, paid: Number(seen) / Number(obtainNow) - 1, room: Number(obtainNow) / Number(min) - 1, roomSol: (Number(A) * (1 - Number(min) / Number(obtainNow))) / 1e9 }
          : { f: 0 };
      }
      const start = expectedTokensStart(seen, rawSeen, rawNow);
      for (const [name, rungs] of Object.entries(RUNG)) {
        const cap = rungs.at(-1);
        let res = { f: 0, why: 'no rung filled' };
        for (let j = 0; j < rungs.length; j++) {
          let st;
          if (j === 0) st = land;
          else {
            const due = x.slot + WINDOW_SLOTS * j;
            if (completeBeforeSlot(due)) { res = { f: 0, why: 'curve completed before a later rung' }; break; }
            st = startOfSlot(due);
          }
          const obtain = quoteAfterFees(A, st, fees);
          const min = minTokensForRung(seen, start, rungs[j], cap);
          if (obtain >= min) {
            const capFloor = minTokensAt(seen, cap);
            const room = Number(obtain) / Number(min) - 1;
            // Adversarial: a bot that front-runs the opening transaction also moves `start`, so in the
            // first try only the cap floor binds. Later tries use the stored start: same as naive.
            const minAdv = j === 0 ? capFloor : min;
            r.s[name] = {
              f: 1, rung: j, paid: Number(seen) / Number(obtain) - 1, room, roomSol: (Number(A) * (1 - Number(min) / Number(obtain))) / 1e9,
              roomAdv: Number(obtain) / Number(minAdv) - 1, roomSolAdv: (Number(A) * (1 - Number(minAdv) / Number(obtain))) / 1e9,
            };
            res = null;
            break;
          }
        }
        if (res) r.s[name] = res;
      }
      // Part E: later prices for buys fixed 3% would not have filled.
      if (!r.s['Fixed 3%'].f) {
        const pSeen = spot(seenSt);
        r.later = {};
        for (const m of [1, 5, 10]) {
          const ts = x.t + 60 * m;
          if (completeIdx >= 0 && T[completeIdx].t <= ts) { r.later[m] = { completed: true, rel: spot(aft[completeIdx]) / pSeen - 1 }; continue; }
          if (ts > tp.t0 + tp.windowSec) { r.later[m] = { beyond: true }; continue; }
          const li = lastIdxAtTime(ts);
          r.later[m] = { rel: spot(li < 0 ? initial : aft[li]) / pSeen - 1 };
        }
      }
      rows[k].push(r);
    }
  }

  // Part D: sandwiches in the tape.
  for (let i = 0; i < T.length - 2; i++) {
    const F = T[i];
    if (!F.isBuy) continue;
    for (let m = 1; m <= 3 && i + m + 1 < T.length; m++) {
      const V = T.slice(i + 1, i + 1 + m);
      const S = T[i + m + 1];
      if (S.isBuy || S.slot - F.slot > 1) break;
      if (!V.every((v) => v.isBuy && v.signer !== F.signer && v.user !== F.user && v.sig !== F.sig)) break;
      const sameWallet = S.signer === F.signer || S.user === F.user;
      const tokMatch = Math.abs(S.tok - F.tok) / F.tok <= 0.01;
      if (!sameWallet && !tokMatch) continue;
      if (S.sig === V.at(-1).sig) break;
      const pre = bef[i];
      const pushed = spot(aft[i]) / spot(pre) - 1;
      const victims = V.map((v) => {
        const A = spend(v), fees = feesOf(v);
        const qPre = quoteAfterFees(A, pre, fees);
        const overFrac = 1 - v.tok / Number(qPre);
        let typedPre = null;
        if (v.ix?.kind === 'exactIn') typedPre = v.ix.a2 === 0 ? Infinity : Number(quoteAfterFees(B(v.ix.a1), pre, fees)) / v.ix.a2 - 1;
        if (v.ix?.kind === 'maxCost') { const c = costForTokens(B(v.ix.a1), pre, fees); typedPre = c ? v.ix.a2 / Number(c) - 1 : null; }
        // What a Rung Tight (1/2/3) order would have done, quote seen = pre-attack state, landing where the victim landed.
        const land = bef[v.i];
        const seen = qPre, rawSeen = rawQuote(A, pre), rawNow = rawQuote(A, land);
        const start = expectedTokensStart(seen, rawSeen, rawNow);
        let rung = null;
        for (let j = 0; j < 3; j++) {
          let st = land;
          if (j > 0) { const due = v.slot + WINDOW_SLOTS * j; if (completeBeforeSlot(due)) break; st = startOfSlot(due); }
          const ob = quoteAfterFees(A, st, fees);
          if (ob >= minTokensForRung(seen, start, [100, 200, 300][j], 300)) { rung = { j, paidVsPre: Number(seen) / Number(ob) - 1 }; break; }
        }
        const obLand = quoteAfterFees(A, land, fees);
        return {
          sig: v.sig, signer: v.signer, spendSol: Number(A) / 1e9, overpaidFrac: overFrac, overpaidSol: (Number(A) * overFrac) / 1e9, typedVsPre: typedPre,
          fixed1VsPre: obLand >= minTokensAt(seen, 100), rungTight: rung,
        };
      });
      sandwiches.push({
        mint: tk.mint, slot: F.slot, slotSpan: S.slot - F.slot, kind: sameWallet ? 'same wallet' : 'two wallets, matched token amount',
        front: F.sig, back: S.sig, bot: F.signer, pushed, botSpendSol: Number(spend(F)) / 1e9, botBackSol: (S.sol - (S.fee || 0) - (S.cfee || 0)) / 1e9, victims,
      });
      i = i + m + 1 - 1;
      break;
    }
  }
}

// ---------------- aggregation ----------------
function aggregate(list) {
  const out = { n: list.length, totalSpendSol: list.reduce((s, r) => s + r.spendSol, 0), strategies: {} };
  for (const name of STRATS) {
    const fills = list.filter((r) => r.s[name]?.f);
    const o = { fill: fills.length / list.length, filled: fills.length };
    const paid = fills.map((r) => r.s[name].paid);
    o.paidVsSeen = { median: q(paid, 0.5), p90: q(paid, 0.9), mean: mean(paid) };
    o.roomSolTotal = fills.reduce((s, r) => s + r.s[name].roomSol, 0);
    o.roomPctMeanPerFilled = mean(fills.map((r) => r.s[name].room));
    o.roomPctMeanPerBuy = list.length ? fills.reduce((s, r) => s + r.s[name].room, 0) / list.length : null;
    if (name.startsWith('Rung')) {
      const n = RUNG[name].length;
      o.rungShare = Array.from({ length: n }, (_, j) => fills.filter((r) => r.s[name].rung === j).length / list.length);
      o.notBought = 1 - o.fill;
      o.notBoughtCurveCompleted = list.filter((r) => r.s[name]?.why === 'curve completed before a later rung').length / list.length;
      o.roomSolTotalAdversarial = fills.reduce((s, r) => s + r.s[name].roomSolAdv, 0);
      o.roomPctMeanPerFilledAdversarial = mean(fills.map((r) => r.s[name].roomAdv));
    }
    out.strategies[name] = o;
  }
  return out;
}
const results = { date: DATE, model: { BUY_SEC, K_LIST, WINDOW_SLOTS, FIXED, RUNG }, tokens: tokenRows, fetchNotes, byK: {}, byKPhase: {}, byKToken: {} };
for (const k of K_LIST) {
  results.byK[k] = aggregate(rows[k]);
  results.byKPhase[k] = {};
  for (const ph of ['first 10 slots', 'after 10 slots']) results.byKPhase[k][ph] = aggregate(rows[k].filter((r) => r.phase === ph));
  results.byKToken[k] = {};
  for (const t of tokenRows) results.byKToken[k][t.mint] = aggregate(rows[k].filter((r) => r.mint === t.mint));
}
// Part E
results.missedByFixed3 = {};
for (const k of K_LIST) {
  const miss = rows[k].filter((r) => r.later);
  const e = { n: miss.length };
  for (const m of [1, 5, 10]) {
    const onCurve = miss.filter((r) => r.later[m] && r.later[m].rel != null && !r.later[m].completed);
    const comp = miss.filter((r) => r.later[m]?.completed);
    const all = miss.filter((r) => r.later[m]?.rel != null);
    e[m] = {
      nOnCurve: onCurve.length, medianOnCurve: q(onCurve.map((r) => r.later[m].rel), 0.5), shareHigherOnCurve: onCurve.length ? onCurve.filter((r) => r.later[m].rel > 0).length / onCurve.length : null,
      nCurveCompleted: comp.length,
      nAll: all.length, medianAll: q(all.map((r) => r.later[m].rel), 0.5), shareHigherAll: all.length ? all.filter((r) => r.later[m].rel > 0).length / all.length : null,
      nBeyondWindow: miss.filter((r) => r.later[m]?.beyond).length,
    };
  }
  results.missedByFixed3[k] = e;
}
// Typed slippage
const tFin = (sel) => typed.filter(sel);
const typedSummary = (list, key) => {
  const v = list.map((x) => x[key]).filter((x) => x != null);
  const fin = v.filter((x) => Number.isFinite(x) && x < 0.99);
  return {
    n: v.length, unprotected: v.filter((x) => !Number.isFinite(x) || x >= 0.99).length / (v.length || 1),
    median: q(fin, 0.5), p25: q(fin, 0.25), p75: q(fin, 0.75),
    le3: v.filter((x) => x <= 0.03).length / (v.length || 1), le5: v.filter((x) => x <= 0.05).length / (v.length || 1), ge20: v.filter((x) => x >= 0.2).length / (v.length || 1),
  };
};
results.typedSlippage = {
  decoded: typed.length,
  vsSeenK3: typedSummary(typed, 'vsSeen'), vsLanding: typedSummary(typed, 'vsLand'),
  exactIn: typedSummary(tFin((x) => x.kind === 'exactIn'), 'vsSeen'), maxCost: typedSummary(tFin((x) => x.kind === 'maxCost'), 'vsSeen'),
};
results.validation = { exactInBuys: validation.length, medianRelErr: q(validation.map(Math.abs), 0.5), p99RelErr: q(validation.map(Math.abs), 0.99), within1bp: validation.filter((x) => Math.abs(x) <= 1e-4).length / (validation.length || 1) };
// Part D summary
const vAll = sandwiches.flatMap((s) => s.victims.map((v) => ({ ...v, kind: s.kind, pushed: s.pushed })));
results.sandwiches = {
  count: sandwiches.length, sameWallet: sandwiches.filter((s) => s.kind === 'same wallet').length, twoWallet: sandwiches.filter((s) => s.kind !== 'same wallet').length,
  victims: vAll.length, buysInWindow: rows[K_MAIN].length,
  victimSpendSol: vAll.reduce((s, v) => s + v.spendSol, 0), overpaidSolTotal: vAll.reduce((s, v) => s + Math.max(0, v.overpaidSol), 0),
  overpaidFracMedian: q(vAll.map((v) => v.overpaidFrac), 0.5), pushMedian: q(sandwiches.map((s) => s.pushed), 0.5), pushP90: q(sandwiches.map((s) => s.pushed), 0.9),
  botPnlSolTotal: sandwiches.reduce((s, x) => s + x.botBackSol - x.botSpendSol, 0),
  typedVsPreMedian: q(vAll.map((v) => v.typedVsPre).filter((x) => x != null && Number.isFinite(x)), 0.5),
  typedDecoded: vAll.filter((v) => v.typedVsPre != null).length,
  typedUnprotected: vAll.filter((v) => v.typedVsPre === Infinity || v.typedVsPre >= 0.99).length,
  fixed1VsPreWouldFill: vAll.filter((v) => v.fixed1VsPre).length,
  rungTight: {
    firstRung: vAll.filter((v) => v.rungTight?.j === 0).length, laterRung: vAll.filter((v) => v.rungTight && v.rungTight.j > 0).length, notBought: vAll.filter((v) => !v.rungTight).length,
    paidVsPreMedianFirst: q(vAll.filter((v) => v.rungTight?.j === 0).map((v) => v.rungTight.paidVsPre), 0.5),
    paidVsPreMedianLater: q(vAll.filter((v) => v.rungTight?.j > 0).map((v) => v.rungTight.paidVsPre), 0.5),
  },
  examples: [...sandwiches].filter((s) => s.kind === 'same wallet').sort((a, b) => b.victims.reduce((s, v) => s + v.overpaidSol, 0) - a.victims.reduce((s, v) => s + v.overpaidSol, 0)).slice(0, 5),
};
results.sandwichList = sandwiches;

fs.mkdirSync(path.join(REPLAY_DIR, 'results'), { recursive: true });
fs.writeFileSync(path.join(REPLAY_DIR, 'results', `replay-${DATE}.json`), JSON.stringify(results, (k, v) => (v === Infinity ? 'unprotected' : v), 1));

// ---------------- markdown ----------------
const L = [];
const P = (s = '') => L.push(s);
const main = results.byK[K_MAIN];
P(`# Rung replay study on real pump.fun launches (${DATE})`);
P();
P(`Every real buy on the bonding curve of ${tokenRows.length} pump.fun tokens, in the first ${BUY_SEC / 60} minutes after each curve's first trade, replayed as "a user who wanted to buy at that moment" with that buy's own SOL amount. Source: public mainnet RPC only (\`getSignaturesForAddress\` on the bonding-curve PDA, \`getTransaction\`). Scripts: \`measure/replay/\` (\`fetch.mjs\` → \`build.mjs\` → \`size.mjs\` → \`sim.mjs\`).`);
P();
P(`Sample: **${main.n.toLocaleString()} buys** (${sol(main.totalSpendSol, 1)} SOL), ${tokenRows.length} tokens. Main quote age k = ${K_MAIN} slots; k = 1 and 5 shown alongside.`);
P();
P('## A. Fill: share of buys that would have filled');
P();
P(`| strategy | k=1 | k=3 | k=5 |`);
P('|---|---|---|---|');
for (const name of STRATS) P(`| ${name} | ${K_LIST.map((k) => pct(results.byK[k].strategies[name].fill)).join(' | ')} |`);
P();
P('Rung: which rung filled, and "not bought" (k=3):');
P();
P('| mode | rung 1 | rung 2 | rung 3 | rung 4 | rung 5 | not bought | of which: curve completed before a later rung |');
P('|---|---|---|---|---|---|---|---|');
for (const name of Object.keys(RUNG)) {
  const o = main.strategies[name];
  const cells = [0, 1, 2, 3, 4].map((j) => (j < o.rungShare.length ? pct(o.rungShare[j]) : ''));
  P(`| ${name} | ${cells.join(' | ')} | ${pct(o.notBought)} | ${pct(o.notBoughtCurveCompleted)} |`);
}
P();
P('By launch phase (k=3):');
P();
P(`| strategy | first 10 slots after first trade (n=${results.byKPhase[K_MAIN]['first 10 slots'].n}) | after (n=${results.byKPhase[K_MAIN]['after 10 slots'].n}) |`);
P('|---|---|---|');
for (const name of STRATS) P(`| ${name} | ${pct(results.byKPhase[K_MAIN]['first 10 slots'].strategies[name]?.fill)} | ${pct(results.byKPhase[K_MAIN]['after 10 slots'].strategies[name]?.fill)} |`);
P();
P('## B. Price paid vs price seen (filled buys)');
P();
P('Positive = paid more per token than the quote the user saw. k=3.');
P();
P('| strategy | filled | median | p90 | mean |');
P('|---|---|---|---|---|');
for (const name of STRATS) { const o = main.strategies[name]; P(`| ${name} | ${o.filled} | ${pct(o.paidVsSeen.median, 2)} | ${pct(o.paidVsSeen.p90, 2)} | ${pct(o.paidVsSeen.mean, 2)} |`); }
P();
P('## C. Room left to a sandwich bot (upper bound, not money taken)');
P();
P('"Room" = how far a bot could push the price before this buy would fail = tokens obtainable / minimum accepted − 1; in SOL, spend × (1 − minimum / obtainable). It is the most a bot **could** take from that buy, not what anyone took. Buys that did not fill have zero room. k=3.');
P();
P('For Rung two readings are given. **Naive**: the filled rung\'s own bound (`max(seen/(1+cap), start/(1+rung))`). **Adversarial**: a bot that front-runs the *opening* transaction also moves `start` (open_order reads the reserves in the same transaction), so on the first try only the cap bound protects; later tries use the stored `start` and are the same as naive.');
P();
P('| strategy | total room, SOL | mean room per filled buy | mean room per buy (all buys) | adversarial total, SOL | adversarial mean per filled |');
P('|---|---|---|---|---|---|');
for (const name of STRATS) {
  const o = main.strategies[name];
  P(`| ${name} | ${sol(o.roomSolTotal, 2)} | ${pct(o.roomPctMeanPerFilled, 2)} | ${pct(o.roomPctMeanPerBuy, 2)} | ${o.roomSolTotalAdversarial != null ? sol(o.roomSolTotalAdversarial, 2) : '= naive'} | ${o.roomPctMeanPerFilledAdversarial != null ? pct(o.roomPctMeanPerFilledAdversarial, 2) : ''} |`);
}
P();
P(`Total SOL spent by these ${main.n} buys: ${sol(main.totalSpendSol, 1)} SOL.`);
P();
const sw = results.sandwiches;
P('## D. Real sandwiches in the tape');
P();
P(`Pattern: a buy by wallet X, then 1–3 buys by other wallets, then a sell that is either by X (same wallet) or sells within 1% of the token amount X bought (two-wallet bot), all within the same or the next slot, in the reserve-chained execution order. Over all trades in the fetched windows (not only the first ${BUY_SEC / 60} minutes).`);
P();
P(`- Sandwiches found: **${sw.count}** (same wallet ${sw.sameWallet}, two-wallet ${sw.twoWallet}); victims: **${sw.victims}** (for scale: ${sw.buysInWindow} buys in the first ${BUY_SEC / 60} min).`);
P(`- Victims spent ${sol(sw.victimSpendSol, 2)} SOL and overpaid **${sol(sw.overpaidSolTotal, 3)} SOL** in total versus the pre-attack price (median ${pct(sw.overpaidFracMedian, 2)} per victim).`);
P(`- Price push by the front-run: median ${pct(sw.pushMedian, 2)}, p90 ${pct(sw.pushP90, 2)}. Bot net SOL (back-run out − front-run in, fees excluded): ${sol(sw.botPnlSolTotal, 3)} SOL.`);
P(`- Victims' typed slippage (against the pre-attack state): decoded for ${sw.typedDecoded}; median ${pct(sw.typedVsPreMedian, 1)}; unprotected (min out ≈ 0) ${sw.typedUnprotected}.`);
P(`- Rung Tight 1/2/3 at that moment (quote seen = pre-attack state, landing where the victim landed): first rung fills ${sw.rungTight.firstRung}, a later rung fills ${sw.rungTight.laterRung}, not bought ${sw.rungTight.notBought}. Paid vs pre-attack price: first-rung fills median ${pct(sw.rungTight.paidVsPreMedianFirst, 2)}, later-rung fills median ${pct(sw.rungTight.paidVsPreMedianLater, 2)}. As implemented, the 1% of the first rung is measured from \`start\`, which is read *after* the front-run; the first try is bounded only by the 3% cap from the seen quote.`);
P(`- A plain fixed 1% from the seen (pre-attack) quote would have filled ${sw.fixed1VsPreWouldFill} of ${sw.victims}.`);
P();
P('Five clearest examples (same wallet, largest victim overpayment):');
P();
P('| token | slot | push | victim overpaid | victim typed slippage | Rung Tight | front-run | victim | back-run |');
P('|---|---|---|---|---|---|---|---|---|');
for (const s of sw.examples) {
  const v = [...s.victims].sort((a, b) => b.overpaidSol - a.overpaidSol)[0];
  const rt = v.rungTight ? (v.rungTight.j === 0 ? `rung 1 fills (+${pct(v.rungTight.paidVsPre, 2)} vs pre)` : `rung ${v.rungTight.j + 1} fills (${pct(v.rungTight.paidVsPre, 2)} vs pre)`) : 'not bought';
  P(`| ${s.mint.slice(0, 6)}… | ${s.slot} | ${pct(s.pushed, 2)} | ${sol(v.overpaidSol, 4)} SOL (${pct(v.overpaidFrac, 2)}) | ${v.typedVsPre === Infinity ? 'unprotected' : pct(v.typedVsPre, 1)} | ${rt} | \`${s.front}\` | \`${v.sig}\` | \`${s.back}\` |`);
}
P();
P('## E. What the fixed-3% buyer missed (opportunity, not profit)');
P();
P('For buys where fixed 3% would not have filled: the curve price 1, 5 and 10 minutes later relative to the price the user saw. This is a price path, not a profit: it ignores the exit, fees, and that the buyer may have sold earlier or later. If the curve completed (migrated to PumpSwap) before that time, the completion price is used and counted separately.');
P();
P('| k | buys fixed 3% missed | +1 min: median, share higher | +5 min | +10 min | of which curve completed by +1 / +5 / +10 min |');
P('|---|---|---|---|---|---|');
for (const k of K_LIST) {
  const e = results.missedByFixed3[k];
  P(`| ${k} | ${e.n} | ${pct(e[1].medianAll)}, ${pct(e[1].shareHigherAll)} | ${pct(e[5].medianAll)}, ${pct(e[5].shareHigherAll)} | ${pct(e[10].medianAll)}, ${pct(e[10].shareHigherAll)} | ${e[1].nCurveCompleted} / ${e[5].nCurveCompleted} / ${e[10].nCurveCompleted} |`);
}
P();
P('## Typed slippage of the real buyers');
P();
const ts = results.typedSlippage;
P(`Decoded from the buy instruction (exact-in: \`min_tokens_out\`; exact-tokens: \`max_sol_cost\`) for ${ts.decoded} buys.`);
P();
P('| reference | n | median | p25–p75 | ≤3% | ≤5% | ≥20% | unprotected (≥99% / min out 0) |');
P('|---|---|---|---|---|---|---|---|');
for (const [lab, o] of [['quote seen k=3', ts.vsSeenK3], ['state at landing', ts.vsLanding], ['exact-in only (k=3)', ts.exactIn], ['max-cost only (k=3)', ts.maxCost]]) P(`| ${lab} | ${o.n} | ${pct(o.median)} | ${pct(o.p25)}–${pct(o.p75)} | ${pct(o.le3)} | ${pct(o.le5)} | ${pct(o.ge20)} | ${pct(o.unprotected)} |`);
P();
P('## Tokens');
P();
P('"Became large": market cap of the canonical PumpSwap pool at the snapshot time (pool reserves × supply, from the public RPC), and whether the curve completed. Peak curve market cap is from the trade events.');
P();
P('| mint | name | created (UTC) | curve trades fetched | buys in first 10 min | curve completed after | peak curve mcap, SOL | pool mcap now, SOL (snapshot) | slots chained / fallback |');
P('|---|---|---|---|---|---|---|---|---|');
for (const t of tokenRows) P(`| \`${t.mint}\` | ${t.name || ''} | ${t.created.slice(0, 16)} | ${t.trades} | ${t.buysInWindow} | ${t.curveCompleted ? (t.completedAfterSec / 60).toFixed(1) + ' min' : 'not in window'} | ${sol(t.peakCurveMcapSol, 0)} | ${t.poolMcapSolNow != null ? sol(t.poolMcapSolNow, 0) + ' (' + (t.poolSnapshotAt || '').slice(0, 16) + ')' : t.poolError || '–'} | ${t.chain.slotsChained} / ${t.chain.slotsFallback} |`);
for (const n of fetchNotes) P(`| \`${n.mint}\` | ${n.name || ''} | – | – | – | – | – | – | dropped: ${n.why} |`);
P();
P('Per token, k=3, fill:');
P();
P(`| mint | n | ${STRATS.join(' | ')} |`);
P(`|---|---|${STRATS.map(() => '---').join('|')}|`);
for (const t of tokenRows) { const a = results.byKToken[K_MAIN][t.mint]; P(`| ${t.mint.slice(0, 6)}… | ${a.n} | ${STRATS.map((s) => pct(a.strategies[s]?.fill)).join(' | ')} |`); }
P();
P('## Method and limits');
P();
P('**Measured from chain data:** each trade\'s slot, signer, SOL and token amounts, fees and the curve\'s virtual reserves after the trade (pump TradeEvent); the buy instruction\'s arguments (slippage bound); the execution order inside each slot (recovered by chaining reserves: each trade\'s pre-trade reserves equal the previous trade\'s post-trade reserves); block times; sandwich patterns; pool market cap at the snapshot.');
P();
P(`**Reconstruction check:** for ${results.validation.exactInBuys} exact-in buys, the client\'s quote formula on the reconstructed pre-trade state reproduces the tokens actually received with median relative error ${results.validation.medianRelErr?.toExponential(2)} (p99 ${results.validation.p99RelErr?.toExponential(2)}; ${pct(results.validation.within1bp)} within 0.01%).`);
P();
P('**Assumed in the simulation:**');
P(`1. Quote age: the user saw the curve at the end of slot (landing slot − k), k ∈ {1, 3, 5}. Buys in the first k slots of a curve "saw" the initial curve.`);
P('2. The order lands exactly where the real buy landed (same position in the same slot). Fixed buys and the first Rung try use that state.');
P(`3. Later Rung tries land at landing slot + ${WINDOW_SLOTS}·i, against the curve state at the start of that slot (before any trade in it). A try due after the curve completed fails.`);
P('4. Each counterfactual buy is replayed alone: it does not move the tape, and other traders (including sandwich bots) are assumed to act as they did. In reality a bot that sees a tighter bound pushes less or not at all, so section D shows what the bound would have allowed, not how bots would react.');
P('5. Fees: the rates in the real buy\'s TradeEvent (protocol + creator), applied with the client\'s fee arithmetic. Older event layouts without fee fields: 1% (pump\'s fee at that time).');
P('6. Spend = the real buy\'s SOL into the curve + its fees. The hypothetical user spends that amount.');
P('7. Room (C) is an upper bound of what a sandwich could take, not money taken. The "adversarial" Rung reading assumes the bot front-runs the transaction that opens the order.');
P('8. Part E uses the spot curve price (virtual SOL / virtual tokens); after completion the last curve price stands in. Not a profit.');
P();
P('**Not covered:** PumpSwap trading after migration; failed real transactions (only counted); buys routed in ways that hide the pump instruction (their slippage is not decoded but they are in the fill tables); Jito bundle structure (sandwich detection is by order and wallet/amount, so it is a lower bound for multi-wallet bots and can include false positives where an unrelated sell matches the amount).');
P();
if (fetchNotes.length) { P('**Tokens dropped:**'); for (const n of fetchNotes) P(`- \`${n.mint}\`${n.name ? ' (' + n.name + ')' : ''}: ${n.why}`); P(); }
fs.writeFileSync(path.join(REPLAY_DIR, 'results', `replay-${DATE}.md`), L.join('\n'));
console.log(L.join('\n'));
