// Shared configuration for the measurement scripts: data directory, IDL directory, RPC endpoints, windows.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MEASURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Everything the scripts download or write (raw blocks, rows, pool ages, reports) lives here.
// Default: measure/data/ (git-ignored). Override with MEASURE_DATA_DIR.
export const DATA_DIR = path.resolve(process.env.MEASURE_DATA_DIR || path.join(MEASURE_DIR, 'data'));
export const dataPath = (p) => path.resolve(DATA_DIR, p);

// pump.fun IDLs (pump.json, pump_amm.json) used to name instructions by discriminator. Override with IDL_DIR.
export const IDL_DIR = path.resolve(process.env.IDL_DIR || path.join(MEASURE_DIR, 'idl'));

// Public, keyless mainnet endpoints used during the 2026-11-22 measurement. Override with RPC_URLS (comma-separated).
export const DEFAULT_RPC_URLS = [
  'https://solana-rpc.publicnode.com',
  'https://public.rpc.solanavibestation.com',
  'https://api.mainnet-beta.solana.com',
  'https://solana.api.pocket.network',
  'https://solana-mainnet.gateway.tatum.io',
];
export const RPC_URLS_FROM_ENV = !!process.env.RPC_URLS;
export const rpcUrls = () => (process.env.RPC_URLS ? process.env.RPC_URLS.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_RPC_URLS.slice());

// Measurement windows (slot ranges, SOL/USD price, raw-block folder). Override the file with WINDOWS_FILE.
export function loadWindows() {
  const f = path.resolve(process.env.WINDOWS_FILE || path.join(MEASURE_DIR, 'windows.json'));
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
export function getWindow(id) {
  const all = loadWindows();
  const w = all[id];
  if (!w) fail(`unknown window "${id}"; known: ${Object.keys(all).join(', ')} (see windows.json)`);
  return { id, dir: w.dir, a: w.a, b: w.b, sol: w.sol, label: w.label };
}

export function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}
export function usageExit(usage, code = 1) {
  (code ? console.error : console.log)(usage);
  process.exit(code);
}
export function requireFile(f, hint) {
  if (!fs.existsSync(f)) fail(`data not found: ${f}\n  run first: ${hint}`);
}
