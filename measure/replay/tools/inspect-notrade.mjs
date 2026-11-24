// Debug helper: for successful curve transactions without a decoded trade, does pump run at all, and how
// do the curve's balances change? Prints a tally.
//   node tools/inspect-notrade.mjs <segment-id>
import fs from 'node:fs';
import path from 'node:path';
import { rpc, CACHE_DIR } from '../lib/rpc.mjs';
import { tradesOfTx } from '../lib/pump.mjs';
import { bondingCurvePda, PUMP } from '../lib/solana.mjs';

const seg = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'segs', `${process.argv[2]}.json`), 'utf8'));
const curve = bondingCurvePda(seg.mint);
const tally = { trade: 0, noTrade: 0, noTradePumpInvoked: 0, noTradeCurveLamportsChanged: 0, noTradeCurveWritable: 0 };
let shown = 0;
for (const s of seg.sigs.filter((x) => x.ok)) {
  const t = await rpc('getTransaction', [s.sig, { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }]);
  if (!t) continue;
  const { trades } = tradesOfTx(t, seg.mint, curve);
  if (trades.length) { tally.trade++; continue; }
  tally.noTrade++;
  const logs = t.meta.logMessages || [];
  const pumpRan = logs.some((l) => l.includes(`Program ${PUMP} invoke`));
  if (pumpRan) tally.noTradePumpInvoked++;
  const m = t.transaction.message;
  const keys = [...m.accountKeys, ...(t.meta.loadedAddresses?.writable || []), ...(t.meta.loadedAddresses?.readonly || [])];
  const ci = keys.indexOf(curve);
  if (ci >= 0 && t.meta.preBalances[ci] !== t.meta.postBalances[ci]) tally.noTradeCurveLamportsChanged++;
  const h = m.header;
  const nStatic = m.accountKeys.length;
  const writable = ci < nStatic ? (ci < h.numRequiredSignatures - h.numReadonlySignedAccounts || (ci >= h.numRequiredSignatures && ci < nStatic - h.numReadonlyUnsignedAccounts)) : ci < nStatic + (t.meta.loadedAddresses?.writable || []).length;
  if (writable) tally.noTradeCurveWritable++;
  if (pumpRan && shown++ < 2) console.log(s.sig, '\n  ', logs.filter((l) => /6EF8|Instruction|data:/.test(l)).slice(0, 12).join('\n   '));
}
console.log(tally);
