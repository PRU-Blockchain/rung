// Small copy of the event and error decoding in client/src (events.ts,
// bytes.ts, errors.ts, constants.ts). It is copied rather than imported because
// Vercel builds this site with Root Directory `web`, and files outside it are
// not guaranteed to be present at build time; it also avoids pulling
// @solana/web3.js into the site. Pubkeys are kept as hex: the page never shows
// them, it only needs to tell users apart. If the program's events change,
// change client/src/events.ts first and copy the change here.

// client/src/constants.ts
export const RUNG_EVENT = {
  OrderOpened: [2, 254, 197, 24, 41, 166, 225, 56],
  OrderFilled: [120, 124, 109, 66, 249, 116, 174, 30],
  OrderRefunded: [120, 155, 10, 169, 7, 98, 202, 187],
} as const;

export const RUNG_IX = {
  openOrder: [206, 88, 88, 143, 38, 136, 50, 224],
  tryRung: [140, 95, 252, 49, 172, 11, 13, 236],
  refund: [2, 96, 183, 251, 63, 208, 46, 46],
  cancel: [232, 219, 223, 41, 219, 236, 220, 190],
} as const;

export type RungIx = keyof typeof RUNG_IX;

export const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
/** pump's `BuySlippageBelowMinTokensOut`. */
export const PUMP_SLIPPAGE_ERROR = 6042;
/** Rung's `OrderFilled` error: a try after the order already bought. */
export const RUNG_ORDER_FILLED_ERROR = 6012;

const MAX_RUNGS = 5;

export type RefundReason = "Expired" | "GaveUp" | "Cancelled";
const REFUND_REASONS: readonly RefundReason[] = ["Expired", "GaveUp", "Cancelled"];

export type RungEvent =
  | { name: "OrderOpened"; user: string; rungCount: number; rungsBps: number[]; amount: number }
  | { name: "OrderFilled"; user: string; rungIndex: number; rungBps: number; lamportsSpent: number }
  | { name: "OrderRefunded"; user: string; reason: RefundReason; lamportsReturned: number };

// client/src/bytes.ts (Reader, reduced to what the events need)
class Reader {
  private view: DataView;
  constructor(
    private data: Uint8Array,
    public offset = 0,
  ) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  private need(n: number): number {
    if (this.offset + n > this.data.length) throw new RangeError("event data too short");
    const at = this.offset;
    this.offset += n;
    return at;
  }
  u8(): number {
    return this.view.getUint8(this.need(1));
  }
  u16(): number {
    return this.view.getUint16(this.need(2), true);
  }
  u64(): number {
    return Number(this.view.getBigUint64(this.need(8), true));
  }
  pubkeyHex(): string {
    const at = this.need(32);
    return Array.from(this.data.subarray(at, at + 32), (b) => b.toString(16).padStart(2, "0")).join("");
  }
}

export function startsWith(data: Uint8Array, prefix: readonly number[]): boolean {
  if (data.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (data[i] !== prefix[i]) return false;
  return true;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64Decode(text: string): Uint8Array {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of text) {
    if (ch === "=") break;
    const v = B64.indexOf(ch);
    if (v < 0) continue;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  return Uint8Array.from(out);
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Decode(text: string): Uint8Array {
  // BigInt() calls instead of literals: tsconfig targets ES2017.
  const ZERO = BigInt(0);
  const BASE = BigInt(58);
  const BYTE = BigInt(0xff);
  const EIGHT = BigInt(8);
  let n = ZERO;
  for (const ch of text) {
    const v = B58.indexOf(ch);
    if (v < 0) throw new Error(`invalid base58 character: ${ch}`);
    n = n * BASE + BigInt(v);
  }
  const body: number[] = [];
  while (n > ZERO) {
    body.unshift(Number(n & BYTE));
    n >>= EIGHT;
  }
  let zeros = 0;
  while (zeros < text.length && text[zeros] === "1") zeros++;
  return Uint8Array.from([...new Array(zeros).fill(0), ...body]);
}

// client/src/events.ts decodeEvent
export function decodeEvent(data: Uint8Array): RungEvent | null {
  if (startsWith(data, RUNG_EVENT.OrderOpened)) {
    const r = new Reader(data, 8);
    const user = r.pubkeyHex();
    r.pubkeyHex(); // session key
    r.pubkeyHex(); // mint
    r.u8(); // venue
    const amount = r.u64();
    const rungCount = r.u8();
    const rungs = Array.from({ length: MAX_RUNGS }, () => r.u16());
    return { name: "OrderOpened", user, rungCount, rungsBps: rungs.slice(0, rungCount), amount };
  }
  if (startsWith(data, RUNG_EVENT.OrderFilled)) {
    const r = new Reader(data, 8);
    const user = r.pubkeyHex();
    r.pubkeyHex(); // mint
    const rungIndex = r.u8();
    const rungBps = r.u16();
    r.u64(); // tokens bought
    const lamportsSpent = r.u64();
    return { name: "OrderFilled", user, rungIndex, rungBps, lamportsSpent };
  }
  if (startsWith(data, RUNG_EVENT.OrderRefunded)) {
    const r = new Reader(data, 8);
    const user = r.pubkeyHex();
    r.pubkeyHex(); // mint
    const reason = REFUND_REASONS[r.u8()];
    if (!reason) throw new Error("unknown refund reason");
    return { name: "OrderRefunded", user, reason, lamportsReturned: r.u64() };
  }
  return null;
}

const INVOKE = /^Program (\S+) invoke \[\d+\]$/;
const EXIT = /^Program (\S+) (success|failed: .*)$/;
const DATA = "Program data: ";

// client/src/events.ts parseEvents: only data lines written while Rung itself
// is executing are read, so another program cannot pose as a Rung event.
export function parseEvents(logs: readonly string[], programId: string): RungEvent[] {
  const stack: string[] = [];
  const out: RungEvent[] = [];
  for (const line of logs) {
    const invoke = INVOKE.exec(line);
    if (invoke) {
      stack.push(invoke[1]);
      continue;
    }
    if (EXIT.test(line)) {
      stack.pop();
      continue;
    }
    if (line.startsWith(DATA) && stack[stack.length - 1] === programId) {
      const event = decodeEvent(base64Decode(line.slice(DATA.length)));
      if (event) out.push(event);
    }
  }
  return out;
}

const FAILED = /^Program (\S+) failed: (.*)$/;
const CUSTOM = /custom program error: 0x([0-9a-fA-F]+)/;

// client/src/errors.ts failingProgramFromLogs: the first `failed` line is the
// innermost failing program.
export function failingProgramFromLogs(logs: readonly string[]): { programId: string; code?: number } | undefined {
  for (const line of logs) {
    const m = FAILED.exec(line);
    if (!m) continue;
    const custom = CUSTOM.exec(m[2]);
    return { programId: m[1], code: custom ? parseInt(custom[1], 16) : undefined };
  }
  return undefined;
}
