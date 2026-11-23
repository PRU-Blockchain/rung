// Running an open order to its end, building the receipt, and resuming after a restart.

import {
  Keypair,
  LadderEvent,
  LadderResult,
  Order,
  PublicKey,
  SystemProgram,
  associatedTokenAddress,
  DEFAULT_CU_PRICE,
  DEFAULT_REFUND_CU_LIMIT,
  bondingCurvePda,
  computeUnitLimitIx,
  computeUnitPriceIx,
  decodeBondingCurve,
  refundIx,
  decodeOrder,
  orderPda,
  rawQuote,
  runLadder,
  sendAndConfirm,
  txFeeLamports,
  userVolumeAccumulatorPda,
  vaultPda,
} from "../../../client/src";

import { connection } from "./connection";
import { bpsText } from "./format";
import { Receipt, addReceipt } from "./history";
import { PendingOrder, clearPending, deleteSessionKey, endSession, loadPending, loadSessionKey, savePending } from "./session";

export interface Running {
  pending: PendingOrder;
  session: Keypair;
  order?: Order;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** `paid / seen - 1` in percent, from the order's numbers. */
export function paidAboveSeenPct(amount: bigint, tokensSeen: bigint, spent: bigint, bought: bigint): number {
  const ppm = (spent * tokensSeen * 1_000_000n) / (amount * bought) - 1_000_000n;
  return Number(ppm) / 10_000;
}

function attemptLabel(kind: string, rungBps?: number): string {
  if (kind === "try") return `try ${bpsText(rungBps ?? 0)}`;
  if (kind === "refund") return "refund";
  return "unused fees back";
}

/** RPC and program errors only; the session key never appears in them. */
function errorText(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** Our order as it stands on chain, or null when the account is gone (refunded). */
async function readOrder(user: PublicKey): Promise<Order | null> {
  const info = await connection.getAccountInfo(orderPda(user), "confirmed");
  return info ? decodeOrder(info.data) : null;
}

/** Sends what is left on the session key back to the user; returns the transfer signature, if any. */
async function sweep(session: Keypair, user: PublicKey): Promise<{ signature: string; fee?: bigint } | null> {
  const balance = BigInt(await connection.getBalance(session.publicKey, "confirmed"));
  const fee = txFeeLamports();
  if (balance <= fee) return null;
  const landed = await sendAndConfirm(
    connection,
    [SystemProgram.transfer({ fromPubkey: session.publicKey, toPubkey: user, lamports: balance - fee })],
    session,
  );
  return { signature: landed.signature, fee: landed.fee };
}

/**
 * Runs the ladder once. If it breaks off (the public RPC refuses requests now
 * and then) or a restart finds tries already sent, an order still open is
 * refunded by the session key; the outcome is then read from the chain.
 * Every transaction is written to the pending notes as it lands, so the
 * receipt lists all of them even across restarts.
 */
export async function runOrder(run: Running, onEvent: (e: LadderEvent) => void): Promise<Receipt> {
  const p = run.pending;
  const user = new PublicKey(p.user);
  const mint = new PublicKey(p.mint);
  const tokenProgram = new PublicKey(p.tokenProgram);
  const note = (label: string, signature: string, fee: bigint | undefined, outcome: string) => {
    p.attempts = [...(p.attempts ?? []), { label, signature, fee: fee?.toString(), outcome }];
    savePending(p).catch(() => undefined);
  };
  const persist = (e: LadderEvent) => {
    if (e.type === "result" && e.attempt.signature) {
      note(attemptLabel(e.attempt.kind, e.attempt.rungBps), e.attempt.signature, e.attempt.fee, e.attempt.outcome);
    }
    onEvent(e);
  };

  // The ladder runs once. runLadder always starts at the first rung, so it is
  // not run again after a break-off or a restart that already sent tries:
  // repeating a rung would spend the fee budget the refund needs.
  let result: LadderResult | null = null;
  const triedBefore = (p.attempts ?? []).some((a) => a.label.startsWith("try"));
  if (!triedBefore) {
    try {
      result = await runLadder({
        connection,
        user,
        mint,
        tokenProgram,
        buybackRecipient: new PublicKey(p.buybackRecipient),
        sessionKeypair: run.session,
        order: run.order,
        pollMs: 500,
        onEvent: persist,
      });
    } catch (e) {
      console.log(`RUNG ladder broke off: ${errorText(e)}`);
    }
  }
  if (!result) {
    // Still open? The session key may refund at any time: end it now.
    for (let attempt = 1; attempt <= 4; attempt++) {
      const now = await readOrder(user).catch(() => undefined);
      if (now === undefined) {
        await sleep(1500 * attempt);
        continue;
      }
      if (!now || now.status !== "Open" || !now.sessionKey.equals(run.session.publicKey)) break;
      try {
        const ixs = [computeUnitLimitIx(DEFAULT_REFUND_CU_LIMIT), computeUnitPriceIx(DEFAULT_CU_PRICE), refundIx({ caller: run.session.publicKey, user })];
        const landed = await sendAndConfirm(connection, ixs, run.session, (signature) => onEvent({ type: "sent", kind: "refund", signature }));
        note("refund", landed.signature, landed.fee, landed.landed ? (landed.err ? "failed" : "ok") : "not-landed");
      } catch (e) {
        console.log(`RUNG refund attempt ${attempt} failed: ${errorText(e)}`);
        await sleep(1500 * attempt);
      }
    }
  }

  // Filled or not: from the run, or from the chain when the run broke off.
  const orderNow = await readOrder(user).catch(() => null);
  const ours = orderNow && orderNow.sessionKey.equals(run.session.publicKey) ? orderNow : null;
  let filled: { rungIndex: number; rungBps: number; tokensBought: bigint; lamportsSpent: bigint } | undefined = result?.filled;
  if (!result && ours?.status === "Filled") {
    filled = {
      rungIndex: ours.filledRung,
      rungBps: ours.rungsBps[ours.filledRung],
      tokensBought: ours.tokensBought,
      lamportsSpent: ours.lamportsSpent,
    };
  }
  const refunded = result ? !!result.refunded : !orderNow;

  // The session key must end empty; runLadder sweeps, but not when it broke off.
  if (!result || result.sessionBalanceAfter > txFeeLamports()) {
    const swept = await sweep(run.session, user).catch(() => null);
    if (swept) note("unused fees back", swept.signature, swept.fee, "ok");
  }

  const vault = vaultPda(user);
  const [after, curveInfo, opened] = await Promise.all([
    connection.getMultipleAccountsInfo([
      orderPda(user),
      associatedTokenAddress(user, mint, tokenProgram),
      userVolumeAccumulatorPda(vault),
    ]),
    connection.getAccountInfo(bondingCurvePda(mint), "confirmed"),
    p.openSignature
      ? connection.getTransaction(p.openSignature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }).catch(() => null)
      : Promise.resolve(null),
  ]);

  const amount = BigInt(p.amount);
  let priceNowAbovePct: number | undefined;
  if (!filled && curveInfo) {
    const curve = decodeBondingCurve(curveInfo.data);
    // A curve that completed meanwhile has no tokens left to quote.
    const rawNow = curve.complete ? 0n : rawQuote(amount, curve);
    if (rawNow > 0n) priceNowAbovePct = Number((BigInt(p.rawTokensSeen) * 1_000_000n) / rawNow - 1_000_000n) / 10_000;
  }
  const attempts = p.attempts ?? [];
  const approvalFee = opened?.meta ? String(opened.meta.fee) : undefined;

  const receipt: Receipt = {
    id: `${Date.now()}-${p.openSignature ?? "resumed"}`,
    time: Date.now(),
    mint: p.mint,
    decimals: p.decimals,
    mode: p.mode,
    rungsBps: p.rungsBps,
    amount: p.amount,
    outcome: filled ? "filled" : refunded ? "not-bought" : "unclear",
    expectedTokensSeen: p.expectedTokensSeen,
    filledRungIndex: filled?.rungIndex,
    filledRungBps: filled?.rungBps,
    tokensBought: filled?.tokensBought.toString(),
    lamportsSpent: filled?.lamportsSpent.toString(),
    priceNowAbovePct,
    rungFees: attempts.reduce((sum, a) => sum + BigInt(a.fee ?? "0"), 0n).toString(),
    approvalFee,
    userTokenAccountDeposit: String(!p.existed.userTokenAccount && after[1] ? after[1].lamports : 0),
    accumulatorDeposit: String(!p.existed.accumulator && after[2] ? after[2].lamports : 0),
    orderDeposit: String(after[0] ? after[0].lamports : 0),
    transactions: [
      ...(p.openSignature ? [{ label: "approval", signature: p.openSignature, fee: approvalFee, outcome: "ok" }] : []),
      ...attempts,
    ],
  };
  await addReceipt(receipt);

  // The order is closed (filled or refunded): forget the key. A key that
  // still holds lamports here cannot pay a fee without dropping below the
  // rent-exempt minimum (the sweep failed twice), so keeping it would not help.
  const left = await connection.getBalance(run.session.publicKey, "confirmed").catch(() => 0);
  if (left > 0) console.log(`RUNG session key left with ${left} lamports`);
  await endSession();
  return receipt;
}

/**
 * On app start: an order left by a previous run? If it is still open with our
 * key, hand it back to the ladder (which tries what is due and refunds after
 * expiry). If it already ended, return what the key holds and forget it.
 */
export async function findUnfinished(): Promise<Running | null> {
  const session = await loadSessionKey();
  const pending = await loadPending();
  if (!session) {
    if (pending) await clearPending();
    return null;
  }
  if (!pending) {
    // The key was saved but the order was never sent.
    await deleteSessionKey();
    return null;
  }
  const user = new PublicKey(pending.user);
  const order = await readOrder(user);
  const ours = order && order.sessionKey.equals(session.publicKey) ? order : null;
  if (ours?.status === "Open") return { pending, session, order: ours };
  if (pending.openSignature) {
    // It ended while the app was away: the ladder screen reads the result
    // from the chain, returns the session key's lamports and writes the receipt.
    return { pending, session, order: ours ?? undefined };
  }
  // Never opened: return whatever the key holds and forget it.
  await sweep(session, user);
  await endSession();
  return null;
}
