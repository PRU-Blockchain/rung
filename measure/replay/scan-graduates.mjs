// Stage 1: index recent pump.fun graduations (curve completed and migrated to PumpSwap) and page each
// graduate's full bonding-curve signature history. Read-only, cached.
//
//   HOURS=12 node scan-graduates.mjs [extra mints...]
//
// Index: every migration references pump Global.withdraw_authority (39azUY...), so
// getSignaturesForAddress(withdraw_authority) lists migrations. For each successful one: getTransaction
// -> the graduating mint (the mint whose bonding-curve PDA is in the transaction), then the curve's
// signatures back from the migration signature to creation (the oldest one).
// Output: cache/graduates.json (one summary per token) and cache/sigs2/<mint>.json (all curve signatures).
import fs from 'node:fs';
import path from 'node:path';
import { rpc, stats, CACHE_DIR, REPLAY_DIR } from './lib/rpc.mjs';
import { bondingCurvePda, WSOL } from './lib/solana.mjs';

const WITHDRAW_AUTHORITY = '39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg';
const HOURS = Number(process.env.HOURS || 12);
const MAX_CURVE_PAGES = Number(process.env.MAX_CURVE_PAGES || 25);
// Fixed "now" so reruns select the same graduates: the first scan's newest signature is cached.
const TX_OPTS = { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'confirmed' };
const SIG_DIR = path.join(CACHE_DIR, 'sigs2');
fs.mkdirSync(SIG_DIR, { recursive: true });
const LOG = path.join(CACHE_DIR, 'scan.log');
const log = (...a) => { const l = `${new Date().toISOString()} ${a.join(' ')}`; console.log(l); fs.appendFileSync(LOG, l + '\n'); };
// pump slippage errors (docs/pump-arayuz.md): 6002 TooMuchSolRequired, 6003 TooLittleSolReceived, 6042 BuySlippageBelowMinTokensOut
const SLIP = new Set([6002, 6003, 6042]);
const errCode = (e) => { const ie = e?.InstructionError; const c = ie?.[1]; return c && typeof c === 'object' ? c.Custom ?? null : null; };

const anchorFile = path.join(CACHE_DIR, 'scan-anchor.json');
let anchor = fs.existsSync(anchorFile) ? JSON.parse(fs.readFileSync(anchorFile, 'utf8')) : null;
const migrations = [];
{
  let before = anchor?.before;
  let first = true;
  for (let p = 0; p < 50; p++) {
    const opts = { limit: 1000, commitment: 'confirmed' };
    if (before) opts.before = before;
    const page = await rpc('getSignaturesForAddress', [WITHDRAW_AUTHORITY, opts], { cache: !!before });
    if (!page?.length) break;
    if (first && !anchor) { anchor = { before: page[0].signature, t: page[0].blockTime, at: new Date().toISOString() }; fs.writeFileSync(anchorFile, JSON.stringify(anchor)); first = false; continue; }
    first = false;
    for (const s of page) if (s.blockTime >= anchor.t - HOURS * 3600) migrations.push(s);
    if (page.at(-1).blockTime < anchor.t - HOURS * 3600 || page.length < 1000) break;
    before = page.at(-1).signature;
  }
}
log('migration-index signatures in', HOURS, 'h before', new Date(anchor.t * 1000).toISOString(), ':', migrations.length, 'failed', migrations.filter((m) => m.err).length);

const out = {};
// Extra mints (the tokens named in tokens.json): their migration signature comes from discover.json
// (oldest signature of the PumpSwap pool's LP mint), used only as the `before` anchor.
const disc = fs.existsSync(path.join(CACHE_DIR, 'discover.json')) ? JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'discover.json'), 'utf8')) : {};
const extra = process.argv.slice(2).length ? process.argv.slice(2) : JSON.parse(fs.readFileSync(path.join(REPLAY_DIR, 'tokens.json'), 'utf8')).filter((t) => disc[t.mint]?.migration).map((t) => t.mint);
const todo = [...migrations.filter((m) => !m.err).map((m) => ({ sig: m.signature })), ...extra.map((mint) => ({ mint, anchorSig: disc[mint]?.migration?.sig, anchorT: disc[mint]?.migration?.t }))];
let n = 0, nextItem = 0;
const worker = async () => { while (nextItem < todo.length) await one(todo[nextItem++]); };
await Promise.all(Array.from({ length: Number(process.env.CONCURRENCY || 6) }, worker));
async function one(item) {
  n++;
  let mint = item.mint, migSig = item.sig, migT = null;
  try {
    if (migSig) {
      const t = await rpc('getTransaction', [migSig, TX_OPTS]);
      if (!t) return;
      const keys = [...t.transaction.message.accountKeys, ...(t.meta.loadedAddresses?.writable || []), ...(t.meta.loadedAddresses?.readonly || [])];
      const logs = (t.meta.logMessages || []).join('\n');
      if (!/Instruction: Migrate/.test(logs)) return;
      const mints = [...new Set([...(t.meta.postTokenBalances || []), ...(t.meta.preTokenBalances || [])].map((b) => b.mint))].filter((m) => m !== WSOL);
      mint = mints.find((m) => keys.includes(bondingCurvePda(m)));
      migT = t.blockTime;
      if (!mint) return;
    }
    if (out[mint]) return;
    if (!migSig && item.anchorSig) { migSig = item.anchorSig; migT = item.anchorT; }
    if (!migSig) return;
    const curve = bondingCurvePda(mint);
    const f = path.join(SIG_DIR, `${mint}.json`);
    let rec = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
    if (!rec) {
      const all = [];
      let before = migSig, complete = false;
      for (let p = 0; p < MAX_CURVE_PAGES; p++) {
        const opts = { limit: 1000, commitment: 'confirmed' };
        if (before) opts.before = before;
        const page = await rpc('getSignaturesForAddress', [curve, opts]);
        if (!page) break;
        all.push(...page);
        if (page.length < 1000) { complete = true; break; }
        before = page.at(-1).signature;
      }
      all.reverse();
      rec = { mint, curve, migrationSig: migSig || null, migrationT: migT, complete, sigs: all.map((s) => ({ sig: s.signature, slot: s.slot, idx: s.transactionIndex ?? null, t: s.blockTime, ok: s.err ? 0 : 1, code: errCode(s.err) })) };
      fs.writeFileSync(f, JSON.stringify(rec));
    }
    const s = rec.sigs;
    const t0 = s[0]?.t;
    const first = (sec) => s.filter((x) => x.t <= t0 + sec);
    const sum = (arr) => ({ ok: arr.filter((x) => x.ok).length, failed: arr.filter((x) => !x.ok).length, failedSlippage: arr.filter((x) => SLIP.has(x.code)).length });
    out[mint] = {
      mint, complete: rec.complete, curveSigs: s.length, t0, created: t0 ? new Date(t0 * 1000).toISOString() : null,
      migrated: rec.migrationT ? new Date(rec.migrationT * 1000).toISOString() : null, curveMinutes: rec.migrationT && t0 ? (rec.migrationT - t0) / 60 : null,
      first60: sum(first(60)), first300: sum(first(300)), extra: !!item.mint,
    };
    if (n % 20 === 0) log('  graduates', n, '/', todo.length, 'reqs', stats.requests, '429s', stats.http429);
  } catch (e) { log('item', JSON.stringify(item), 'FAILED', e.message); }
}
fs.writeFileSync(path.join(CACHE_DIR, 'graduates.json'), JSON.stringify(out, null, 1));
const ranked = Object.values(out).filter((x) => x.complete).sort((a, b) => b.first60.ok - a.first60.ok);
log('graduates', Object.keys(out).length, 'complete histories', ranked.length);
for (const r of ranked.slice(0, 30)) log(r.mint, 'first60 ok', r.first60.ok, 'failed', r.first60.failed, 'slip', r.first60.failedSlippage, 'curve', r.curveMinutes?.toFixed(1), 'min sigs', r.curveSigs);
log('done', JSON.stringify(stats));
