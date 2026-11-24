// Decode trades on one PumpSwap pool from a getTransaction (json) result. Read-only, no network.
// Reserves come from the pool's two token accounts' pre/post balances (no IDL needed); the BuyEvent
// (emit_cpi) adds the fee rates and the buyer's total spend, and is cross-checked against the balances.
import crypto from 'node:crypto';
import { b58, PUMP_SWAP } from './solana.mjs';

const sighash = (ns, name) => crypto.createHash('sha256').update(`${ns}:${name}`).digest().subarray(0, 8).toString('hex');
const EV_TAG = 'e445a52e51cb9a1d';
const BUY_EVENT = sighash('event', 'BuyEvent');
const IX = {
  [sighash('global', 'buy')]: { n: 'buy', kind: 'maxCost' }, // base_amount_out, max_quote_amount_in
  [sighash('global', 'buy_exact_quote_in')]: { n: 'buy_exact_quote_in', kind: 'exactIn' }, // spendable_quote_in, min_base_amount_out
  [sighash('global', 'buy_v2')]: { n: 'buy_v2', kind: 'maxCost' },
  [sighash('global', 'buy_exact_quote_in_v2')]: { n: 'buy_exact_quote_in_v2', kind: 'exactIn' },
  [sighash('global', 'sell')]: { n: 'sell', kind: null },
  [sighash('global', 'sell_v2')]: { n: 'sell_v2', kind: null },
};
if (sighash('global', 'buy_exact_quote_in_v2') !== Buffer.from([194, 171, 28, 70, 104, 77, 91, 47]).toString('hex')) throw new Error('discriminator mismatch');

/** pump_amm BuyEvent body (after tag + discriminator); only the leading fixed fields are read. */
function parseBuyEvent(d) {
  let o = 0;
  const u64 = () => { const v = d.readBigUInt64LE(o); o += 8; return v; };
  const pk = () => { const k = b58.encode(d.subarray(o, o + 32)); o += 32; return k; };
  const e = {};
  e.ts = Number(d.readBigInt64LE(o)); o += 8;
  e.baseOut = u64(); e.maxQuoteIn = u64(); u64(); u64();
  e.poolBase = u64(); e.poolQuote = u64(); e.quoteIn = u64();
  e.lpBps = u64(); e.lpFee = u64(); e.protoBps = u64(); e.protoFee = u64(); e.quoteInWithLp = u64(); e.userQuoteIn = u64();
  e.pool = pk(); e.user = pk(); pk(); pk(); pk(); pk(); pk();
  if (d.length >= o + 16) { e.creatorBps = u64(); e.creatorFee = u64(); }
  return e;
}

/**
 * One aggregated trade per transaction on `pool` (base = token, quote = WSOL), or null.
 * vq: the pool's virtual quote reserves (added to the quote balance for the price, client/src/quote.ts poolReserves).
 */
export function poolTradeOfTx(t, pool, baseTa, quoteTa, vq) {
  if (!t || !t.meta || t.meta.err) return null;
  const m = t.transaction.message;
  const keys = [...m.accountKeys, ...(t.meta.loadedAddresses?.writable || []), ...(t.meta.loadedAddresses?.readonly || [])];
  if (!keys.includes(pool)) return null;
  const bal = (arr, acct) => { const b = (arr || []).find((x) => keys[x.accountIndex] === acct); return b ? BigInt(b.uiTokenAmount.amount) : null; };
  const b0 = bal(t.meta.preTokenBalances, baseTa), b1 = bal(t.meta.postTokenBalances, baseTa);
  const q0 = bal(t.meta.preTokenBalances, quoteTa), q1 = bal(t.meta.postTokenBalances, quoteTa);
  if (b0 == null || b1 == null || q0 == null || q1 == null || b0 === b1) return null;
  const isBuy = b1 < b0;
  if (isBuy ? q1 <= q0 : q1 >= q0) return { liquidity: true, vs0: q0 + vq, vt0: b0, vs: q1 + vq, vt: b1 };
  const inner = new Map();
  for (const g of t.meta.innerInstructions || []) inner.set(g.index, g.instructions);
  let ix = null, ev = null, nSwaps = 0;
  m.instructions.forEach((top, k) => {
    for (const x of [top, ...(inner.get(k) || [])]) {
      if (keys[x.programIdIndex] !== PUMP_SWAP) continue;
      const d = Buffer.from(b58.decode(x.data));
      if (d.length < 8) continue;
      const disc = d.subarray(0, 8).toString('hex');
      if (disc === EV_TAG && d.length > 16 && d.subarray(8, 16).toString('hex') === BUY_EVENT) {
        try { const e = parseBuyEvent(d.subarray(16)); if (e.pool === pool && !ev) ev = e; } catch { /* layout */ }
        continue;
      }
      const spec = IX[disc];
      if (spec && keys[x.accounts[0]] === pool && d.length >= 24) {
        nSwaps++;
        if (!ix && spec.kind) ix = { n: spec.n, kind: spec.kind, a1: Number(d.readBigUInt64LE(8)), a2: Number(d.readBigUInt64LE(16)), top: x === top };
      }
    }
  });
  const tr = {
    isBuy, tok: Number(isBuy ? b0 - b1 : b1 - b0), sol: Number(isBuy ? q1 - q0 : q0 - q1),
    vs0: q0 + vq, vt0: b0, vs: q1 + vq, vt: b1, signer: keys[0], user: ev?.user || keys[0], ix: isBuy ? ix : null, nSwaps,
  };
  // Fees and spend from the BuyEvent, only when its reserves match the balances (layout check).
  if (isBuy && ev && ev.poolBase === b0 && ev.poolQuote === q0 && ev.baseOut === b0 - b1) {
    tr.feeBpsList = [ev.lpBps, ev.protoBps, ev.creatorBps ?? 0n].map(Number);
    tr.spend = Number(ev.userQuoteIn);
    tr.eventOk = true;
  }
  return tr;
}
