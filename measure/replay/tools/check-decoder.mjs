// Independent check of the curve decoder against the balance changes an explorer shows.
// For sampled curve trades: event token amount vs the change of the curve's token account balance
// (owner = bonding curve), and event SOL amount vs the change of the curve account's lamports.
// For pool windows: share of buys whose BuyEvent matched the token-account balances.
//
//   node tools/check-decoder.mjs [samplesPerTape=20]   -> prints a table and writes results/decoder-check.json
import fs from 'node:fs';
import path from 'node:path';
import { rpc, CACHE_DIR, REPLAY_DIR } from '../lib/rpc.mjs';
import { bondingCurvePda } from '../lib/solana.mjs';

const N = Number(process.argv[2] || 20);
const TX_OPTS = { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'confirmed' };
const dir = path.join(CACHE_DIR, 'tape2');
const out = { curve: [], pool: [] };
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json') && !x.startsWith('TEST')).sort()) {
  const tp = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  // block-mode tapes (S1) are checked against pump's event inside build.mjs (evChecked / evTokExact)
  if (tp.blockMode || tp.nonSolQuote) continue;
  if (tp.venue === 'pool') {
    const buys = tp.tape.filter((x) => x.isBuy && !x.liq);
    out.pool.push({ id: tp.id, buys: buys.length, eventMatched: buys.filter((x) => x.feeFromEvent).length });
    continue;
  }
  const curve = bondingCurvePda(tp.mint);
  // single-trade transactions only (so the balance change belongs to one trade); evenly spaced sample
  const single = tp.tape.filter((x, i, a) => a.filter((y) => y.sig === x.sig).length === 1);
  const step = Math.max(1, Math.floor(single.length / N));
  for (let i = 0; i < single.length && out.curve.filter((c) => c.id === tp.id).length < N; i += step) {
    const tr = single[i];
    const t = await rpc('getTransaction', [tr.sig, TX_OPTS]);
    const keys = [...t.transaction.message.accountKeys, ...(t.meta.loadedAddresses?.writable || []), ...(t.meta.loadedAddresses?.readonly || [])];
    const ci = keys.indexOf(curve);
    const lam = t.meta.postBalances[ci] - t.meta.preBalances[ci];
    const tb = (arr) => (arr || []).filter((b) => b.owner === curve && b.mint === tp.mint).reduce((s, b) => s + Number(b.uiTokenAmount.amount), 0);
    const tokDelta = tb(t.meta.postTokenBalances) - tb(t.meta.preTokenBalances);
    // signer's SOL change (what an explorer shows as the buyer's balance change), excluding the network fee
    const signerDelta = t.meta.postBalances[0] - t.meta.preBalances[0] + t.meta.fee;
    out.curve.push({
      id: tp.id, sig: tr.sig, isBuy: tr.isBuy,
      tapeSol: tr.sol, curveLamportsDelta: lam, tapeTok: tr.tok, curveTokenDelta: tokDelta, signerSolDeltaExFee: signerDelta, tapeSpend: tr.spend,
      tokMatch: Math.abs(Math.abs(tokDelta) - tr.tok) <= 1,
      solMatch: Math.abs(Math.abs(lam) - tr.sol) <= 1,
      curveKeepsExtra: lam - (tr.isBuy ? tr.sol : -tr.sol),
      reservesAfter: { vs: tr.vs, vt: tr.vt },
    });
  }
}
const c = out.curve;
console.log(`curve trades checked: ${c.length}; token amount = curve token-account change: ${c.filter((x) => x.tokMatch).length}; SOL amount = curve lamport change: ${c.filter((x) => x.solMatch).length} (the rest: the curve account also keeps part of the fee, extra/SOL median ${(() => { const v = c.filter((x) => !x.solMatch).map((x) => Math.abs(x.curveKeepsExtra) / x.tapeSol).sort((a, b) => a - b); return v.length ? (100 * v[Math.floor(v.length / 2)]).toFixed(3) + '%' : '–'; })()})`);
const buys = c.filter((x) => x.isBuy && x.tapeSpend);
console.log(`buys: signer's SOL out (ex network fee) / tape spend, median ${(() => { const v = buys.map((x) => -x.signerSolDeltaExFee / x.tapeSpend).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)].toFixed(4) : '–'; })()} (n=${buys.length}; >1 when the buyer also paid rent, tips or router fees)`);
for (const x of c.filter((z) => !z.tokMatch).slice(0, 10)) console.log('  token mismatch', JSON.stringify(x));
for (const p of out.pool) console.log(`pool ${p.id}: buys ${p.buys}, BuyEvent matched balances ${p.eventMatched}`);
fs.mkdirSync(path.join(REPLAY_DIR, 'results'), { recursive: true });
fs.writeFileSync(path.join(REPLAY_DIR, 'results', 'decoder-check.json'), JSON.stringify(out, null, 1));
