// Stage 3: turn each fetched scenario window (cache/segs/<id>.json) into an ordered trade tape.
//
//   node build.mjs [segment-id ...]     -> cache/tape2/<id>.json
//
// Curve windows: trades from pump's TradeEvent (lib/pump.mjs). Pool windows: reserves from the pool's
// token-account balances, fees/spend from PumpSwap's BuyEvent (lib/pool.mjs).
// Order within a slot: chained by reserves (each trade's pre-trade reserves = previous trade's post-trade
// reserves); getSignaturesForAddress's transactionIndex is the fallback and is checked against the chain.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { rpc, CACHE_DIR } from './lib/rpc.mjs';
import { tradesOfTx, stateBefore } from './lib/pump.mjs';
import { poolTradeOfTx } from './lib/pool.mjs';
import { bondingCurvePda } from './lib/solana.mjs';

const TX_OPTS = { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'confirmed' };
const OUT = path.join(CACHE_DIR, 'tape2');
fs.mkdirSync(OUT, { recursive: true });
const POOL_FEE_FALLBACK = [20, 5, 5]; // lp, protocol, creator bps; used only when a BuyEvent could not be read
const num = (x) => (x === undefined || x === null ? null : Number(x));

/** All trades (in-transaction order) of one transaction on the segment's venue, normalised. */
function tradesFor(seg, t, curve) {
  if (seg.venue === 'curve') {
    const { trades, created } = tradesOfTx(t, seg.mint, curve);
    return {
      created,
      trades: trades.map((tr) => {
        const b = stateBefore(tr);
        const hasFee = tr.feeBps != null;
        return {
          isBuy: tr.isBuy, sol: num(tr.sol), tok: num(tr.tok), vs: num(tr.vs), vt: num(tr.vt), vs0: num(b.vs), vt0: num(b.vt), rt: num(tr.rt),
          signer: tr.signer, user: tr.user,
          fees: hasFee ? [num(tr.feeBps), num(tr.cfeeBps ?? 0)] : [100],
          spend: tr.isBuy ? num(tr.sol) + (hasFee ? num(tr.fee) + num(tr.cfee ?? 0) : Math.ceil(num(tr.sol) / 100)) : null,
          feeFromEvent: hasFee,
          ix: tr.ix ? { n: tr.ix.ixName, kind: tr.ix.kind || null, a1: num(tr.ix.a1), a2: num(tr.ix.a2), top: tr.ix.top } : null,
        };
      }),
    };
  }
  const m = seg.meta;
  const tr = poolTradeOfTx(t, seg.pool, m.baseTa, m.quoteTa, BigInt(m.vq));
  if (!tr) return { trades: [] };
  if (tr.liquidity) return { trades: [{ liq: true, isBuy: false, sol: 0, tok: 0, vs: num(tr.vs), vt: num(tr.vt), vs0: num(tr.vs0), vt0: num(tr.vt0) }] };
  const fees = tr.feeBpsList || POOL_FEE_FALLBACK;
  // pool quote delta on a buy = net + lp fee; the buyer's total = net * (1 + all fees)
  const spendEst = tr.isBuy ? Math.round((tr.sol * (10000 + fees[0] + fees[1] + fees[2])) / (10000 + fees[0])) : null;
  return {
    trades: [{
      isBuy: tr.isBuy, sol: tr.sol, tok: tr.tok, vs: num(tr.vs), vt: num(tr.vt), vs0: num(tr.vs0), vt0: num(tr.vt0), rt: null,
      // spend from the pool's quote delta and the event's fee rates (reproduces the tokens received to
      // <0.1%, see the reconstruction check); the event's own amount fields are not used
      signer: tr.signer, user: tr.user, fees, spend: tr.isBuy ? spendEst : null, feeFromEvent: !!tr.eventOk, nSwaps: tr.nSwaps, ix: tr.ix,
    }],
  };
}

const same = (a, b) => a.vs === b.vs && a.vt === b.vt;

async function gridOf(seg, curve) {
  const grid = [];
  let tried = 0;
  for (const g of seg.grid || []) {
    for (const sig of g.sigs) {
      tried++;
      const t = await rpc('getTransaction', [sig, TX_OPTS]);
      const { trades } = t ? tradesFor(seg, t, curve) : { trades: [] };
      const last = trades.filter((x) => !x.liq).at(-1);
      if (last) { grid.push({ T: g.T, t: t.blockTime, vs: last.vs, vt: last.vt, rt: last.rt ?? null }); break; }
    }
  }
  return { grid, tried };
}

/**
 * Block mode (scenario 1): every transaction that touched the curve, from the block extracts, in block order.
 * A transaction traded iff the curve's token account balance changed. Virtual reserves = account balances +
 * constant offsets, calibrated on the fully fetched sample (pump TradeEvent reserves minus the same
 * transaction's post balances); the spread of the offsets is reported. Fee rates: from the sampled event
 * nearest in curve price. Typed slippage: only for sampled transactions.
 */
async function buildBlockSeg(seg) {
  const curve = bondingCurvePda(seg.mint);
  const offs = [], feeRef = [], ixOf = new Map(), evOf = new Map();
  let sampleTrades = 0, sampleNoTrade = 0;
  for (const s of seg.sigs) {
    const t = await rpc('getTransaction', [s.sig, TX_OPTS]);
    if (!t) continue;
    const { trades } = tradesOfTx(t, seg.mint, curve);
    if (!trades.length) { sampleNoTrade++; continue; }
    sampleTrades++;
    const keys = [...t.transaction.message.accountKeys, ...(t.meta.loadedAddresses?.writable || []), ...(t.meta.loadedAddresses?.readonly || [])];
    const ci = keys.indexOf(curve);
    const post = (t.meta.postTokenBalances || []).find((x) => x.owner === curve && x.mint === seg.mint);
    const last = trades.at(-1);
    if (ci >= 0 && post) offs.push({ s: Number(last.vs) - t.meta.postBalances[ci], t: Number(last.vt) - Number(post.uiTokenAmount.amount), rt: last.rt != null ? Number(last.vt) - Number(last.rt) : null, k: BigInt(last.vs) * BigInt(last.vt) });
    for (const tr of trades) feeRef.push({ p: Number(tr.vs) / Number(tr.vt), fees: tr.feeBps != null ? [Number(tr.feeBps), Number(tr.cfeeBps ?? 0)] : [100] });
    if (trades.length === 1 && trades[0].ix) ixOf.set(s.sig, trades[0].ix);
    if (trades.length === 1) evOf.set(s.sig, { vs: Number(last.vs), vt: Number(last.vt), tok: Number(last.tok), isBuy: last.isBuy });
  }
  // pump curves can be quoted in a token other than SOL (TradeEvent: virtual SOL 0, quote reserves elsewhere).
  // Rung buys with SOL, so such curves are left out.
  const nonSolQuote = offs.length > 0 && offs.every((o) => o.k === 0n);
  if (nonSolQuote) {
    return { tape: [], grid: [], extra: { blockMode: true, nonSolQuote: true, blocks: seg.blockSlots.length, sampleFetched: seg.sigs.length, sampleTrades, sampleNoTrade, tapeGaps: 0 } };
  }
  const mode = (arr) => { const c = new Map(); for (const v of arr) c.set(v, (c.get(v) || 0) + 1); return [...c.entries()].sort((a, b) => b[1] - a[1])[0]; };
  // Token side: virtual tokens = the curve token account's balance + a constant (checked: offTokAgree).
  // SOL side: the curve account also keeps part of the fee (its lamport change exceeds the event's SOL amount
  // on buys), so lamports + constant does NOT track virtual SOL. pump's curve is constant-product with
  // floor rounding, so virtual SOL = k / virtual tokens with k from the sampled events (spread reported).
  const [offS, nS] = mode(offs.map((o) => o.s));
  const [offT, nT] = mode(offs.map((o) => o.t));
  const ks = offs.map((o) => o.k).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const K = ks[Math.floor(ks.length / 2)];
  const kSpread = ks.length ? Number(ks.at(-1) - ks[0]) / Number(ks[0]) : null;
  void offS;
  const [offRT] = mode(offs.map((o) => o.rt).filter((x) => x != null)) || [null];
  const feesAt = (p) => { let best = null; for (const r of feeRef) if (!best || Math.abs(Math.log(r.p / p)) < Math.abs(Math.log(best.p / p))) best = r; return best ? best.fees : [100]; };
  const dir = path.join(CACHE_DIR, 'blocks', seg.mint);
  const tape = [];
  let blocksMissing = 0, touched = 0, failed = 0, netted = 0;
  for (const slot of seg.blockSlots) {
    const f = path.join(dir, `${slot}.json.gz`);
    if (!fs.existsSync(f)) { blocksMissing++; continue; }
    const b = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString());
    for (const x of b.txs) {
      touched++;
      if (x.err) { failed++; continue; }
      if (x.tok0 == null || x.tok1 == null || x.tok0 === x.tok1) continue;
      const tok0 = Number(x.tok0), tok1 = Number(x.tok1);
      const isBuy = tok1 < tok0;
      if ((isBuy && x.lam1 < x.lam0) || (!isBuy && x.lam1 > x.lam0)) netted++;
      const vt0 = tok0 + offT, vt = tok1 + offT;
      const vs0 = Number(K / BigInt(vt0)), vs = Number(K / BigInt(vt));
      const sol = Math.abs(vs - vs0), tok = Math.abs(tok1 - tok0);
      const fees = feesAt(vs0 / vt0);
      const ix = ixOf.get(x.sig) || null;
      tape.push({
        sig: x.sig, slot, t: b.blockTime, txFee: x.fee, isBuy, sol, tok, vs0, vt0, vs, vt, rt: offRT != null ? vt - offRT : null,
        signer: x.signer, user: x.signer, fees, spend: isBuy ? sol + fees.reduce((a, bps) => a + Math.ceil((sol * bps) / 10000), 0) : null, feeFromEvent: false,
        ix: ix ? { n: ix.ixName, kind: ix.kind || null, a1: num(ix.a1), a2: num(ix.a2), top: ix.top } : null,
      });
    }
  }
  tape.forEach((tr, i) => { tr.i = i; });
  // block-derived trades vs pump's own event for the sampled transactions
  let evChecked = 0, evTokExact = 0, evVsMaxRel = 0, evSideOk = 0;
  for (const tr of tape) {
    const ev = evOf.get(tr.sig);
    if (!ev) continue;
    evChecked++;
    if (tr.tok === ev.tok && tr.vt === ev.vt) evTokExact++;
    if (tr.isBuy === ev.isBuy) evSideOk++;
    evVsMaxRel = Math.max(evVsMaxRel, Math.abs(tr.vs / ev.vs - 1));
  }
  let gaps = 0;
  for (let i = 1; i < tape.length; i++) if (tape[i].vs0 !== tape[i - 1].vs || tape[i].vt0 !== tape[i - 1].vt) gaps++;
  const { grid, tried } = await gridOf(seg, curve);
  return {
    tape, grid,
    extra: {
      blockMode: true, blocks: seg.blockSlots.length, blocksMissing, txTouchingCurve: touched, txFailed: failed, trades: tape.length, nettedTx: netted,
      sampleFetched: seg.sigs.length, sampleTrades, sampleNoTrade, offsetSamples: offs.length, offSolAgree: nS, offTokAgree: nT, kSpread, gridTxTried: tried, evChecked, evTokExact, evSideOk, evVsMaxRel,
      tapeGaps: gaps,
    },
  };
}

export async function buildSeg(id) {
  const seg = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'segs', `${id}.json`), 'utf8'));
  const curve = seg.venue === 'curve' ? bondingCurvePda(seg.mint) : null;
  if (seg.blockMode) {
    const { tape, grid, extra } = await buildBlockSeg(seg);
    const out = {
      id: seg.id, scenario: seg.scenario, venue: seg.venue, mint: seg.mint, pool: null, from: seg.from, to: seg.to, gridTo: seg.gridTo, rank: seg.rank || null,
      truncatedAt: null, okInWindow: seg.okInWindow, failedInWindow: seg.failedInWindow, slipFailedInWindow: seg.slipFailedInWindow, txMissing: extra.blocksMissing,
      txNoTrade: null, createSeen: true, slots: extra.blocks, multiTxSlots: null, slotsChained: null, slotsFallback: 0, idxDisagree: 0, tapeGaps: extra.tapeGaps,
      ...extra, tape, grid,
    };
    fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(out));
    const { tape: _t, grid: _g, ...summary } = out;
    return { ...summary, buys: tape.filter((x) => x.isBuy).length, gridPoints: grid.length };
  }
  const txs = [];
  let missing = 0, noTrade = 0, createSeen = false;
  const sorted = seg.sigs.filter((s) => s.ok).map((s, j) => ({ ...s, j })).sort((a, b) => a.slot - b.slot || (a.idx ?? a.j) - (b.idx ?? b.j));
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    const t = await rpc('getTransaction', [s.sig, TX_OPTS]);
    if (!t) { missing++; continue; }
    const { trades, created } = tradesFor(seg, t, curve);
    if (created) createSeen = true;
    if (!trades.length) { noTrade++; continue; }
    txs.push({ sig: s.sig, slot: t.slot, idx: s.idx, t: t.blockTime, order: i, txFee: t.meta.fee, trades });
  }
  // chain within each slot
  const bySlot = new Map();
  for (const x of txs) { if (!bySlot.has(x.slot)) bySlot.set(x.slot, []); bySlot.get(x.slot).push(x); }
  const slots = [...bySlot.keys()].sort((a, b) => a - b);
  const ordered = [];
  let cur = null, slotsChained = 0, slotsFallback = 0, multiTxSlots = 0, idxDisagree = 0;
  const bef = (x) => ({ vs: x.trades[0].vs0, vt: x.trades[0].vt0 });
  let sparseSlots = 0;
  for (const sl of slots) {
    const group = bySlot.get(sl).sort((a, b) => a.order - b.order);
    if (group.length > 1) multiTxSlots++;
    if (seg.sparse && seg.contigLastSlot != null && sl > seg.contigLastSlot) {
      // sampled part: not every transaction of the slot was fetched; keep the transactionIndex order
      sparseSlots++;
      ordered.push(...group);
      const last = group.at(-1).trades.at(-1);
      cur = { vs: last.vs, vt: last.vt };
      continue;
    }
    if (cur === null) {
      const afters = group.flatMap((x) => x.trades.map((tr) => ({ vs: tr.vs, vt: tr.vt })));
      const head = group.find((x) => !afters.some((a) => same(a, bef(x))));
      cur = head ? bef(head) : bef(group[0]);
    }
    const left = group.slice();
    const out = [];
    let ok = true;
    let c = cur;
    while (left.length) {
      const i = left.findIndex((x) => same(bef(x), c));
      if (i < 0) { ok = false; break; }
      const x = left.splice(i, 1)[0];
      for (const tr of x.trades) c = { vs: tr.vs, vt: tr.vt };
      out.push(x);
    }
    if (ok) {
      slotsChained++;
      for (let i = 1; i < out.length; i++) if (out[i - 1].idx != null && out[i].idx != null && out[i - 1].idx > out[i].idx) idxDisagree++;
      ordered.push(...out);
      cur = c;
    } else {
      slotsFallback++;
      ordered.push(...group);
      const last = group.at(-1).trades.at(-1);
      cur = { vs: last.vs, vt: last.vt };
    }
  }
  const tape = [];
  let prev = null, gaps = 0;
  for (const x of ordered) {
    for (const tr of x.trades) {
      if (prev && !(prev.vs === tr.vs0 && prev.vt === tr.vt0) && !(seg.sparse && x.slot > seg.contigLastSlot)) gaps++;
      tape.push({ sig: x.sig, slot: x.slot, t: x.t, txFee: x.txFee, ...tr });
      prev = { vs: tr.vs, vt: tr.vt };
    }
  }
  const nonSolQuote = seg.venue === 'curve' && tape.length > 0 && tape.every((x) => x.vs === 0);
  if (nonSolQuote) tape.length = 0;
  tape.forEach((tr, i) => { tr.i = i; });
  // sparse windows: slots whose last successful transaction did not decode to a curve trade (end-of-slot state unknown)
  let slotEndMissing = 0;
  if (seg.sparse) {
    const have = new Set(txs.map((x) => x.sig));
    const lastOf = new Map();
    for (const s of seg.sigs) if (s.ok && s.t >= seg.from && s.t <= seg.to) { const p = lastOf.get(s.slot); if (!p || (s.idx ?? -1) > (p.idx ?? -1)) lastOf.set(s.slot, s); }
    for (const s of lastOf.values()) if (!have.has(s.sig)) slotEndMissing++;
  }
  // price grid after the fully fetched part (for part E): state after the last trade of the grid transaction
  const { grid } = await gridOf(seg, curve);
  const out = {
    id: seg.id, scenario: seg.scenario, venue: seg.venue, mint: seg.mint, pool: seg.pool || null, from: seg.from, to: seg.to, gridTo: seg.gridTo,
    rank: seg.rank || null, truncatedAt: seg.truncatedAt, nonSolQuote, sparse: !!seg.sparse, contigLastSlot: seg.contigLastSlot ?? null, sparseSlots, slotEndMissing, slotsWithTrades: seg.slotsWithTrades ?? null, okInWindow: seg.okInWindow, failedInWindow: seg.failedInWindow, slipFailedInWindow: seg.slipFailedInWindow,
    txMissing: missing, txNoTrade: noTrade, createSeen, slots: slots.length, multiTxSlots, slotsChained, slotsFallback, idxDisagree, tapeGaps: gaps,
    poolMeta: seg.meta, tape, grid,
  };
  fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(out));
  const { tape: _t, grid: _g, ...summary } = out;
  return { ...summary, trades: tape.length, buys: tape.filter((x) => x.isBuy).length, gridPoints: grid.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = path.join(CACHE_DIR, 'segs');
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(dir).map((f) => f.replace(/\.json$/, '')).sort();
  for (const id of ids) {
    try { console.log(JSON.stringify(await buildSeg(id))); } catch (e) { console.log(JSON.stringify({ id, error: e.message })); }
  }
}
