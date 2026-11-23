// What a buy will do and cost, before the wallet sees it.

import {
  FeeBudget,
  MAX_CAP_BPS,
  MAX_ORDER_LAMPORTS,
  MAX_RUNGS,
  MIN_ORDER_LAMPORTS,
  MODES,
  Mode,
  ORDER_ACCOUNT_LEN,
  OrderQuote,
  PoolOrderQuote,
  RentReserve,
  feeBudget,
  quoteOrder,
  quotePoolOrder,
  rentReserve,
  txFeeLamports,
} from "../../../client/src";

import { rentFor } from "./connection";
import { sol } from "./format";
import { Market } from "./market";

export const MODE_OPTIONS: { mode: Mode; label: string }[] = [
  { mode: "tight", label: "Tight 1% → 2% → 3%" },
  { mode: "normal", label: "Normal 2-3-5%" },
  { mode: "fast", label: "Fast 5-10-15%" },
  { mode: "launch", label: "Launch 10-20-30%" },
  { mode: "custom", label: "Custom" },
];

export const WIDE_FIRST_RUNG = "First rung is wide. Launch mode starts tighter, at 10%.";

/** Slots between rungs and the order's lifetime (the CLI's defaults). */
export const WINDOW_SLOTS = 4n;
export const LIFETIME_SLOTS = 150n;

export const rungsForMode = (mode: Exclude<Mode, "custom">) => [...MODES[mode]];

/**
 * "1, 2.5, 4" -> [100, 250, 400] bps. Returns an error line instead when the
 * rungs break the program's rules (1-5 rungs, increasing, cap at most 30%).
 */
export function parseCustomRungs(text: string): { rungs: number[] } | { error: string } {
  // "1,5" (a decimal comma, as a Turkish keyboard types it) was read as two
  // rungs, 1% and 5%, without a word. A comma between two digits is ambiguous,
  // so ask for a dot instead of guessing.
  if (/\d,\d/.test(text)) return { error: "Use a dot for decimals (1.5) and a comma and space between rungs (1, 2, 3)." };
  const parts = text.split(/[,\s]+/).filter(Boolean);
  if (parts.length < 1 || parts.length > MAX_RUNGS) return { error: `Enter 1 to ${MAX_RUNGS} rungs, in percent.` };
  const rungs: number[] = [];
  for (const p of parts) {
    if (!/^\d+(\.\d{1,2})?$/.test(p)) return { error: "Rungs are percents like 1, 2.5, 4." };
    const bps = Math.round(Number(p) * 100);
    if (bps <= 0) return { error: "Each rung must be above 0%." };
    if (rungs.length && bps <= rungs[rungs.length - 1]) return { error: "Each rung must be higher than the one before." };
    rungs.push(bps);
  }
  if (rungs[rungs.length - 1] > MAX_CAP_BPS) return { error: `The last rung is the cap: at most ${MAX_CAP_BPS / 100}%.` };
  return { rungs };
}

export function amountError(amount: bigint | null): string | null {
  if (amount === null) return "Enter an amount in SOL.";
  if (amount < MIN_ORDER_LAMPORTS || amount > MAX_ORDER_LAMPORTS) {
    return `Amount must be between ${sol(MIN_ORDER_LAMPORTS).replace(" SOL", "")} and ${sol(MAX_ORDER_LAMPORTS)}.`;
  }
  return null;
}

export interface Plan {
  market: Market;
  mode: Mode;
  rungs: number[];
  amount: bigint;
  quote: OrderQuote | PoolOrderQuote;
  reserve: RentReserve;
  /** Tries priced at the venue's compute unit limit (`cuLimitFor`): higher in a pool. */
  budget: FeeBudget;
  orderRent: bigint;
}

export async function makePlan(market: Market, mode: Mode, rungs: number[], amount: bigint): Promise<Plan> {
  const venue = market.venue;
  const quote =
    market.venue === "Curve"
      ? quoteOrder(amount, market.curve, market.feeConfig, market.supply)
      : quotePoolOrder(amount, market.pool.reserves, market.pool.feeConfig, market.supply);
  const reserve = await rentReserve(rentFor, market.tokenProgram, undefined, venue);
  const budget = feeBudget({ rungCount: rungs.length, rentExemptMinimum: await rentFor(0), venue });
  return { market, mode, rungs, amount, quote, reserve, budget, orderRent: await rentFor(ORDER_ACCOUNT_LEN) };
}

/** "If no rung fills, max fee": every try, the refund and the sweep; not the wallet's own fee. */
export const maxFeeIfNoFill = (p: Plan) => p.budget.tries + p.budget.refund + p.budget.sweep;

/** What leaves the wallet when the order opens, before the wallet's own fee. */
export function leavesWallet(p: Plan, orderAccountExists: boolean) {
  const orderDeposit = orderAccountExists ? 0n : p.orderRent;
  return {
    buy: p.amount,
    rentShare: p.reserve.total,
    feeShare: p.budget.total,
    orderDeposit,
    total: p.amount + p.reserve.total + p.budget.total + orderDeposit,
  };
}

/** The approval fee of a one-signature transaction without a priority fee (what the wallet usually sets). */
export const typicalApprovalFee = () => txFeeLamports();
