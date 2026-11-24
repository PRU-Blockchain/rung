// Step 2: turn the cached transactions into one ordered trade tape per token.
//
//   node build.mjs [mint ...]     (default: every mint with a complete cache/sigs/<mint>.json)
//
// Order within a slot: the transactions are chained by curve reserves (each trade's "state before",
// derived from its event, must equal the previous trade's "state after"). That recovers the real
// execution order without fetching whole blocks. Slots where the chain does not close fall back to
// the getSignaturesForAddress order and are counted.
// Output: cache/tape/<mint>.json
import fs from 'node:fs';
import path from 'node:path';
import { rpc, CACHE_DIR } from './lib/rpc.mjs';
import { tradesOfTx, stateBefore } from './lib/pump.mjs';

const TX_OPTS = { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'confirmed' };
fs.mkdirSync(path.join(CACHE_DIR, 'tape'), { recursive: true });

const num = (x) => (x === undefined || x === null ? null : Number(x));
const same = (a, b) => a.vs === b.vs && a.vt === b.vt;

export async function buildMint(mint) {
  const rec = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'sigs', `${mint}.json`), 'utf8'));
  if (!rec.complete) return { mint, ok: false, why: rec.why };
  const txs = [];
  let missing = 0, createSlot = null, noTrade = 0;
  for (let i = 0; i < rec.sigs.length; i++) {
    const s = rec.sigs[i];
    if (!s.ok) continue;
    const t = await rpc('getTransaction', [s.sig, TX_OPTS]);
    if (!t) { missing++; continue; }
    const { trades, created } = tradesOfTx(t, mint, rec.curve);
    if (created && createSlot === null) createSlot = t.slot;
    if (!trades.length) { noTrade++; continue; }
    const topProgs = [...new Set(t.transaction.message.instructions.map((ix) => t.transaction.message.accountKeys[ix.programIdIndex]))];
    txs.push({ sig: s.sig, slot: t.slot, t: t.blockTime, rpcOrder: i, fee: t.meta.fee, topProgs, trades });
  }
  // Group by slot, chain by reserves.
  const bySlot = new Map();
  for (const x of txs) { if (!bySlot.has(x.slot)) bySlot.set(x.slot, []); bySlot.get(x.slot).push(x); }
  const slots = [...bySlot.keys()].sort((a, b) => a - b);
  const ordered = [];
  let cur = null;
  let slotsChained = 0, slotsFallback = 0, multiTxSlots = 0, breaks = 0;
  for (const sl of slots) {
    const group = bySlot.get(sl).sort((a, b) => a.rpcOrder - b.rpcOrder);
    if (group.length > 1) multiTxSlots++;
    let out = [];
    if (cur === null) {
      // First slot with trades: find the tx whose first trade's "before" state no other trade produces.
      const afters = group.flatMap((x) => x.trades.map((tr) => ({ vs: tr.vs, vt: tr.vt })));
      const head = group.find((x) => !afters.some((a) => same(a, stateBefore(x.trades[0]))));
      if (head) cur = stateBefore(head.trades[0]);
    }
    const left = group.slice();
    let okChain = cur !== null;
    while (left.length && okChain) {
      const i = left.findIndex((x) => same(stateBefore(x.trades[0]), cur));
      if (i < 0) { okChain = false; break; }
      const x = left.splice(i, 1)[0];
      // trades inside one transaction must chain too
      for (const tr of x.trades) { if (!same(stateBefore(tr), cur)) breaks++; cur = { vs: tr.vs, vt: tr.vt }; }
      out.push(x);
    }
    if (okChain) slotsChained++;
    else {
      slotsFallback++;
      out = group; // rpc order
      const last = group.at(-1).trades.at(-1);
      cur = { vs: last.vs, vt: last.vt };
    }
    ordered.push(...out);
  }
  // Flatten to a trade tape.
  const tape = [];
  let prevAfter = null, gaps = 0;
  for (const x of ordered) {
    let posInSlot = 0;
    for (const tr of x.trades) {
      const before = stateBefore(tr);
      if (prevAfter && !same(before, prevAfter)) gaps++;
      tape.push({
        sig: x.sig, slot: x.slot, t: x.t, signer: tr.signer, user: tr.user, isBuy: tr.isBuy,
        sol: num(tr.sol), tok: num(tr.tok), vs: num(tr.vs), vt: num(tr.vt), rs: num(tr.rs), rt: num(tr.rt),
        vs0: num(before.vs), vt0: num(before.vt),
        fee: num(tr.fee), cfee: num(tr.cfee), feeBps: num(tr.feeBps), cfeeBps: num(tr.cfeeBps),
        ix: tr.ix ? { n: tr.ix.ixName, kind: tr.ix.kind || null, a1: num(tr.ix.a1), a2: num(tr.ix.a2), top: tr.ix.top } : null,
        txFee: x.fee, topProgs: x.topProgs,
      });
      prevAfter = { vs: tr.vs, vt: tr.vt };
    }
  }
  tape.forEach((tr, i) => { tr.i = i; });
  // index within slot (execution order)
  let lastSlot = -1, k = 0;
  for (const tr of tape) { if (tr.slot !== lastSlot) { lastSlot = tr.slot; k = 0; } tr.slotIdx = k++; }
  const out = {
    mint, curve: rec.curve, t0: rec.t0, firstSlot: rec.firstSlot, createSlot, windowSec: rec.windowSec,
    sigsInWindow: rec.sigs.length, failedSigsInWindow: rec.sigs.filter((s) => !s.ok).length,
    txMissing: missing, txWithoutCurveTrade: noTrade,
    slots: slots.length, multiTxSlots, slotsChained, slotsFallback, intraTxBreaks: breaks, tapeGaps: gaps,
    initial: tape.length ? { vs: tape[0].vs0, vt: tape[0].vt0 } : null,
    completed: tape.some((x) => x.rt === 0),
    tape,
  };
  fs.writeFileSync(path.join(CACHE_DIR, 'tape', `${mint}.json`), JSON.stringify(out));
  const { tape: _, ...summary } = out;
  return { ...summary, trades: tape.length, buys: tape.filter((x) => x.isBuy).length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = path.join(CACHE_DIR, 'sigs');
  const mints = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(dir).map((f) => f.replace(/\.json$/, ''));
  for (const m of mints) console.log(JSON.stringify(await buildMint(m)));
}
