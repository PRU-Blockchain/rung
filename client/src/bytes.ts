// Little-endian Borsh primitives, base64 and base58, with no Node APIs, so the
// same code runs in Node, browsers and React Native.

import { PublicKey, TransactionInstruction } from "@solana/web3.js";

const U64_MAX = (1n << 64n) - 1n;

/** The type of `TransactionInstruction.data` (a Buffer). */
export type InstructionData = TransactionInstruction["data"];

// The Buffer class web3.js itself uses (Node's, or the `buffer` package in
// browsers and React Native), so this module needs no Buffer of its own.
const BufferClass = PublicKey.default.toBuffer().constructor as unknown as {
  from(buffer: ArrayBufferLike, byteOffset: number, length: number): InstructionData;
};

export function toBuffer(bytes: Uint8Array): InstructionData {
  return BufferClass.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function u8(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) throw new RangeError(`u8 out of range: ${value}`);
  return Uint8Array.of(value);
}

export function u16(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new RangeError(`u16 out of range: ${value}`);
  return Uint8Array.of(value & 0xff, value >> 8);
}

export function u32(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new RangeError(`u32 out of range: ${value}`);
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

export function u64(value: bigint): Uint8Array {
  if (value < 0n || value > U64_MAX) throw new RangeError(`u64 out of range: ${value}`);
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}

/** Borsh `Vec<u16>`: u32 length, then the elements. */
export function vecU16(values: readonly number[]): Uint8Array {
  return concat(u32(values.length), ...values.map(u16));
}

/** Sequential little-endian reader that fails loudly on short data. */
export class Reader {
  offset: number;
  private view: DataView;

  constructor(private data: Uint8Array, offset = 0) {
    this.offset = offset;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  get remaining(): number {
    return this.data.length - this.offset;
  }

  private need(n: number): number {
    if (this.offset + n > this.data.length) {
      throw new RangeError(`data too short: need ${n} bytes at offset ${this.offset}, have ${this.data.length}`);
    }
    const at = this.offset;
    this.offset += n;
    return at;
  }

  bytes(n: number): Uint8Array {
    const at = this.need(n);
    return this.data.slice(at, at + n);
  }
  u8(): number {
    return this.view.getUint8(this.need(1));
  }
  bool(): boolean {
    return this.u8() !== 0;
  }
  u16(): number {
    return this.view.getUint16(this.need(2), true);
  }
  u32(): number {
    return this.view.getUint32(this.need(4), true);
  }
  u64(): bigint {
    return this.view.getBigUint64(this.need(8), true);
  }
  i64(): bigint {
    return this.view.getBigInt64(this.need(8), true);
  }
  u128(): bigint {
    const lo = this.u64();
    const hi = this.u64();
    return (hi << 64n) | lo;
  }
  i128(): bigint {
    return BigInt.asIntN(128, this.u128());
  }
  pubkey(): PublicKey {
    return new PublicKey(this.bytes(32));
  }
}

export function readU64(data: Uint8Array, offset: number): bigint {
  return new Reader(data, offset).u64();
}

export function startsWith(data: Uint8Array, prefix: readonly number[] | Uint8Array): boolean {
  if (data.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (data[i] !== prefix[i]) return false;
  return true;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64Decode(text: string): Uint8Array {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of text) {
    if (ch === "=") break;
    const v = B64.indexOf(ch);
    if (v < 0) continue; // whitespace
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

export function base64Encode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64[n & 63] : "=";
  }
  return out;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Decode(text: string): Uint8Array {
  let n = 0n;
  for (const ch of text) {
    const v = B58.indexOf(ch);
    if (v < 0) throw new Error(`invalid base58 character: ${ch}`);
    n = n * 58n + BigInt(v);
  }
  const body: number[] = [];
  while (n > 0n) {
    body.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  let zeros = 0;
  while (zeros < text.length && text[zeros] === "1") zeros++;
  return Uint8Array.from([...new Array(zeros).fill(0), ...body]);
}
