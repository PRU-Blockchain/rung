// A token's name, symbol and picture, and the dollar price of SOL, for display.
// Neither is needed for a buy: when a read fails the screen shows the address
// and SOL amounts as before.
//
// - Name and symbol come from the chain (the mint, or its Metaplex account).
// - The picture's address comes from the metadata file the token's maker
//   published; only https addresses are asked (see `fetchUrls`).
// - The dollar price is Pyth's SOL/USD account on the chain. Shown on mainnet
//   only: devnet SOL has no price.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

import {
  PYTH_SOL_USD_ACCOUNT,
  PublicKey,
  TextFetch,
  fetchTokenImageUrls,
  metaplexMetadataPda,
  solUsdFromAccount,
  tokenText,
} from "../../../client/src";

import { NETWORK } from "../config";
import { connection } from "./connection";

export interface TokenInfo {
  name: string;
  symbol: string;
  /** Addresses to try for the picture, in order; empty when there is none. */
  imageUrls: string[];
}

// What was read once is kept, in memory and on the phone, so the ladder, the
// receipt and the history show the name without asking the network again.
// pump.fun tokens cannot change their name: the metadata has no update authority.
const STORE = `rung.tokens.${NETWORK.cluster}`;
const KEPT = 200;
const memory = new Map<string, TokenInfo>();
let stored: Promise<Record<string, TokenInfo>> | null = null;

function readStore(): Promise<Record<string, TokenInfo>> {
  stored ??= AsyncStorage.getItem(STORE)
    .then((v) => (v ? (JSON.parse(v) as Record<string, TokenInfo>) : {}))
    .catch(() => ({}));
  return stored;
}

async function keep(mint: string, info: TokenInfo): Promise<void> {
  memory.set(mint, info);
  try {
    const all = await readStore();
    delete all[mint];
    all[mint] = info; // newest last
    const keys = Object.keys(all);
    for (const old of keys.slice(0, Math.max(0, keys.length - KEPT))) delete all[old];
    await AsyncStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    // The name is still on the screen from memory.
  }
}

/** What an earlier read left for this mint; never asks the network. */
export async function keptTokenInfo(mint: string): Promise<TokenInfo | null> {
  return memory.get(mint) ?? (await readStore())[mint] ?? null;
}

/**
 * Reads the token's name and symbol from the chain, then the picture's
 * address. `onInfo` is called when the name is known and again when the
 * picture is. Never throws.
 */
export async function loadTokenInfo(mint: PublicKey, onInfo: (info: TokenInfo) => void): Promise<void> {
  const key = mint.toBase58();
  try {
    const kept = await keptTokenInfo(key);
    if (kept) {
      onInfo(kept);
      if (kept.imageUrls.length > 0) return;
    }
    const [mintAccount, metaplexAccount] = await connection.getMultipleAccountsInfo([mint, metaplexMetadataPda(mint)]);
    const text = tokenText(mint, mintAccount, metaplexAccount);
    if (!text) return;
    const named: TokenInfo = { name: text.name, symbol: text.symbol, imageUrls: [] };
    if (!kept) onInfo(named);
    const imageUrls = await fetchTokenImageUrls(fetch as unknown as TextFetch, text.uri);
    const info = { ...named, imageUrls };
    await keep(key, info);
    if (imageUrls.length > 0) onInfo(info);
  } catch (e) {
    console.log(`RUNG token info not read: ${String((e as Error)?.message ?? e)}`);
  }
}

/**
 * The token's name, symbol and picture for a screen, or null while unknown.
 * With `fromNetwork` the chain is asked when nothing was kept (the buy screen);
 * without it only what an earlier read kept is shown (receipts, history).
 */
export function useTokenInfo(mint: string | null, fromNetwork = false): TokenInfo | null {
  const [info, setInfo] = useState<TokenInfo | null>(mint ? (memory.get(mint) ?? null) : null);
  useEffect(() => {
    setInfo(mint ? (memory.get(mint) ?? null) : null);
    if (!mint) return;
    let live = true;
    const show = (i: TokenInfo | null) => live && i && setInfo(i);
    if (fromNetwork) void loadTokenInfo(new PublicKey(mint), show);
    else void keptTokenInfo(mint).then(show);
    return () => {
      live = false;
    };
  }, [mint, fromNetwork]);
  return info;
}

const USD_REFRESH_MS = 60_000;

/** Dollars per SOL from the chain, or null when there is nothing fresh to show (and always on devnet). */
export async function loadSolUsd(): Promise<number | null> {
  if (NETWORK.cluster !== "mainnet-beta") return null;
  try {
    const { context, value } = await connection.getMultipleAccountsInfoAndContext([PYTH_SOL_USD_ACCOUNT]);
    return solUsdFromAccount(value[0], context.slot)?.usdPerSol ?? null;
  } catch {
    return null;
  }
}

let lastUsd: number | null = null;

/** Dollars per SOL, refreshed once a minute while the screen is open; null when unknown. */
export function useSolUsd(): number | null {
  const [usd, setUsd] = useState<number | null>(lastUsd);
  useEffect(() => {
    if (NETWORK.cluster !== "mainnet-beta") return;
    let live = true;
    const read = () =>
      void loadSolUsd().then((v) => {
        lastUsd = v;
        if (live) setUsd(v);
      });
    read();
    const timer = setInterval(read, USD_REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return usd;
}
