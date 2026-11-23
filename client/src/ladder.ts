// The rung sender: tries each rung when it is due, signed by the session key,
// stops at the first fill, gives up with a refund after the last rung, and
// returns every lamport left on the session key to the user.

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionExpiredBlockheightExceededError,
  TransactionInstruction,
} from "@solana/web3.js";

import { Order, decodeOrder, rungDueSlot } from "./accounts";
import { DEFAULT_CU_LIMIT, DEFAULT_CU_PRICE, DEFAULT_REFUND_CU_LIMIT, sweepFeeLamports } from "./budget";
import { Failure, classifyFailure, describeFailure } from "./errors";
import { OrderFilled, OrderRefunded, findEvent } from "./events";
import { computeUnitLimitIx, computeUnitPriceIx, refundIx, tryRungIx } from "./instructions";
import { orderPda } from "./pdas";

export type AttemptKind = "try" | "refund" | "sweep";
export type Outcome =
  | "filled" // try_rung bought
  | "slippage" // pump refused this rung's minimum
  | "order-filled" // Rung says the order already bought
  | "failed" // any other error
  | "not-landed" // blockhash expired before the transaction landed
  | "ok"; // refund or sweep succeeded

export interface Attempt {
  kind: AttemptKind;
  rungIndex?: number;
  rungBps?: number;
  dueSlot?: bigint;
  signature: string;
  /** Slot the transaction landed in. */
  slot?: number;
  /** `meta.fee`, lamports. */
  fee?: bigint;
  /** `meta.computeUnitsConsumed`. */
  computeUnits?: number;
  outcome: Outcome;
  failure?: Failure;
  logs?: string[];
}

export type LadderEvent =
  | { type: "waiting"; rungIndex: number; dueSlot: bigint; slot: bigint }
  | { type: "sent"; kind: AttemptKind; rungIndex?: number; signature: string }
  | { type: "result"; attempt: Attempt; text: string };

export interface LadderParams {
  connection: Connection;
  user: PublicKey;
  mint: PublicKey;
  tokenProgram: PublicKey;
  /** One of pump's `Global.buyback_fee_recipients`. */
  buybackRecipient: PublicKey;
  /** The order's one-time key. Pays every fee here; ends with 0 lamports. */
  sessionKeypair: Keypair;
  /** The order as read after `open_order`; fetched if omitted. */
  order?: Order;
  cuLimit?: number;
  /** Micro-lamports per compute unit. */
  cuPrice?: bigint;
  refundCuLimit?: number;
  /** Slot polling interval. */
  pollMs?: number;
  onEvent?: (event: LadderEvent) => void;
}

export interface LadderResult {
  attempts: Attempt[];
  filled?: OrderFilled;
  refunded?: OrderRefunded;
  /** Lamports the sweep returned to the user. */
  sweptLamports: bigint;
  /** Session key balance at the end (0 when the sweep worked). */
  sessionBalanceAfter: bigint;
  /** Sum of `meta.fee` over every landed transaction here. */
  totalFees: bigint;
}

// Present in every JavaScript runtime this module targets; declared here so
// the module does not pull in Node or DOM type libraries.
declare function setTimeout(callback: () => void, ms: number): unknown;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Reads the order, retrying while the `open_order` transaction propagates. */
export async function fetchOrder(connection: Connection, user: PublicKey, tries = 10): Promise<Order | null> {
  for (let i = 0; i < tries; i++) {
    const info = await connection.getAccountInfo(orderPda(user), "confirmed");
    if (info) return decodeOrder(info.data);
    if (i + 1 < tries) await sleep(500);
  }
  return null;
}

export interface Landed {
  signature: string;
  landed: boolean;
  slot?: number;
  fee?: bigint;
  computeUnits?: number;
  err?: unknown;
  logs: string[];
}

/** Signs with `signer` (fee payer), sends without preflight, waits for `confirmed`. */
export async function sendAndConfirm(
  connection: Connection,
  instructions: TransactionInstruction[],
  signer: Keypair,
  onSent?: (signature: string) => void,
): Promise<Landed> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: signer.publicKey, blockhash, lastValidBlockHeight }).add(...instructions);
  tx.sign(signer);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  onSent?.(signature);
  try {
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  } catch (e) {
    if (e instanceof TransactionExpiredBlockheightExceededError) return { signature, landed: false, logs: [] };
    throw e;
  }
  for (let i = 0; i < 20; i++) {
    const got = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (got?.meta) {
      return {
        signature,
        landed: true,
        slot: got.slot,
        fee: BigInt(got.meta.fee),
        computeUnits: got.meta.computeUnitsConsumed,
        err: got.meta.err ?? undefined,
        logs: got.meta.logMessages ?? [],
      };
    }
    await sleep(500);
  }
  // Confirmed but not yet served by getTransaction: report what the status says.
  const status = (await connection.getSignatureStatuses([signature])).value[0];
  return { signature, landed: true, slot: status?.slot, err: status?.err ?? undefined, logs: [] };
}

function attemptText(a: Attempt): string {
  const what = a.kind === "try" ? `rung ${a.rungIndex} (${a.rungBps} bps)` : a.kind;
  const result = a.failure ? `${a.outcome}: ${describeFailure(a.failure)}` : a.outcome;
  return `${what}: ${result}`;
}

export async function runLadder(p: LadderParams): Promise<LadderResult> {
  const { connection, user, sessionKeypair: session } = p;
  const cuLimit = p.cuLimit ?? DEFAULT_CU_LIMIT;
  const cuPrice = p.cuPrice ?? DEFAULT_CU_PRICE;
  const pollMs = p.pollMs ?? 200;
  const attempts: Attempt[] = [];
  const result: LadderResult = { attempts, sweptLamports: 0n, sessionBalanceAfter: 0n, totalFees: 0n };

  const record = (a: Attempt) => {
    attempts.push(a);
    if (a.fee !== undefined) result.totalFees += a.fee;
    p.onEvent?.({ type: "result", attempt: a, text: attemptText(a) });
  };
  const toAttempt = (kind: AttemptKind, landed: Landed, programIds: PublicKey[]): Attempt => {
    const a: Attempt = {
      kind,
      signature: landed.signature,
      slot: landed.slot,
      fee: landed.fee,
      computeUnits: landed.computeUnits,
      outcome: "ok",
      logs: landed.logs,
    };
    if (!landed.landed) a.outcome = "not-landed";
    else if (landed.err) {
      a.failure = classifyFailure(landed.err, landed.logs, programIds);
      a.outcome = a.failure.kind === "slippage" || a.failure.kind === "order-filled" ? a.failure.kind : "failed";
    }
    return a;
  };

  const order = p.order ?? (await fetchOrder(connection, user));
  if (!order) throw new Error("order account not found");
  if (order.status !== "Open") throw new Error(`order is ${order.status}, not Open`);
  if (!order.sessionKey.equals(session.publicKey)) throw new Error("session key does not match the order");

  let stop = false;
  for (let i = 0; i < order.rungCount && !stop; i++) {
    const dueSlot = rungDueSlot(order, i);
    let slot = BigInt(await connection.getSlot("processed"));
    while (slot < dueSlot) {
      p.onEvent?.({ type: "waiting", rungIndex: i, dueSlot, slot });
      await sleep(pollMs);
      slot = BigInt(await connection.getSlot("processed"));
    }
    if (slot >= order.lastSlot) break; // expired: only a refund is left

    const instructions = [
      computeUnitLimitIx(cuLimit),
      computeUnitPriceIx(cuPrice),
      tryRungIx({
        sessionKey: session.publicKey,
        user,
        mint: p.mint,
        tokenProgram: p.tokenProgram,
        buybackRecipient: p.buybackRecipient,
        rungIndex: i,
      }),
    ];
    const landed = await sendAndConfirm(connection, instructions, session, (signature) =>
      p.onEvent?.({ type: "sent", kind: "try", rungIndex: i, signature }),
    );
    const a = toAttempt("try", landed, instructions.map((x) => x.programId));
    a.rungIndex = i;
    a.rungBps = order.rungsBps[i];
    a.dueSlot = dueSlot;
    if (landed.landed && !landed.err) {
      a.outcome = "filled";
      result.filled = findEvent(landed.logs, "OrderFilled");
      stop = true;
    } else if (a.outcome === "order-filled") {
      stop = true;
    }
    record(a);
  }

  const filled = attempts.some((a) => a.outcome === "filled" || a.outcome === "order-filled");
  if (!filled) {
    const instructions = [
      computeUnitLimitIx(p.refundCuLimit ?? DEFAULT_REFUND_CU_LIMIT),
      computeUnitPriceIx(cuPrice),
      refundIx({ caller: session.publicKey, user }),
    ];
    try {
      const landed = await sendAndConfirm(connection, instructions, session, (signature) =>
        p.onEvent?.({ type: "sent", kind: "refund", signature }),
      );
      const a = toAttempt("refund", landed, instructions.map((x) => x.programId));
      result.refunded = findEvent(landed.logs, "OrderRefunded");
      record(a);
    } catch (e) {
      record({ kind: "refund", signature: "", outcome: "failed", failure: { kind: "other", raw: String(e) } });
    }
  }

  await sweepSessionKey(p, result, record);
  return result;
}

/** Sends the session key's whole balance, less the fee, to the user. */
async function sweepSessionKey(p: LadderParams, result: LadderResult, record: (a: Attempt) => void) {
  const { connection, sessionKeypair: session, user } = p;
  const balance = BigInt(await connection.getBalance(session.publicKey, "confirmed"));
  const build = (lamports: bigint) =>
    SystemProgram.transfer({ fromPubkey: session.publicKey, toPubkey: user, lamports });
  const probe = new Transaction({ feePayer: session.publicKey, ...(await connection.getLatestBlockhash("confirmed")) }).add(
    build(balance),
  );
  const quoted = (await connection.getFeeForMessage(probe.compileMessage(), "confirmed")).value;
  const fee = quoted !== null ? BigInt(quoted) : sweepFeeLamports();
  if (balance <= fee) {
    result.sessionBalanceAfter = balance;
    return;
  }
  try {
    const landed = await sendAndConfirm(connection, [build(balance - fee)], session, (signature) =>
      p.onEvent?.({ type: "sent", kind: "sweep", signature }),
    );
    const a: Attempt = {
      kind: "sweep",
      signature: landed.signature,
      slot: landed.slot,
      fee: landed.fee,
      computeUnits: landed.computeUnits,
      outcome: "ok",
    };
    if (!landed.landed) a.outcome = "not-landed";
    else if (landed.err) {
      a.outcome = "failed";
      a.failure = classifyFailure(landed.err, landed.logs, [SystemProgram.programId]);
    } else result.sweptLamports = balance - fee;
    record(a);
  } catch (e) {
    record({ kind: "sweep", signature: "", outcome: "failed", failure: { kind: "other", raw: String(e) } });
  }
  result.sessionBalanceAfter = BigInt(await connection.getBalance(session.publicKey, "confirmed"));
}
