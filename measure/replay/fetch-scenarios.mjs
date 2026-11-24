// Stage 2: choose the scenario windows (deterministically, from cache/graduates.json and tokens.json)
// and fetch their transactions. Read-only, cached.
//
//   node fetch-scenarios.mjs plan            -> cache/plan.json (no network except pool anchors for S3)
//   node fetch-scenarios.mjs fetch [S1|S2|S3] -> transactions into the RPC cache, progress in cache/fetch2.log
//
// S1 "hyped launch":  graduates ranked by successful curve transactions in their first 60 s (ties: first 300 s);
//                     window = creation .. +5 min, at most CAP_S1 successful transactions from the start.
// S2 "volatile, not the launch": for each graduate whose curve lived >= 15 min, the 5-minute window starting
//                     >= 10 min after creation with the most successful curve transactions; the windows with
//                     the highest counts are taken (one per token), at most CAP_S2 transactions each.
// S3 "calm": the canonical PumpSwap pools of the deep, established tokens in tokens.json (calmPools), 10-minute
//                     windows at fixed times (every 8 h back from the plan's anchor), at most CAP_S3 each.
// Every window also gets a price grid (one transaction per GRID_STEP seconds up to 11 min after the window)
// for part E (price 1/5/10 min later).
import fs from 'node:fs';
import path from 'node:path';
import { rpc, stats, CACHE_DIR, REPLAY_DIR } from './lib/rpc.mjs';
import zlib from 'node:zlib';
import { canonicalPoolPda, bondingCurvePda, b58 } from './lib/solana.mjs';
import { tradesOfTx } from './lib/pump.mjs';
import { poolTradeOfTx } from './lib/pool.mjs';

const N_S1 = Number(process.env.N_S1 || 12), S1_SEC = Number(process.env.S1_SEC || 40);
const SAMPLE_S1 = Number(process.env.SAMPLE_S1 || 120), CONTIG_S1 = 0;
const N_S2 = Number(process.env.N_S2 || 15), CAP_S2 = Number(process.env.CAP_S2 || 500);
const S3_WINDOWS = Number(process.env.S3_WINDOWS || 6), CAP_S3 = Number(process.env.CAP_S3 || 300);
const GRID_STEP = 15, GRID_STEP_S1 = 30, GRID_STEP_S3 = 60, AFTER = 660; // calm pools move slowly: a 60 s grid is enough there
const TX_OPTS = { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'confirmed' };
const LOG = path.join(CACHE_DIR, 'fetch2.log');
const log = (...a) => { const l = `${new Date().toISOString()} ${a.join(' ')}`; console.log(l); fs.appendFileSync(LOG, l + '\n'); };
const PLAN = path.join(CACHE_DIR, 'plan.json');
// trade-only index: signatures of the curve's own token account (scan-ata.mjs)
const sigsOf = (mint) => JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'atasigs', `${mint}.json`), 'utf8'));

async function blockAt(slot) {
  for (let s = slot; s < slot + 50; s++) {
    const b = await rpc('getBlock', [s, { transactionDetails: 'signatures', rewards: false, maxSupportedTransactionVersion: 1, commitment: 'confirmed' }]);
    if (b && b.signatures?.length) return { sig: b.signatures[0], slot: s, t: b.blockTime };
  }
  return null;
}

async function plan() {
  // Candidates and their trade-only signature lists come from scan-ata.mjs (curve token-account signatures).
  const rank = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'ata-rank.json'), 'utf8'));
  const tokens = JSON.parse(fs.readFileSync(path.join(REPLAY_DIR, 'tokens.json'), 'utf8'));
  const segs = [];
  // S1: the S1 candidates ranked by successful curve token-account transactions (trades) in the first 60 s
  const s1 = Object.values(rank).filter((x) => x.s1Candidate && x.complete).sort((a, b) => b.first60.ok - a.first60.ok || b.first300.ok - a.first300.ok || (a.mint < b.mint ? -1 : 1)).slice(0, N_S1);
  for (const x of s1) {
    const sg = sigsOf(x.mint);
    const t0 = sg.t0;
    const tC = sg.migrationT;
    // Block mode: these launches run at 30-60 successful transactions per second, ~85% of them bots' no-op
    // checks that touch the curve without trading, and nothing in a signature list tells them apart. So the
    // window's blocks are read instead (getBlock, transactionDetails 'accounts': every transaction's account
    // keys and pre/post balances, no instruction data), which gives every trade on the curve in block order
    // with exact reserves. A sample of SAMPLE_S1 transactions is also fetched in full (getTransaction) to
    // calibrate virtual reserves and fees from pump's TradeEvent and to decode typed slippage.
    const to = Math.min(t0 + S1_SEC, tC);
    segs.push({ id: `S1-${x.mint}`, scenario: 'S1', venue: 'curve', mint: x.mint, from: t0, to, blockMode: true, sample: SAMPLE_S1, gridTo: Math.min(to + AFTER, tC), rank: { first60ok: x.first60.ok, first300ok: x.first300.ok } });
  }
  // S2
  const cands = [];
  for (const x of Object.values(rank).filter((r) => r.s2Candidate && r.complete)) {
    const sg = sigsOf(x.mint);
    const t0 = sg.t0, tC = sg.migrationT;
    if (tC - t0 < 900) continue;
    const ok = sg.sigs.filter((s) => s.ok);
    let best = null;
    // windows aligned to whole minutes after creation, start >= t0 + 600, end <= tC
    let lo = 0, hi = 0; // two pointers: ok sigs with st <= t < st + 300
    for (let st = t0 + 600; st + 300 <= tC; st += 60) {
      while (lo < ok.length && ok[lo].t < st) lo++;
      while (hi < ok.length && ok[hi].t < st + 300) hi++;
      const c = hi - lo;
      if (!best || c > best.count) best = { from: st, to: st + 300, count: c };
    }
    if (best) cands.push({ mint: x.mint, ...best, tC });
  }
  cands.sort((a, b) => b.count - a.count || (a.mint < b.mint ? -1 : 1));
  for (const c of cands.slice(0, N_S2)) segs.push({ id: `S2-${c.mint}`, scenario: 'S2', venue: 'curve', mint: c.mint, from: c.from, to: c.to, cap: CAP_S2, capFrom: 'start', gridTo: Math.min(c.to + AFTER, c.tC), rank: { okInWindow: c.count } });
  // S3
  const disc = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'discover.json'), 'utf8'));
  const calm = tokens.filter((t) => t.calmPool);
  const anchorFile = path.join(CACHE_DIR, 's3-anchor.json');
  let anchor = fs.existsSync(anchorFile) ? JSON.parse(fs.readFileSync(anchorFile, 'utf8')) : null;
  if (!anchor) { const slot = await rpc('getSlot', [{ commitment: 'finalized' }], { cache: false }); anchor = { slot: slot - 3000, at: new Date().toISOString() }; fs.writeFileSync(anchorFile, JSON.stringify(anchor)); }
  for (let k = 0; k < S3_WINDOWS; k++) {
    const endSlot = anchor.slot - k * 72000; // ~8 h at ~0.4 s/slot
    const b = await blockAt(endSlot);
    if (!b) continue;
    for (const t of calm) {
      const d = disc[t.mint];
      if (!d?.pool) continue;
      // window = 10 min that ends AFTER (11 min) before the anchor block, so the grid fits before the anchor
      const to = b.t - AFTER, from = to - 600;
      segs.push({ id: `S3-${t.mint}-${k}`, scenario: 'S3', venue: 'pool', mint: t.mint, pool: d.pool, from, to, cap: CAP_S3, capFrom: 'start', gridTo: b.t, anchorSig: b.sig, anchorSlot: b.slot });
    }
  }
  fs.writeFileSync(PLAN, JSON.stringify({ created: new Date().toISOString(), params: { N_S1, S1_SEC, CONTIG_S1, SAMPLE_S1, N_S2, CAP_S2, S3_WINDOWS, CAP_S3, GRID_STEP, AFTER }, segs }, null, 1));
  log('plan', segs.length, 'segments:', ['S1', 'S2', 'S3'].map((s) => `${s}=${segs.filter((x) => x.scenario === s).length}`).join(' '));
}

async function poolMeta(pool) {
  const acc = await rpc('getAccountInfo', [pool, { encoding: 'base64', commitment: 'confirmed' }]);
  const d = Buffer.from(acc.value.data[0], 'base64');
  let vq = 0n;
  if (d.length >= 261) vq = (BigInt(d.readBigInt64LE(253)) << 64n) + d.readBigUInt64LE(245);
  return { baseTa: b58.encode(d.subarray(139, 171)), quoteTa: b58.encode(d.subarray(171, 203)), vq: vq.toString(), dataLength: d.length };
}

async function segmentSigs(seg, meta) {
  if (seg.venue === 'curve') return sigsOf(seg.mint).sigs.filter((s) => s.t >= seg.from && s.t <= seg.gridTo);
  // pool: the pool's base token account (moved by every swap; fewer no-op references than the pool account)
  const out = [];
  let before = seg.anchorSig;
  for (let p = 0; p < 200; p++) {
    const page = await rpc('getSignaturesForAddress', [meta.baseTa, { limit: 1000, before, commitment: 'confirmed' }]);
    if (!page?.length) break;
    out.push(...page);
    if (page.at(-1).blockTime < seg.from || page.length < 1000) break;
    before = page.at(-1).signature;
  }
  return out.reverse().filter((s) => s.blockTime >= seg.from && s.blockTime <= seg.gridTo).map((s) => ({ sig: s.signature, slot: s.slot, idx: s.transactionIndex ?? null, t: s.blockTime, ok: s.err ? 0 : 1, code: (() => { const c = s.err?.InstructionError?.[1]; return c && typeof c === 'object' ? c.Custom ?? null : null; })() }));
}

/** Does this transaction trade on the segment's venue? (curve: a pump TradeEvent for the mint; pool: a base balance change) */
function tradesIn(seg, t, meta) {
  if (seg.venue === 'curve') return tradesOfTx(t, seg.mint, bondingCurvePda(seg.mint)).trades.length > 0;
  const tr = poolTradeOfTx(t, seg.pool, meta.baseTa, meta.quoteTa, BigInt(meta.vq));
  return !!tr && !tr.liquidity;
}

/**
 * Block mode: read each slot's block with transactionDetails 'accounts' and keep, for every transaction that
 * touches the curve, what build.mjs needs (signature, error, signer, the curve's lamports and the curve token
 * account's balance before/after). The full block response (MBs) is not kept; this extract is the cache:
 * cache/blocks/<mint>/<slot>.json.gz.
 */
async function fetchBlocks(seg, slots) {
  const curve = bondingCurvePda(seg.mint);
  const dir = path.join(CACHE_DIR, 'blocks', seg.mint);
  fs.mkdirSync(dir, { recursive: true });
  let next = 0, done = 0, failed = 0;
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (next < slots.length) {
      const slot = slots[next++];
      const f = path.join(dir, `${slot}.json.gz`);
      if (fs.existsSync(f)) { done++; continue; }
      const b = await rpc('getBlock', [slot, { transactionDetails: 'accounts', rewards: false, maxSupportedTransactionVersion: 1, commitment: 'confirmed' }], { cache: false });
      if (!b) { failed++; continue; }
      const txs = [];
      b.transactions.forEach((tx, idx) => {
        const keys = tx.transaction.accountKeys.map((k) => k.pubkey);
        const ci = keys.indexOf(curve);
        if (ci < 0) return;
        const tb = (arr) => { const e = (arr || []).find((x) => x.owner === curve && x.mint === seg.mint); return e ? { i: e.accountIndex, a: e.uiTokenAmount.amount } : null; };
        const pre = tb(tx.meta.preTokenBalances), post = tb(tx.meta.postTokenBalances);
        txs.push({ idx, sig: tx.transaction.signatures[0], signer: keys[0], err: tx.meta.err ? 1 : 0, fee: tx.meta.fee, lam0: tx.meta.preBalances[ci], lam1: tx.meta.postBalances[ci], tok0: pre?.a ?? null, tok1: post?.a ?? null });
      });
      fs.writeFileSync(f, zlib.gzipSync(JSON.stringify({ slot, blockTime: b.blockTime, nTx: b.transactions.length, txs })));
      done++;
    }
  }));
  log(seg.id, 'blocks', done, '/', slots.length, 'failed', failed);
}

async function fetchSeg(seg) {
  const f = path.join(CACHE_DIR, 'segs', `${seg.id}.json`);
  let rec = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  if (!rec) {
    const meta = seg.venue === 'pool' ? await poolMeta(seg.pool) : null;
    const all = await segmentSigs(seg, meta);
    const inWin = all.filter((s) => s.t >= seg.from && s.t <= seg.to);
    const okWin = inWin.filter((s) => s.ok);
    let full = inWin, truncatedAt = null, contigLastSlot = null, blockSlots = null;
    if (seg.blockMode) {
      // every slot with a successful curve transaction is read as a block; an even sample is fetched in full
      blockSlots = [...new Set(okWin.map((s) => s.slot))].sort((a, b) => a - b);
      const step = Math.max(1, Math.ceil(okWin.length / seg.sample));
      full = okWin.filter((_, i) => i % step === 0);
    } else if (okWin.length > seg.cap) {
      const lastSlot = okWin[seg.cap - 1].slot; // keep whole slots
      full = inWin.filter((s) => s.slot <= lastSlot);
      truncatedAt = full.at(-1).t;
    }
    // price grid: the last successful signature at or before each grid time, after the fully fetched part
    const okAll = all.filter((s) => s.ok);
    const grid = [];
    const gridStart = truncatedAt ?? seg.to;
    const step = seg.scenario === 'S3' ? GRID_STEP_S3 : seg.scenario === 'S1' ? GRID_STEP_S1 : GRID_STEP;
    for (let T = seg.from + step; T <= seg.gridTo; T += step) {
      if (T <= gridStart) continue;
      let j = -1;
      for (let i = 0; i < okAll.length && okAll[i].t <= T; i++) j = i;
      // up to 12 candidates going back: build.mjs walks them until one is a real trade
      if (j >= 0) grid.push({ T, sigs: okAll.slice(Math.max(0, j - 11), j + 1).map((s) => s.sig).reverse() });
    }
    rec = { ...seg, meta, sigs: full, blockSlots, sigsAllCount: inWin.length, okInWindow: okWin.length, failedInWindow: inWin.filter((s) => !s.ok).length, slipFailedInWindow: inWin.filter((s) => [6002, 6003, 6042, 6004, 6040].includes(s.code)).length, truncatedAt, contigLastSlot, slotsWithTrades: new Set(okWin.map((s) => s.slot)).size, grid };
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(rec));
  }
  const want = rec.sigs.filter((s) => s.ok).map((s) => s.sig);
  let n = 0, next = 0, missing = 0;
  const worker = async () => {
    while (next < want.length) {
      const sig = want[next++];
      const t = await rpc('getTransaction', [sig, TX_OPTS]);
      if (!t) missing++;
      n++;
    }
  };
  await Promise.all(Array.from({ length: Number(process.env.CONCURRENCY || 6) }, worker));
  // grid: walk back until a transaction that traded on the venue (bots' no-op checks are skipped)
  const gridIdx = { next: 0 };
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (gridIdx.next < rec.grid.length) {
      const g = rec.grid[gridIdx.next++];
      for (const sig of g.sigs) { const t = await rpc('getTransaction', [sig, TX_OPTS]); n++; if (t && tradesIn(seg, t, rec.meta)) break; }
    }
  }));
  if (rec.blockSlots) await fetchBlocks(seg, rec.blockSlots);
  log(seg.id, 'tx', n, 'missing', missing, 'ok in window', rec.okInWindow, rec.truncatedAt ? `truncated at +${rec.truncatedAt - seg.from}s` : 'full', 'reqs', stats.requests, '429s', stats.http429);
}

const cmd = process.argv[2];
if (cmd === 'plan') await plan();
else if (cmd === 'fetch') {
  const p = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
  const only = process.argv[3];
  for (const seg of p.segs.filter((s) => !only || s.scenario === only)) {
    try { await fetchSeg(seg); } catch (e) { log(seg.id, 'FAILED', e.message); }
  }
  log('fetch done', only || 'all', JSON.stringify(stats));
} else console.log('usage: node fetch-scenarios.mjs plan | fetch [S1|S2|S3]');
