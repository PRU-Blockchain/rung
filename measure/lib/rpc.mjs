// Multi-endpoint, rate-limit-aware, read-only JSON-RPC helper (formerly rpcm.mjs).
import { rpcUrls, RPC_URLS_FROM_ENV } from './config.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EPS = rpcUrls().map((u) => ({ u, gap: 800, next: 0 }));

// Keep only the endpoints whose URL contains one of `subs` (used to skip endpoints that do not serve older blocks).
// No-op when RPC_URLS is set explicitly: the caller chose the endpoints.
export function onlyEps(subs) {
  if (RPC_URLS_FROM_ENV) return;
  for (let i = EPS.length - 1; i >= 0; i--) if (!subs.some((s) => EPS[i].u.includes(s))) EPS.splice(i, 1);
}

export async function rpc(method, params, tries = 14) {
  for (let i = 0; i < tries; i++) {
    const ep = EPS.slice().sort((a, b) => a.next - b.next)[0];
    const w = ep.next - Date.now(); if (w > 0) await sleep(w); ep.next = Date.now() + ep.gap;
    try {
      const r = await fetch(ep.u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(40000) });
      if (r.status === 429 || r.status >= 500) { ep.gap = Math.min(ep.gap * 1.6, 10000); ep.next = Date.now() + ep.gap * 2; continue; }
      const j = await r.json(); if (j.error) { if (/rate|limit|many/i.test(JSON.stringify(j.error))) { ep.gap = Math.min(ep.gap * 1.6, 10000); continue; } if (i > 2) return null; continue; }
      ep.gap = Math.max(ep.gap * 0.97, 500); if (j.result === null && i < 3) continue; return j.result;
    } catch { ep.next = Date.now() + 3000; }
  }
  return null;
}
