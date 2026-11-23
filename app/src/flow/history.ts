// Receipts, newest first, in AsyncStorage. Reading them never touches the network.

import AsyncStorage from "@react-native-async-storage/async-storage";

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

export async function loadHistory(): Promise<Receipt[]> {
  try {
    const v = await AsyncStorage.getItem(HISTORY);
    return v ? (JSON.parse(v) as Receipt[]) : [];
  } catch {
    return [];
  }
}

export async function addReceipt(r: Receipt): Promise<void> {
  const list = await loadHistory();
  await AsyncStorage.setItem(HISTORY, JSON.stringify([r, ...list].slice(0, 200)));
}
