// Sending a try through Jito's block engine as a bundle of one transaction.
//
// Facts used here, from Jito's documentation (docs.jito.wtf/lowlatencytxnsend,
// read Nov 25, 2026):
// - A bundle lands whole or not at all. Sent with `bundleOnly=true`, a single
//   transaction is a bundle of its own: if it would fail, it does not land.
// - A bundle must tip: a transfer of at least 1000 lamports to one of Jito's
//   tip accounts, best placed in the same transaction as the logic it pays for.
// - A transaction that names an account whose address starts with
//   "jitodontfront" is only accepted at the front of a bundle, so it cannot be
//   put behind someone else's buy. Jito says this reduces sandwiches and does
//   not promise to end them.
// - Without an API key: one request per second per IP per region.
//
// No Node or DOM APIs, so the app can use it as well.

import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

import { base64Encode } from "./bytes";

/** Any valid address with this prefix works; the account does not have to exist. */
export const JITO_DONT_FRONT = new PublicKey("jitodontfront" + "1".repeat(30));

/** Jito's minimum for a bundle. */
export const JITO_MIN_TIP_LAMPORTS = 1_000n;
/** Our own ceiling: the tip is a cost to the user. */
export const JITO_MAX_TIP_LAMPORTS = 20_000n;

/** Block engine hosts near Europe; a try is sent to them in turn (one request per second per region). */
export const JITO_HOSTS = ["frankfurt", "amsterdam", "london", "dublin"].map(
  (region) => `${region}.mainnet.block-engine.jito.wtf`,
);
export const JITO_TIP_FLOOR_URL = "https://bundles.jito.wtf/api/v1/bundles/tip_floor";

export interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<FetchResponse>;

/** How a ladder sends its tries when it uses Jito. */
export interface JitoOptions {
  /** One of Jito's tip accounts (`fetchJitoTipAccounts`). */
  tipAccount: PublicKey;
  /** Paid by the session key, only by the try that lands. */
  tipLamports: bigint;
  /** Defaults to `JITO_HOSTS`. */
  hosts?: string[];
  /** Pause between sends of the same try (default 300 ms: with four hosts, each is asked every 1.2 s). */
  resendMs?: number;
  /** Defaults to the runtime's `fetch`. */
  fetch?: FetchLike;
}

/** The runtime's own `fetch` (Node 18+, React Native), without pulling in DOM types. */
export function runtimeFetch(): FetchLike {
  const f = (globalThis as { fetch?: FetchLike }).fetch;
  if (!f) throw new Error("this runtime has no fetch");
  return f;
}

/** The tip: a plain transfer, with the marker account as a read-only extra. */
export function jitoTipIx(from: PublicKey, tipAccount: PublicKey, lamports: bigint): TransactionInstruction {
  const ix = SystemProgram.transfer({ fromPubkey: from, toPubkey: tipAccount, lamports });
  ix.keys.push({ pubkey: JITO_DONT_FRONT, isSigner: false, isWritable: false });
  return ix;
}

/**
 * The tip to pay, from Jito's tip floor answer (values in SOL): the median of
 * the tips that landed, kept between Jito's minimum and our ceiling. An answer
 * that cannot be read gives the minimum.
 */
export function chooseJitoTip(floor: unknown, max: bigint = JITO_MAX_TIP_LAMPORTS): bigint {
  const first = Array.isArray(floor) ? (floor[0] as { landed_tips_50th_percentile?: unknown } | undefined) : undefined;
  const sol = first?.landed_tips_50th_percentile;
  if (typeof sol !== "number" || !Number.isFinite(sol) || sol <= 0) return JITO_MIN_TIP_LAMPORTS;
  const lamports = BigInt(Math.round(sol * 1e9));
  if (lamports < JITO_MIN_TIP_LAMPORTS) return JITO_MIN_TIP_LAMPORTS;
  return lamports > max ? max : lamports;
}

async function post(fetchFn: FetchLike, url: string, method: string, params: unknown[]): Promise<unknown> {
  const response = await fetchFn(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`Jito answered HTTP ${response.status}`);
  const answer = (await response.json()) as { result?: unknown; error?: { message?: unknown } };
  if (answer.error) throw new Error(`Jito refused: ${String(answer.error.message ?? JSON.stringify(answer.error))}`);
  return answer.result;
}

/**
 * Sends one signed transaction to the block engine as a bundle of its own.
 * Returns its signature. Being accepted says nothing about landing.
 */
export async function sendToJito(fetchFn: FetchLike, host: string, raw: Uint8Array): Promise<string> {
  const result = await post(fetchFn, `https://${host}/api/v1/transactions?bundleOnly=true`, "sendTransaction", [
    base64Encode(raw),
    { encoding: "base64" },
  ]);
  if (typeof result !== "string") throw new Error("Jito returned no signature");
  return result;
}

/** Jito's tip accounts, asked from the block engine. */
export async function fetchJitoTipAccounts(fetchFn: FetchLike, host: string = JITO_HOSTS[0]): Promise<PublicKey[]> {
  const result = await post(fetchFn, `https://${host}/api/v1/getTipAccounts`, "getTipAccounts", []);
  if (!Array.isArray(result) || result.length === 0) throw new Error("Jito returned no tip accounts");
  return result.map((address) => new PublicKey(String(address)));
}

/** Jito's current tip levels (the input of `chooseJitoTip`). */
export async function fetchJitoTipFloor(fetchFn: FetchLike): Promise<unknown> {
  const response = await fetchFn(JITO_TIP_FLOOR_URL);
  if (!response.ok) throw new Error(`Jito's tip floor answered HTTP ${response.status}`);
  return response.json();
}
