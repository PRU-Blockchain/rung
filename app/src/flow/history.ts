// Receipts, newest first, in AsyncStorage. Reading them never touches the network.
// Each receipt carries the network it was written on; a build lists its own.

import AsyncStorage from "@react-native-async-storage/async-storage";

import { PublicKey } from "../../../client/src";

import { NETWORK } from "../config";
import { Cluster, legacyReceiptCluster, receiptShownOn } from "../network";
import { connection } from "./connection";

const HISTORY = "rung.history";

export interface TxLink {
  label: string;
  signature: string;
  /** `meta.fee`, lamports, as a string. */
  fee?: string;
  outcome: string;
}

export interface Receipt {
  id: string;
  time: number;
  /** The network of the buy; missing in receipts written before Nov 25, 2026 (see `sortOldReceipts`). */
  cluster?: Cluster;
  mint: string;
  /** "Curve" or "PumpSwap"; missing in receipts written before pools were supported (all curve buys). */
  venue?: "Curve" | "PumpSwap";
  decimals: number;
  mode: string;
  rungsBps: number[];
  amount: string;
  /** "filled", "not-bought", or "unclear" when neither a fill nor a refund was seen. */
  outcome: "filled" | "not-bought" | "unclear";
  expectedTokensSeen: string;
  filledRungIndex?: number;
  filledRungBps?: number;
  tokensBought?: string;
  lamportsSpent?: string;
  /** Not bought: how far the price was above the price seen after the last try, percent. */
  priceNowAbovePct?: number;
  /** Sum of `meta.fee` of the tries, refund and sweep. */
  rungFees: string;
  /** `meta.fee` of the transaction the wallet signed. */
  approvalFee?: string;
  /** Deposits left behind, lamports as strings ("0" when none). */
  userTokenAccountDeposit: string;
  accumulatorDeposit: string;
  orderDeposit: string;
  transactions: TxLink[];
}

export const receiptVenue = (r: Receipt) => r.venue ?? "Curve";

/** The receipt line for the venue's volume account the fill created. */
export const accumulatorLabel = (r: Receipt) =>
  receiptVenue(r) === "PumpSwap" ? "PumpSwap volume account (one time)" : "pump.fun volume account (one time)";

export const venueName = (r: Receipt) => (receiptVenue(r) === "PumpSwap" ? "PumpSwap pool" : "pump.fun bonding curve");

/** Every stored receipt, of either network. */
async function readAll(): Promise<Receipt[]> {
  try {
    const v = await AsyncStorage.getItem(HISTORY);
    return v ? (JSON.parse(v) as Receipt[]) : [];
  } catch {
    return [];
  }
}

/** The receipts of this build's network. */
export async function loadHistory(): Promise<Receipt[]> {
  return (await readAll()).filter((r) => receiptShownOn(r.cluster, NETWORK.cluster));
}

export async function addReceipt(r: Receipt): Promise<void> {
  const list = await readAll();
  await AsyncStorage.setItem(HISTORY, JSON.stringify([{ ...r, cluster: NETWORK.cluster }, ...list].slice(0, 200)));
}

/**
 * Gives old receipts their network: asks this build's network once which of
 * their tokens it has (`legacyReceiptCluster`), one request for all of them.
 * Resolves true when a receipt was sorted, so the list can be read again.
 * Without a network nothing changes and the old receipts stay listed.
 */
export async function sortOldReceipts(): Promise<boolean> {
  try {
    const old = (await readAll()).filter((r) => r.cluster === undefined);
    if (old.length === 0) return false;
    // getMultipleAccounts takes at most 100 addresses; the history holds at most 200 receipts.
    const mints = [...new Set(old.map((r) => r.mint))];
    const has = new Map<string, boolean>();
    for (let i = 0; i < mints.length; i += 100) {
      const part = mints.slice(i, i + 100);
      const infos = await connection.getMultipleAccountsInfo(
        part.map((m) => new PublicKey(m)),
        { dataSlice: { offset: 0, length: 0 } },
      );
      part.forEach((m, k) => has.set(m, infos[k] !== null));
    }
    const sorted = new Map<string, Cluster>();
    for (const r of old) {
      const cluster = legacyReceiptCluster(NETWORK.cluster, has.get(r.mint) ?? null);
      if (cluster) sorted.set(r.id, cluster);
    }
    if (sorted.size === 0) return false;
    // Read again right before writing: a buy may have added a receipt meanwhile.
    const list = (await readAll()).map((r) => (r.cluster === undefined && sorted.has(r.id) ? { ...r, cluster: sorted.get(r.id) } : r));
    await AsyncStorage.setItem(HISTORY, JSON.stringify(list));
    return true;
  } catch (e) {
    console.log(`RUNG old receipts not sorted: ${String((e as Error)?.message ?? e)}`);
    return false;
  }
}
