import { Connection } from "@solana/web3.js";

import { RPC_ENDPOINT } from "../config";

/** One devnet connection for the whole app (public endpoint, no key). */
export const connection = new Connection(RPC_ENDPOINT, "confirmed");

// web3.js 1.x `confirmTransaction` rejects with the transaction's own error
// (the status `err`, a plain object like `{ InstructionError: [2, { Custom: 6042 }] }`)
// when it reads a failed status right after subscribing. That transaction
// landed, so turn the rejection back into the normal result and let the
// caller read the failure with `getTransaction`. The client's
// `sendAndConfirm` handles this itself; the wrapper covers the app's own
// confirmation of the approval transaction as well.
const confirm = connection.confirmTransaction.bind(connection);
connection.confirmTransaction = (async (...args: Parameters<typeof confirm>) => {
  try {
    return await confirm(...args);
  } catch (e) {
    if (e instanceof Error) throw e;
    return { context: { slot: 0 }, value: { err: e as object } };
  }
}) as typeof connection.confirmTransaction;

const rentCache = new Map<number, bigint>();

/** Rent-exempt minimum for an account of `len` bytes, cached. */
export async function rentFor(len: number): Promise<bigint> {
  let v = rentCache.get(len);
  if (v === undefined) {
    v = BigInt(await connection.getMinimumBalanceForRentExemption(len));
    rentCache.set(len, v);
  }
  return v;
}
