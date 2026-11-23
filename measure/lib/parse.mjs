// Block -> compact pump.fun / PumpSwap transaction record. Read-only.
// Merges the former parse2.mjs (constants, base58) and parse3.mjs (the parser used by the measurement):
// fee breakdown, Jito tip, top-level program list, fee transfers, pump event fees, program of the failing instruction.
import fs from 'node:fs';
import path from 'node:path';
import { IDL_DIR, fail } from './config.mjs';

export const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const AMM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
export const WSOL = 'So11111111111111111111111111111111111111112';

const AL = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAP = new Int16Array(128).fill(-1);
for (let i = 0; i < AL.length; i++) MAP[AL.charCodeAt(i)] = i;
export function b58dec(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let c = MAP[s.charCodeAt(i)];
    for (let j = 0; j < out.length; j++) { c += out[j] * 58; out[j] = c & 255; c >>= 8; }
    while (c > 0) { out.push(c & 255); c >>= 8; }
  }
  for (let i = 0; i < s.length && s[i] === '1'; i++) out.push(0);
  return Buffer.from(out.reverse());
}
export function b58enc(buf) {
  const d = [];
  for (const b of buf) { let c = b; for (let j = 0; j < d.length; j++) { c += d[j] << 8; d[j] = c % 58; c = (c / 58) | 0; } while (c > 0) { d.push(c % 58); c = (c / 58) | 0; } }
  let s = ''; for (const b of buf) { if (b === 0) s += '1'; else break; }
  for (let i = d.length - 1; i >= 0; i--) s += AL[d[i]];
  return s;
}

const SYSP = '11111111111111111111111111111111';
// Top-level programs that do not count towards the signer's program list.
const IGN = new Set([SYSP, 'ComputeBudget111111111111111111111111111111', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo']);
// The eight official Jito tip accounts.
const TIPS = new Set(['96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5', 'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe', 'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY', 'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49', 'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh', 'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt', 'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL', '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT']);

// Instruction names by 8-byte discriminator, from the pump IDLs. Loaded on first use so that --help works without them.
let NAMES = null;
function names() {
  if (NAMES) return NAMES;
  const idl = (f) => {
    const p = path.join(IDL_DIR, f);
    if (!fs.existsSync(p)) fail(`pump IDL not found: ${p}\n  put pump.json and pump_amm.json (github.com/pump-fun/pump-public-docs, idl/) in ${IDL_DIR} or set IDL_DIR; see measure/README.md`);
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  };
  const mk = (j) => { const m = {}; for (const i of j.instructions) m[Buffer.from(i.discriminator).toString('hex')] = i.name; return m; };
  NAMES = { [PUMP]: mk(idl('pump.json')), [AMM]: mk(idl('pump_amm.json')) };
  return NAMES;
}
export const loadInstructionNames = names;
const EV_TAG = 'e445a52e51cb9a1d';
const TRADE = Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]).toString('hex');
const AMM_POOL_IX = new Set(['buy', 'buy_v2', 'buy_exact_quote_in', 'buy_exact_quote_in_v2', 'sell', 'sell_v2', 'create_pool', 'deposit', 'withdraw']);
const isBuyName = (n) => /^buy/.test(n);

// pump TradeEvent (data after the 8-byte event tag and 8-byte discriminator).
function parseTrade(d) {
  let o = 16;
  const pk = () => { const k = b58enc(d.subarray(o, o + 32)); o += 32; return k; };
  const u64 = () => { const v = d.readBigUInt64LE(o); o += 8; return Number(v); };
  const e = {};
  e.m = pk(); e.sol = u64(); e.tok = u64(); e.b = d[o++] === 1; e.u = pk(); o += 8;
  e.vs = u64(); e.vt = u64(); e.rs = u64(); e.rt = u64();
  try {
    // fee_recipient .. last_update_timestamp (only the fee and creator-fee amounts are kept)
    pk(); u64(); e.fee = u64(); pk(); u64(); e.cfee = u64(); o += 1; u64(); u64(); u64(); o += 8;
    const n = d.readUInt32LE(o); o += 4; e.ix = d.subarray(o, o + n).toString(); o += n;
    o += 1; u64(); u64(); u64(); u64(); // mayhem, cashback bps, cashback, buyback bps, buyback
    const sh = d.readUInt32LE(o); o += 4; o += sh * 34;
    e.q = pk(); e.qa = u64(); e.vq = u64(); e.rq = u64();
  } catch { e.q = null; }
  return e;
}

export function parseTx(t, slot, idx) {
  const NAMES = names();
  const m = t.transaction.message;
  const keys = [...m.accountKeys, ...(t.meta.loadedAddresses?.writable || []), ...(t.meta.loadedAddresses?.readonly || [])];
  const hasP = keys.includes(PUMP), hasA = keys.includes(AMM);
  if (!hasP && !hasA) return null;
  const meta = t.meta;
  const ns = t.transaction.signatures.length;
  const rec = { i: idx, s: t.transaction.signatures[0], f: keys[0], ok: meta.err ? 0 : 1, fee: meta.fee, ns, pr: meta.fee - 5000 * ns, v: t.version === 1 ? 1 : (t.version === 0 ? 0 : -1) };
  if (meta.err) {
    const ie = meta.err.InstructionError; const c = ie?.[1];
    rec.er = typeof c === 'object' && c ? (c.Custom ?? 'x') : 'x';
    if (ie) { const fp = keys[m.instructions[ie[0]]?.programIdIndex]; rec.ep = fp === PUMP ? 'P' : fp === AMM ? 'A' : 'o'; }
  }
  const all = [];
  m.instructions.forEach((ix, k) => all.push({ ix, top: true, pi: k }));
  for (const g of meta.innerInstructions || []) for (const ix of g.instructions) all.push({ ix, top: false, pi: g.index });
  const pools = new Set();
  rec.ev = []; rec.bx = []; rec.cr = []; rec.mg = []; rec.cp = [];
  let tip = 0; const xf = []; const progs = new Set(); let hasSell = false;
  for (const { ix, top, pi } of all) {
    const prog = keys[ix.programIdIndex];
    if (top && !IGN.has(prog)) progs.add(prog);
    if (prog === SYSP) {
      if (ix.data.length >= 8 && ix.data.length <= 20) {
        const d = b58dec(ix.data);
        if (d.length === 12 && d.readUInt32LE(0) === 2) { // system transfer
          const to = keys[ix.accounts[1]], from = keys[ix.accounts[0]]; const lam = Number(d.readBigUInt64LE(4));
          if (TIPS.has(to)) tip += lam; else if (from === keys[0] && xf.length < 8) xf.push([to, lam]);
        }
      }
      continue;
    }
    if (prog !== PUMP && prog !== AMM) continue;
    if (!top && ix.accounts.length === 1 && ix.data.length > 40) {
      const d = b58dec(ix.data);
      if (d.length >= 16 && d.subarray(0, 8).toString('hex') === EV_TAG && prog === PUMP && d.subarray(8, 16).toString('hex') === TRADE) {
        try { rec.ev.push(parseTrade(d)); } catch { /* malformed event */ }
      }
      continue;
    }
    if (ix.data.length < 8) continue;
    const d = b58dec(ix.data);
    if (d.length < 8) continue;
    const nm = NAMES[prog][d.subarray(0, 8).toString('hex')];
    if (!nm) continue;
    const acc = ix.accounts.map((a) => keys[a]);
    if (prog === AMM) {
      if (AMM_POOL_IX.has(nm)) pools.add(acc[0]);
      if (nm === 'create_pool') rec.cp.push(acc[0]);
      if (isBuyName(nm) && d.length >= 24) rec.bx.push({ pr: 'A', n: nm, a1: Number(d.readBigUInt64LE(8)), a2: Number(d.readBigUInt64LE(16)), ref: acc[0], top });
    } else {
      if (nm === 'create' || nm === 'create_v2') rec.cr.push(acc[0]);
      if (nm === 'migrate' || nm === 'migrate_v2') rec.mg.push(acc[2]);
      if (isBuyName(nm) && d.length >= 24) {
        const v23 = /_v[23]$/.test(nm);
        rec.bx.push({ pr: 'P', n: nm, a1: Number(d.readBigUInt64LE(8)), a2: Number(d.readBigUInt64LE(16)), ref: v23 ? acc[1] : acc[2], top });
      }
    }
  }
  // Pool reserves before/after from token balances of the pool accounts (WSOL + one other mint).
  if (pools.size && rec.ok) {
    rec.pl = {};
    const agg = (arr) => { const o = {}; for (const b of arr || []) { if (pools.has(b.owner)) { (o[b.owner] ||= {})[b.mint] = (o[b.owner][b.mint] || 0) + Number(b.uiTokenAmount.amount); } } return o; };
    const pre = agg(meta.preTokenBalances), post = agg(meta.postTokenBalances);
    for (const p of pools) {
      const a = pre[p] || {}, b = post[p] || {};
      const mints = [...new Set([...Object.keys(a), ...Object.keys(b)])];
      const other = mints.filter((x) => x !== WSOL);
      if (!mints.includes(WSOL) || other.length !== 1) continue;
      const mm = other[0];
      rec.pl[p] = { m: mm, s0: a[WSOL] ?? null, s1: b[WSOL] ?? null, t0: a[mm] ?? null, t1: b[mm] ?? null };
    }
  }
  if (tip) rec.tip = tip;
  if (progs.size) rec.pg = [...progs];
  if (rec.bx.length && xf.length) rec.xf = xf;
  if (!rec.ev.length) delete rec.ev;
  if (!rec.cr.length) delete rec.cr;
  if (!rec.mg.length) delete rec.mg;
  if (!rec.cp.length) delete rec.cp;
  if (!rec.bx.length) delete rec.bx;
  return rec;
}

export function parseBlock(b, slot) {
  const out = [];
  let idx = 0;
  for (const t of b.transactions) {
    const r = parseTx(t, slot, idx++);
    if (r) out.push(r);
  }
  return { slot, bt: b.blockTime, n: b.transactions.length, tx: out };
}
