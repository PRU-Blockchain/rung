import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { TransactionInstruction } from "@solana/web3.js";

import { toHex } from "../src/bytes";

export const CLIENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_DIR = join(CLIENT_DIR, "..");

const VECTORS = join(CLIENT_DIR, "test/vectors.json");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function vectors(): any {
  if (!existsSync(VECTORS)) {
    throw new Error("client/test/vectors.json is missing: run `cargo test -p rung --test client_vectors`");
  }
  return JSON.parse(readFileSync(VECTORS, "utf8"));
}

export const repoFile = (path: string) => readFileSync(join(REPO_DIR, path), "utf8");

/** The same shape `client_vectors.rs` writes for an instruction. */
export function ixJson(ix: TransactionInstruction) {
  return {
    program_id: ix.programId.toBase58(),
    data: toHex(ix.data),
    accounts: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), is_signer: k.isSigner, is_writable: k.isWritable })),
  };
}
