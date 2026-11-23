// The order's one-time session key lives only in expo-secure-store. What the
// app needs to finish or resume an order (no secrets) is kept in AsyncStorage.

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

import { Keypair } from "../../../client/src";

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
  tokenProgram: string;
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
}
