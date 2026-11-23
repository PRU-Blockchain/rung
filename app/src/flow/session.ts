// The order's one-time session key lives only in expo-secure-store. What the
// app needs to finish or resume an order (no secrets) is kept in AsyncStorage.

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

import { Keypair, PoolAccounts, PublicKey, Venue } from "../../../client/src";

const KEY = "rung.session-key";
const PENDING = "rung.pending-order";

export async function saveSessionKey(k: Keypair): Promise<void> {
  await SecureStore.setItemAsync(KEY, Buffer.from(k.secretKey).toString("base64"));
}

export async function loadSessionKey(): Promise<Keypair | null> {
  const v = await SecureStore.getItemAsync(KEY);
  if (!v) return null;
  try {
    return Keypair.fromSecretKey(Buffer.from(v, "base64"));
  } catch {
    return null;
  }
}

export async function deleteSessionKey(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

/** Everything about an open order the screens need, as JSON-safe strings. */
export interface PendingOrder {
  user: string;
  mint: string;
  /** Missing in notes written before pools were supported: those were curve orders. */
  venue?: Venue;
  /** PumpSwap orders: the canonical pool and its two token accounts. */
  pool?: { address: string; baseTokenAccount: string; quoteTokenAccount: string };
  tokenProgram: string;
  /** Curve: a pump buyback wallet. Pool: a PumpSwap buyback wallet's wrapped-SOL account. */
  buybackRecipient: string;
  decimals: number;
  mode: string;
  rungsBps: number[];
  amount: string;
  expectedTokensSeen: string;
  rawTokensSeen: string;
  /** Which of these accounts existed before the order: order, user token account, pump volume account. */
  existed: { order: boolean; userTokenAccount: boolean; accumulator: boolean };
  /** Lamports of an earlier order account that this order reused. */
  earlierOrderLamports: string;
  openSignature?: string;
  /** Transactions sent so far, so a resumed order's receipt still lists them. */
  attempts?: { label: string; signature: string; fee?: string; outcome: string }[];
  createdAt: number;
}

export const pendingVenue = (p: PendingOrder): Venue => p.venue ?? "Curve";

export function pendingPool(p: PendingOrder): PoolAccounts | undefined {
  if (!p.pool) return undefined;
  return {
    address: new PublicKey(p.pool.address),
    baseTokenAccount: new PublicKey(p.pool.baseTokenAccount),
    quoteTokenAccount: new PublicKey(p.pool.quoteTokenAccount),
  };
}

export async function savePending(p: PendingOrder): Promise<void> {
  await AsyncStorage.setItem(PENDING, JSON.stringify(p));
}

export async function loadPending(): Promise<PendingOrder | null> {
  const v = await AsyncStorage.getItem(PENDING);
  return v ? (JSON.parse(v) as PendingOrder) : null;
}

export async function clearPending(): Promise<void> {
  await AsyncStorage.removeItem(PENDING);
}

/** Forget the order: key first (it is the sensitive part), then the notes. */
export async function endSession(): Promise<void> {
  await deleteSessionKey();
  await clearPending();
  console.log("RUNG session key deleted");
}
