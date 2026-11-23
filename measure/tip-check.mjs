// Is the declared Jito tip / the priority fee charged on a failed (slippage) transaction? Read-only getTransaction
// sample (formerly tipcheck.mjs): compares the fee payer's balance drop with meta.fee.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { rpc, onlyEps } from './lib/rpc.mjs';
import { dataPath, requireFile, usageExit } from './lib/config.mjs';

const USAGE = `Usage: node tip-check.mjs --rows <rows_W.json> [--count 30]
Takes up to <count> failed slippage buys with a declared Jito tip, plus up to 10 with a priority fee > 100,000 lamports
and no tip, from <data>/<rows file>; fetches each with getTransaction and writes <data>/tip-check_<rows file>.json.`;
const { values: opt } = parseArgs({ options: { rows: { type: 'string' }, count: { type: 'string', default: '30' }, help: { type: 'boolean', short: 'h' } } });
if (opt.help) usageExit(USAGE, 0);
if (!opt.rows) usageExit(USAGE);
const rowsFile = dataPath(opt.rows);
requireFile(rowsFile, 'node build-rows.mjs --window <W>');
onlyEps(['vibestation', 'mainnet-beta', 'tatum', 'pocket']);
const j = JSON.parse(fs.readFileSync(rowsFile)); const fl = j.fl.filter((f) => f.tipDecl > 0 && f.slip).slice(0, Number(opt.count));
const withPrio = j.fl.filter((f) => f.prio > 100000 && f.slip && !(f.tipDecl > 0)).slice(0, 10);
const out = [];
for (const f of [...fl, ...withPrio]) {
  const t = await rpc('getTransaction', [f.sig, { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'finalized' }]);
  if (!t) { out.push({ sig: f.sig, err: 'not found' }); continue; }
  const d = t.meta.preBalances[0] - t.meta.postBalances[0];
  out.push({ sig: f.sig.slice(0, 10), tipDecl: f.tipDecl, prio: f.prio, fee: t.meta.fee, payerDelta: d, deltaMinusFee: d - t.meta.fee, error: JSON.stringify(t.meta.err).slice(0, 40) });
}
const outFile = dataPath('tip-check_' + path.basename(opt.rows).replace(/\W/g, '_') + '.json');
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
const ok = out.filter((o) => o.fee != null);
console.log('sample', ok.length, '| declared tip > 0:', ok.filter((o) => o.tipDecl > 0).length, '| payer loss = fee:', ok.filter((o) => o.deltaMinusFee === 0).length, '| loss > fee (tip paid):', ok.filter((o) => o.deltaMinusFee > 0).length, '->', outFile);
console.log(ok.slice(0, 6));
