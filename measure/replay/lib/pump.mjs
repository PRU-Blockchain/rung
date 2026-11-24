// Decode pump.fun bonding-curve trades from a getTransaction (json encoding) result.
// Read-only, no network. Instruction and event layouts: docs/pump-arayuz.md, measure/lib/parse.mjs.
import crypto from 'node:crypto';
import { b58, PUMP } from './solana.mjs';

const sighash = (ns, name) => crypto.createHash('sha256').update(`${ns}:${name}`).digest().subarray(0, 8).toString('hex');

// Buy instructions: [kind, first u64 arg, second u64 arg].
//  'exactIn' : spendable_sol_in / spendable_quote_in, min_tokens_out
//  'maxCost' : amount (tokens), max_sol_cost
const BUY = {};
for (const n of ['buy_exact_sol_in', 'buy_exact_quote_in_v2', 'buy_exact_quote_in_v3', 'buy_exact_quote_in']) BUY[sighash('global', n)] = { n, kind: 'exactIn' };
for (const n of ['buy', 'buy_v2', 'buy_v3']) BUY[sighash('global', n)] = { n, kind: 'maxCost' };
const SELL = {};
for (const n of ['sell', 'sell_v2', 'sell_v3']) SELL[sighash('global', n)] = { n };
const CREATE = new Set(['create', 'create_v2'].map((n) => sighash('global', n)));
const TRADE_EVENT = sighash('event', 'TradeEvent');
const EV_TAG = 'e445a52e51cb9a1d'; // anchor emit_cpi prefix

// Sanity check against the bytes pinned in client/src/constants.ts.
if (sighash('global', 'buy_exact_quote_in_v3') !== Buffer.from([225, 247, 80, 30, 213, 179, 132, 136]).toString('hex')) throw new Error('discriminator mismatch');
if (TRADE_EVENT !== Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]).toString('hex')) throw new Error('event discriminator mismatch');

/** pump TradeEvent body (after the 8-byte discriminator). Fee fields only in newer layouts. */
function parseTradeEvent(d) {
  let o = 0;
  const pk = () => { const k = b58.encode(d.subarray(o, o + 32)); o += 32; return k; };
  const u64 = () => { const v = d.readBigUInt64LE(o); o += 8; return v; };
  const e = {};
  e.mint = pk(); e.sol = u64(); e.tok = u64(); e.isBuy = d[o++] === 1; e.user = pk(); e.ts = Number(d.readBigInt64LE(o)); o += 8;
  e.vs = u64(); e.vt = u64();
  if (d.length >= o + 16) { e.rs = u64(); e.rt = u64(); }
  if (d.length >= o + 32 + 8 + 8 + 32 + 8 + 8) {
    pk(); e.feeBps = u64(); e.fee = u64(); pk(); e.cfeeBps = u64(); e.cfee = u64();
  }
  return e;
}

function decodeEvent(buf) {
  // emit_cpi: tag(8) + disc(8) + body ; log "Program data:": disc(8) + body
  if (buf.length >= 16 && buf.subarray(0, 8).toString('hex') === EV_TAG && buf.subarray(8, 16).toString('hex') === TRADE_EVENT) return parseTradeEvent(buf.subarray(16));
  if (buf.length >= 8 && buf.subarray(0, 8).toString('hex') === TRADE_EVENT) return parseTradeEvent(buf.subarray(8));
  return null;
}

/**
 * Trades on `curve` (bonding-curve PDA of `mint`) in execution order within the transaction.
 * Each trade pairs a pump buy/sell instruction that touches the curve with the TradeEvent it emitted.
 */
export function tradesOfTx(t, mint, curve) {
  if (!t || !t.meta || t.meta.err) return { trades: [], created: false };
  const m = t.transaction.message;
  const keys = [...m.accountKeys, ...(t.meta.loadedAddresses?.writable || []), ...(t.meta.loadedAddresses?.readonly || [])];
  const signer = keys[0];
  // Execution order: each top-level instruction, then its inner instructions.
  const inner = new Map();
  for (const g of t.meta.innerInstructions || []) inner.set(g.index, g.instructions);
  const seq = [];
  m.instructions.forEach((ix, k) => { seq.push({ ix, top: true }); for (const j of inner.get(k) || []) seq.push({ ix: j, top: false }); });

  const pending = [];
  const trades = [];
  let created = false;
  let cpiEvents = 0;
  for (const { ix, top } of seq) {
    if (keys[ix.programIdIndex] !== PUMP) continue;
    const d = Buffer.from(b58.decode(ix.data));
    if (d.length < 8) continue;
    const disc = d.subarray(0, 8).toString('hex');
    const accs = ix.accounts.map((a) => keys[a]);
    if (disc === EV_TAG) {
      const e = decodeEvent(d);
      if (e && e.mint === mint) { cpiEvents++; attach(e); }
      continue;
    }
    if (!accs.includes(curve)) continue;
    if (CREATE.has(disc)) { created = true; continue; }
    if (BUY[disc] && d.length >= 24) pending.push({ side: 'buy', ixName: BUY[disc].n, kind: BUY[disc].kind, a1: d.readBigUInt64LE(8), a2: d.readBigUInt64LE(16), top });
    else if (SELL[disc] && d.length >= 24) pending.push({ side: 'sell', ixName: SELL[disc].n, a1: d.readBigUInt64LE(8), a2: d.readBigUInt64LE(16), top });
  }
  // Older pump versions logged the event ("Program data: <base64>") instead of a self-CPI.
  if (!cpiEvents) {
    for (const l of t.meta.logMessages || []) {
      if (!l.startsWith('Program data: ')) continue;
      let buf;
      try { buf = Buffer.from(l.slice(14), 'base64'); } catch { continue; }
      const e = decodeEvent(buf);
      if (e && e.mint === mint) attach(e);
    }
  }
  function attach(e) {
    const want = e.isBuy ? 'buy' : 'sell';
    const i = pending.findIndex((p) => p.side === want);
    const ix = i >= 0 ? pending.splice(i, 1)[0] : null;
    trades.push({ ...e, ix, signer });
  }
  return { trades, created };
}

/** Curve state before a trade, from the state after it (event reserves) and the trade amounts. */
export function stateBefore(tr) {
  return tr.isBuy ? { vs: tr.vs - tr.sol, vt: tr.vt + tr.tok } : { vs: tr.vs + tr.sol, vt: tr.vt - tr.tok };
}
