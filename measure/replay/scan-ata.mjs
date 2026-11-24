// Stage 1b: trade-only signature lists for the candidate curves.
//
//   node scan-ata.mjs            -> cache/atasigs/<mint>.json, cache/ata-rank.json
//
// Why: on busy launches most successful transactions that touch the bonding-curve account are bots'
// no-op checks (they read the curve and exit), not trades. Every trade moves tokens in and out of the
// curve's own token account (ATA of the curve for the mint), so that account's signature list is a
// much closer index of trades. Candidates: the 40 graduates with the most successful curve
// transactions in their first 60 s (scenario 1) and the 30 graduates (curve lifetime >= 15 min) with
// the busiest 5-minute curve window after minute 10 (scenario 2).
import fs from 'node:fs';
import path from 'node:path';
import { rpc, stats, CACHE_DIR } from './lib/rpc.mjs';
import { PublicKey, bondingCurvePda } from './lib/solana.mjs';

const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const N1 = Number(process.env.N1 || 40), N2 = Number(process.env.N2 || 30), MAX_PAGES = 40;
const SLIP = new Set([6002, 6003, 6042]);
const errCode = (e) => { const c = e?.InstructionError?.[1]; return c && typeof c === 'object' ? c.Custom ?? null : null; };
const OUT = path.join(CACHE_DIR, 'atasigs');
fs.mkdirSync(OUT, { recursive: true });
const grads = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'graduates.json'), 'utf8'));
const sigsOf = (mint) => JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'sigs2', `${mint}.json`), 'utf8'));
const g = Object.values(grads).filter((x) => x.complete && x.curveSigs > 0 && x.curveMinutes > 0);

const c1 = [...g].sort((a, b) => b.first60.ok - a.first60.ok || (a.mint < b.mint ? -1 : 1)).slice(0, N1).map((x) => x.mint);
const c2s = [];
for (const x of g) {
  if (x.curveMinutes < 15) continue;
  const sg = sigsOf(x.mint);
  const t0 = sg.sigs[0].t, tC = sg.migrationT, ok = sg.sigs.filter((s) => s.ok);
  let lo = 0, hi = 0, best = 0;
  for (let st = t0 + 600; st + 300 <= tC; st += 60) {
    while (lo < ok.length && ok[lo].t < st) lo++;
    while (hi < ok.length && ok[hi].t < st + 300) hi++;
    best = Math.max(best, hi - lo);
  }
  c2s.push({ mint: x.mint, best });
}
const c2 = c2s.sort((a, b) => b.best - a.best || (a.mint < b.mint ? -1 : 1)).slice(0, N2).map((x) => x.mint);
const todo = [...new Set([...c1, ...c2])];
console.log('candidates', todo.length);

const rank = {};
let next = 0;
async function one(mint) {
  const f = path.join(OUT, `${mint}.json`);
  let rec = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  if (!rec) {
    const acc = await rpc('getAccountInfo', [mint, { encoding: 'base64', commitment: 'confirmed' }]);
    const tokenProgram = acc?.value?.owner;
    const curve = bondingCurvePda(mint);
    const ata = PublicKey.findProgramAddressSync([new PublicKey(curve).toBuffer(), new PublicKey(tokenProgram).toBuffer(), new PublicKey(mint).toBuffer()], new PublicKey(ATA_PROGRAM))[0].toBase58();
    const sg = sigsOf(mint);
    const all = [];
    let before = sg.migrationSig, complete = false;
    for (let p = 0; p < MAX_PAGES; p++) {
      const page = await rpc('getSignaturesForAddress', [ata, { limit: 1000, before, commitment: 'confirmed' }]);
      if (!page) break;
      all.push(...page);
      if (page.length < 1000) { complete = true; break; }
      before = page.at(-1).signature;
    }
    all.reverse();
    rec = { mint, curve, ata, tokenProgram, migrationSig: sg.migrationSig, migrationT: sg.migrationT, t0: sg.sigs[0].t, complete, sigs: all.map((s) => ({ sig: s.signature, slot: s.slot, idx: s.transactionIndex ?? null, t: s.blockTime, ok: s.err ? 0 : 1, code: errCode(s.err) })) };
    fs.writeFileSync(f, JSON.stringify(rec));
  }
  const s = rec.sigs.filter((x) => x.t >= rec.t0);
  const w = (sec) => s.filter((x) => x.t <= rec.t0 + sec);
  rank[mint] = {
    mint, complete: rec.complete, ataSigs: rec.sigs.length, s1Candidate: c1.includes(mint), s2Candidate: c2.includes(mint),
    first60: { ok: w(60).filter((x) => x.ok).length, failed: w(60).filter((x) => !x.ok).length, failedSlippage: w(60).filter((x) => SLIP.has(x.code)).length },
    first300: { ok: w(300).filter((x) => x.ok).length },
  };
}
await Promise.all(Array.from({ length: 6 }, async () => { while (next < todo.length) { const m = todo[next++]; try { await one(m); } catch (e) { console.log(m, 'FAILED', e.message); } } }));
fs.writeFileSync(path.join(CACHE_DIR, 'ata-rank.json'), JSON.stringify(rank, null, 1));
const r1 = Object.values(rank).filter((x) => x.s1Candidate && x.complete).sort((a, b) => b.first60.ok - a.first60.ok);
for (const r of r1.slice(0, 20)) console.log(r.mint, 'ATA ok first60', r.first60.ok, 'curve ok first60', grads[r.mint].first60.ok);
console.log('done', JSON.stringify(stats));
