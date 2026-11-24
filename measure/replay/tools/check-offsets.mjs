// Debug: for sampled curve trades, compare the event's SOL amount and reserves with the curve's lamport change.
//   node tools/check-offsets.mjs <segment-id>
import fs from 'node:fs';
import path from 'node:path';
import { rpc, CACHE_DIR } from '../lib/rpc.mjs';
import { tradesOfTx } from '../lib/pump.mjs';
import { bondingCurvePda } from '../lib/solana.mjs';

const seg = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'segs', `${process.argv[2]}.json`), 'utf8'));
const curve = bondingCurvePda(seg.mint);
for (const s of seg.sigs) {
  const t = await rpc('getTransaction', [s.sig, { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }]);
  if (!t) continue;
  const { trades } = tradesOfTx(t, seg.mint, curve);
  if (!trades.length) continue;
  const keys = [...t.transaction.message.accountKeys, ...(t.meta.loadedAddresses?.writable || []), ...(t.meta.loadedAddresses?.readonly || [])];
  const ci = keys.indexOf(curve);
  const dl = t.meta.postBalances[ci] - t.meta.preBalances[ci];
  for (const tr of trades) console.log(tr.isBuy ? 'buy ' : 'sell', 'event sol', String(tr.sol), 'curve lamports delta', dl, 'fee', String(tr.fee), 'cfee', String(tr.cfee), 'vs-post', Number(tr.vs) - t.meta.postBalances[ci], 'k', (Number(tr.vs) * Number(tr.vt)).toExponential(6), 'n trades', trades.length);
}
