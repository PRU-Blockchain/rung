// A token's name, symbol and picture address, read from the chain.
//
// pump.fun mints made since its move to Token-2022 keep these inside the mint
// account (the "token metadata" extension); older ones have a Metaplex
// metadata account. Both were read from mainnet on Nov 25, 2026; the bytes are
// in test/token-vectors.json.
//
// Everything here is written by whoever made the token. A name proves nothing
// about what the token is; the address does.

import { PublicKey } from "@solana/web3.js";

import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./constants";

export const METAPLEX_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

export function metaplexMetadataPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [new Uint8Array([109, 101, 116, 97, 100, 97, 116, 97]) /* "metadata" */, METAPLEX_METADATA_PROGRAM_ID.toBytes(), mint.toBytes()],
    METAPLEX_METADATA_PROGRAM_ID,
  )[0];
}

/** Name, symbol and the address of the metadata file, cleaned for display. */
export interface TokenText {
  name: string;
  symbol: string;
  uri: string;
}

const MAX_NAME = 32;
const MAX_SYMBOL = 10;
const MAX_URI = 512;

// --- Text ---------------------------------------------------------------------

/** UTF-8 to text; bytes that are not valid UTF-8 are dropped. (Hermes has no TextDecoder.) */
function utf8(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    let need = 0;
    let cp = 0;
    if (b < 0x80) (cp = b), (need = 0);
    else if (b >= 0xc2 && b < 0xe0) (cp = b & 0x1f), (need = 1);
    else if (b >= 0xe0 && b < 0xf0) (cp = b & 0x0f), (need = 2);
    else if (b >= 0xf0 && b < 0xf5) (cp = b & 0x07), (need = 3);
    else {
      i++;
      continue;
    }
    let ok = i + need < bytes.length;
    for (let k = 1; ok && k <= need; k++) {
      const c = bytes[i + k];
      if ((c & 0xc0) !== 0x80) ok = false;
      else cp = (cp << 6) | (c & 0x3f);
    }
    const min = need === 1 ? 0x80 : need === 2 ? 0x800 : need === 3 ? 0x10000 : 0;
    if (!ok || cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      i++;
      continue;
    }
    out += String.fromCodePoint(cp);
    i += need + 1;
  }
  return out;
}

/** Characters that draw nothing or change the direction of the text around them. */
function invisible(cp: number): boolean {
  return (
    cp < 0x20 ||
    (cp >= 0x7f && cp <= 0x9f) ||
    cp === 0xad ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2060 && cp <= 0x206f) ||
    cp === 0xfeff ||
    cp === 0xfffd
  );
}

/**
 * Text a token's maker wrote, made safe to put on a screen: line breaks become
 * spaces, invisible and direction-changing characters are removed, and the
 * result is cut to `max` characters.
 */
export function cleanTokenText(text: string, max: number): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d || cp === 0x2028 || cp === 0x2029 || cp === 0xa0) out += " ";
    else if (!invisible(cp)) out += ch;
  }
  out = out.replace(/ +/g, " ").trim();
  return Array.from(out).slice(0, max).join("").trim();
}

const cleanUri = (text: string) => text.replace(/\0/g, "").trim();

// --- Reading ------------------------------------------------------------------

/** A reader that returns null past the end instead of throwing. */
class Cursor {
  constructor(
    private readonly data: Uint8Array,
    private at: number,
    private readonly end: number,
  ) {}

  bytes(n: number): Uint8Array | null {
    if (n < 0 || this.at + n > this.end) return null;
    const out = this.data.subarray(this.at, this.at + n);
    this.at += n;
    return out;
  }

  /** A length-prefixed string (u32 little-endian, then that many bytes). */
  text(): string | null {
    const len = this.bytes(4);
    if (!len) return null;
    const n = (len[0] | (len[1] << 8) | (len[2] << 16) | (len[3] << 24)) >>> 0;
    const body = this.bytes(n);
    return body ? utf8(body) : null;
  }
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function finish(name: string | null, symbol: string | null, uri: string | null): TokenText | null {
  if (name === null || symbol === null || uri === null) return null;
  const text = { name: cleanTokenText(name, MAX_NAME), symbol: cleanTokenText(symbol, MAX_SYMBOL), uri: cleanUri(uri) };
  return text.name || text.symbol ? text : null;
}

// A Token-2022 mint: the 82 mint bytes, zeros up to byte 165, an account-type
// byte (1 = mint), then extensions as (type u16, length u16, value).
const ACCOUNT_TYPE_AT = 165;
const ACCOUNT_TYPE_MINT = 1;
const EXTENSION_TOKEN_METADATA = 19;

/**
 * Name, symbol and uri from the metadata extension inside a Token-2022 mint
 * account, or null when the mint has none (or it names another mint).
 */
export function decodeToken2022Metadata(mint: PublicKey, mintData: Uint8Array): TokenText | null {
  if (mintData.length <= ACCOUNT_TYPE_AT || mintData[ACCOUNT_TYPE_AT] !== ACCOUNT_TYPE_MINT) return null;
  let at = ACCOUNT_TYPE_AT + 1;
  while (at + 4 <= mintData.length) {
    const type = mintData[at] | (mintData[at + 1] << 8);
    const length = mintData[at + 2] | (mintData[at + 3] << 8);
    const start = at + 4;
    const end = start + length;
    if (type === 0 || end > mintData.length) return null;
    if (type === EXTENSION_TOKEN_METADATA) {
      const cursor = new Cursor(mintData, start, end);
      const updateAuthority = cursor.bytes(32);
      const forMint = cursor.bytes(32);
      if (!updateAuthority || !forMint || !equalBytes(forMint, mint.toBytes())) return null;
      return finish(cursor.text(), cursor.text(), cursor.text());
    }
    at = end;
  }
  return null;
}

// A Metaplex metadata account: key (4 = metadata), update authority, mint,
// then name, symbol and uri as length-prefixed strings padded with zeros.
const METAPLEX_KEY_METADATA = 4;

/** Name, symbol and uri from a Metaplex metadata account, or null when it is not this mint's. */
export function decodeMetaplexMetadata(mint: PublicKey, data: Uint8Array): TokenText | null {
  if (data.length < 65 || data[0] !== METAPLEX_KEY_METADATA) return null;
  if (!equalBytes(data.subarray(33, 65), mint.toBytes())) return null;
  const cursor = new Cursor(data, 65, data.length);
  return finish(cursor.text(), cursor.text(), cursor.text());
}

interface OwnedData {
  owner: PublicKey;
  data: Uint8Array;
}

/**
 * A token's name, symbol and uri from the two accounts they can be in: the
 * mint itself (`mintAccount`) and the account at `metaplexMetadataPda(mint)`.
 * Each is read only when the right program owns it.
 */
export function tokenText(mint: PublicKey, mintAccount: OwnedData | null, metaplexAccount: OwnedData | null): TokenText | null {
  if (!mintAccount) return null;
  if (mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    const inside = decodeToken2022Metadata(mint, mintAccount.data);
    if (inside) return inside;
  } else if (!mintAccount.owner.equals(TOKEN_PROGRAM_ID)) {
    return null;
  }
  if (metaplexAccount && metaplexAccount.owner.equals(METAPLEX_METADATA_PROGRAM_ID)) {
    return decodeMetaplexMetadata(mint, metaplexAccount.data);
  }
  return null;
}

// --- The metadata file and the picture ------------------------------------------

/**
 * Public IPFS gateways that answered a plain request on Nov 25, 2026, fastest
 * first. Content on IPFS is addressed by its hash, so every gateway serves the
 * same bytes.
 */
export const IPFS_GATEWAYS = ["https://ipfs.filebase.io/ipfs/", "https://4everland.io/ipfs/", "https://gateway.pinata.cloud/ipfs/"] as const;

/** Gateways that no longer answer plain requests (429 or a browser check on Nov 25, 2026). */
const DEAD_IPFS_HOSTS = ["ipfs.io", "gateway.ipfs.io", "dweb.link", "w3s.link", "cloudflare-ipfs.com"];

const CID = "[A-Za-z0-9]{32,128}";
const IPFS_PATH = "(?:/[A-Za-z0-9._~%+\\-/]*)?";
const viaGateways = (cidAndPath: string): string[] => (cidAndPath.split("/").includes("..") ? [] : IPFS_GATEWAYS.map((g) => `${g}${cidAndPath}`));
const isDeadHost = (host: string) => DEAD_IPFS_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));

/**
 * The https addresses to try, in order, for an address written by a token's
 * maker (the metadata file, or the picture inside it). Empty when it is not
 * fetched at all: anything but https or ipfs, an address with a login, a port,
 * an IP address or a local name.
 */
export function fetchUrls(uri: string): string[] {
  const text = uri.trim();
  if (text.length === 0 || text.length > MAX_URI || /\s/.test(text)) return [];

  const ipfs = new RegExp(`^ipfs://(?:ipfs/)?(${CID}${IPFS_PATH})$`).exec(text);
  if (ipfs) return viaGateways(ipfs[1]);

  const https = /^https:\/\/([^/?#]+)([/?#].*)?$/i.exec(text);
  if (!https) return [];
  const host = https[1].toLowerCase();
  const rest = https[2] ?? "";
  // A plain domain name: no login, no port, no IP address, no single-label local name.
  if (!/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(host)) return [];
  const normal = `https://${host}${rest}`;

  const byPath = new RegExp(`^/ipfs/(${CID}${IPFS_PATH})(?:[?#].*)?$`).exec(rest);
  const bySubdomain = new RegExp(`^(${CID})\\.ipfs\\.`).exec(host);
  const cidAndPath = byPath ? byPath[1] : bySubdomain ? `${bySubdomain[1]}${/^[^?#]*/.exec(rest)![0].replace(/\/$/, "")}` : null;
  if (cidAndPath === null) return [normal];
  const gateways = viaGateways(cidAndPath);
  if (isDeadHost(host)) return gateways;
  return [normal, ...gateways.filter((g) => g !== normal)];
}

/** The addresses to try for the picture named in a metadata file (its `image` field). */
export function imageFromMetadataJson(json: unknown): string[] {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return [];
  const image = (json as { image?: unknown }).image;
  return typeof image === "string" ? fetchUrls(image) : [];
}

// Present in every JavaScript runtime this module targets (Node 18+, React
// Native); declared here so the module needs neither DOM nor Node types.
declare function setTimeout(callback: () => void, ms: number): unknown;
declare function clearTimeout(timer: unknown): void;
declare const AbortController: undefined | (new () => { signal: unknown; abort(): void });

/** The part of `fetch` this needs; the runtime's own `fetch` fits. */
export type TextFetch = (url: string, init?: { signal?: unknown }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/**
 * The addresses to try for a token's picture: reads the metadata file at
 * `uri` (through `fetchUrls`, first address that answers with a JSON object)
 * and takes its `image`. Empty when there is none. Never throws: a picture is
 * decoration and must not get in the way of a buy.
 */
export async function fetchTokenImageUrls(
  fetchFn: TextFetch,
  uri: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<string[]> {
  const timeoutMs = opts.timeoutMs ?? 6_000;
  const maxBytes = opts.maxBytes ?? 64_000;
  for (const url of fetchUrls(uri)) {
    const abort = typeof AbortController === "undefined" ? undefined : new AbortController();
    let timer: unknown;
    try {
      const read = (async () => {
        const res = await fetchFn(url, abort ? { signal: abort.signal } : undefined);
        return res.ok ? await res.text() : null;
      })();
      // The losing side of the race must not become an unhandled rejection.
      read.catch(() => {});
      const late = new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          abort?.abort();
          resolve(null);
        }, timeoutMs);
      });
      const text = await Promise.race([read, late]);
      if (text === null || text.length > maxBytes) continue;
      const json: unknown = JSON.parse(text);
      if (typeof json !== "object" || json === null || Array.isArray(json)) continue;
      return imageFromMetadataJson(json);
    } catch {
      // next address
    } finally {
      clearTimeout(timer);
    }
  }
  return [];
}
