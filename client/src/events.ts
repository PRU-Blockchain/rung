// Rung's Anchor events from transaction logs (`Program data: <base64>`).
// Only lines written while Rung itself is executing are read, so another
// program's data lines can never pose as a Rung event.

import { PublicKey } from "@solana/web3.js";

import { enumName } from "./accounts";
import { Reader, base64Decode, startsWith } from "./bytes";
import { MAX_RUNGS, RUNG_EVENT, RUNG_PROGRAM_ID, VENUES, type Venue } from "./constants";

export type RefundReason = "Expired" | "GaveUp" | "Cancelled";
const REFUND_REASONS: readonly RefundReason[] = ["Expired", "GaveUp", "Cancelled"];

export interface OrderOpened {
  name: "OrderOpened";
  user: PublicKey;
  sessionKey: PublicKey;
  mint: PublicKey;
  venue: Venue;
  amount: bigint;
  rungCount: number;
  rungsBps: number[];
  expectedTokensSeen: bigint;
  expectedTokensStart: bigint;
  startSlot: bigint;
  windowSlots: bigint;
  lastSlot: bigint;
}

export interface OrderFilled {
  name: "OrderFilled";
  user: PublicKey;
  mint: PublicKey;
  rungIndex: number;
  rungBps: number;
  tokensBought: bigint;
  lamportsSpent: bigint;
  expectedTokensSeen: bigint;
  expectedTokensStart: bigint;
  slot: bigint;
}

export interface OrderRefunded {
  name: "OrderRefunded";
  user: PublicKey;
  mint: PublicKey;
  reason: RefundReason;
  lamportsReturned: bigint;
  slot: bigint;
}

export type RungEvent = OrderOpened | OrderFilled | OrderRefunded;

/** Decodes one event payload (discriminator included); `null` if it is not a Rung event. */
export function decodeEvent(data: Uint8Array): RungEvent | null {
  if (startsWith(data, RUNG_EVENT.OrderOpened)) {
    const r = new Reader(data, 8);
    const user = r.pubkey();
    const sessionKey = r.pubkey();
    const mint = r.pubkey();
    const venue = enumName(VENUES, r.u8(), "Venue");
    const amount = r.u64();
    const rungCount = r.u8();
    const rungs = Array.from({ length: MAX_RUNGS }, () => r.u16());
    return {
      name: "OrderOpened",
      user,
      sessionKey,
      mint,
      venue,
      amount,
      rungCount,
      rungsBps: rungs.slice(0, rungCount),
      expectedTokensSeen: r.u64(),
      expectedTokensStart: r.u64(),
      startSlot: r.u64(),
      windowSlots: r.u64(),
      lastSlot: r.u64(),
    };
  }
  if (startsWith(data, RUNG_EVENT.OrderFilled)) {
    const r = new Reader(data, 8);
    return {
      name: "OrderFilled",
      user: r.pubkey(),
      mint: r.pubkey(),
      rungIndex: r.u8(),
      rungBps: r.u16(),
      tokensBought: r.u64(),
      lamportsSpent: r.u64(),
      expectedTokensSeen: r.u64(),
      expectedTokensStart: r.u64(),
      slot: r.u64(),
    };
  }
  if (startsWith(data, RUNG_EVENT.OrderRefunded)) {
    const r = new Reader(data, 8);
    return {
      name: "OrderRefunded",
      user: r.pubkey(),
      mint: r.pubkey(),
      reason: enumName(REFUND_REASONS, r.u8(), "RefundReason"),
      lamportsReturned: r.u64(),
      slot: r.u64(),
    };
  }
  return null;
}

const INVOKE = /^Program (\S+) invoke \[\d+\]$/;
const EXIT = /^Program (\S+) (success|failed: .*)$/;
const DATA = "Program data: ";

/** Every Rung event in `logs`, in order. */
export function parseEvents(logs: readonly string[], programId: PublicKey = RUNG_PROGRAM_ID): RungEvent[] {
  const id = programId.toBase58();
  const stack: string[] = [];
  const out: RungEvent[] = [];
  for (const line of logs) {
    const invoke = INVOKE.exec(line);
    if (invoke) {
      stack.push(invoke[1]);
      continue;
    }
    const exit = EXIT.exec(line);
    if (exit) {
      stack.pop();
      continue;
    }
    if (line.startsWith(DATA) && stack[stack.length - 1] === id) {
      const event = decodeEvent(base64Decode(line.slice(DATA.length)));
      if (event) out.push(event);
    }
  }
  return out;
}

export function findEvent<N extends RungEvent["name"]>(
  logs: readonly string[],
  name: N,
): Extract<RungEvent, { name: N }> | undefined {
  return parseEvents(logs).find((e): e is Extract<RungEvent, { name: N }> => e.name === name);
}
