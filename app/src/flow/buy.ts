// Opening an order: one transaction, one wallet approval.
//
// The wallet only signs (MWA `signTransactions`) and the app sends the signed
// transaction itself once it is back in front. This deliberately departs from
// the plan's `signAndSendTransactions`: with real wallets on devnet, Phantom's
// own send never reached the cluster, and Solflare kept Rung in the
// background (its JS paused) until its success screen was closed, so orders
// expired untried. Sending ourselves puts `start_slot` in the app's hands.
// If a wallet cannot sign without sending, we fall back to
// `signAndSendTransactions` with the longest lifetime the program allows.

import {
  COMPUTE_BUDGET_PROGRAM_ID,
  Keypair,
  MAX_LIFETIME_SLOTS,
  Order,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  ammUserVolumeAccumulatorPda,
  associatedTokenAddress,
  cancelIx,
  classifyFailure,
  decodeOrder,
  describeFailure,
  fetchOrder,
  openOrderIx,
  orderPda,
  userVolumeAccumulatorPda,
  vaultPda,
} from "../../../client/src";

import { AppState } from "react-native";

import { connection } from "./connection";
import { LIFETIME_SLOTS, Plan, WINDOW_SLOTS } from "./plan";
import { PendingOrder, endSession, saveSessionKey, savePending } from "./session";

/** What the wallet hands back: the signed transaction, or (fallback) the signature it sent. */
export type WalletResult =
  | { kind: "signed"; tx: VersionedTransaction }
  | { kind: "sent"; signature: string };

/**
 * Opens the wallet once: authorize `user`, then sign (or sign and send) the
 * transaction `build(lifetimeSlots)` returns.
 */
export type SignOpen = (
  user: PublicKey,
  build: (lifetimeSlots: bigint) => VersionedTransaction,
  minContextSlot: number,
) => Promise<WalletResult>;

export interface Opened {
  pending: PendingOrder;
  session: Keypair;
  order: Order;
}

/** A buy that did not open, worded for the screen. */
export class BuyError extends Error {}

export const TOO_SLOW = "Approval took too long. Nothing was sent. Try again.";

function walletErrorText(e: unknown): string {
  const code = (e as { code?: unknown })?.code;
  const text = String((e as Error)?.message ?? e);
  if (code === -3 || /declin|not signed|reject/i.test(text)) return "The wallet did not approve the buy. Nothing was sent.";
  if (/CancellationException|cancel/i.test(text)) return "The wallet closed before approving. Nothing was sent.";
  if (/WRONG_ACCOUNT/.test(text)) return "The wallet approved with a different account. Nothing was sent.";
  return `The wallet returned an error: ${text}`;
}

const COMPUTE_BUDGET = COMPUTE_BUDGET_PROGRAM_ID.toBase58();

/** What the wallet put into the transaction it signed, for the test notes. */
function describeSigned(tx: VersionedTransaction, builtCount: number): string {
  const keys = tx.message.staticAccountKeys;
  const parts = tx.message.compiledInstructions.map((ix) => {
    const program = keys[ix.programIdIndex].toBase58();
    const data = Buffer.from(ix.data);
    if (program === COMPUTE_BUDGET && data[0] === 2) return `SetComputeUnitLimit(${data.readUInt32LE(1)})`;
    if (program === COMPUTE_BUDGET && data[0] === 3) return `SetComputeUnitPrice(${data.readBigUInt64LE(1)} µlamports)`;
    return program;
  });
  return `built ${builtCount} instruction(s); wallet signed ${parts.length}: ${parts.join(", ")}; version ${tx.version}; blockhash ${tx.message.recentBlockhash}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Resolves once Rung is in front again (requests from the background failed). */
export function inForeground(): Promise<void> {
  if (AppState.currentState === "active") return Promise.resolve();
  return new Promise((resolve) => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        sub.remove();
        resolve();
      }
    });
  });
}

/**
 * Sends the signed bytes, retrying while the network is not back yet right
 * after the wallet hands over ("Network request failed" was seen there).
 */
async function sendSigned(bytes: Uint8Array): Promise<string> {
  await inForeground();
  for (let attempt = 1; ; attempt++) {
    try {
      return await connection.sendRawTransaction(bytes, { maxRetries: 5 });
    } catch (e) {
      const text = String((e as Error)?.message ?? e);
      if (!/Network request failed/i.test(text) || attempt >= 10) throw e;
      console.log(`RUNG send attempt ${attempt}: ${text}; retrying`);
      await sleep(1000);
    }
  }
}

/** Polls until the signature is confirmed; false once the blockhash can no longer land. */
async function waitConfirmed(signature: string, lastValidBlockHeight: number): Promise<boolean> {
  for (;;) {
    const st = await connection
      .getSignatureStatuses([signature], { searchTransactionHistory: true })
      .then((r) => r.value[0])
      .catch(() => null);
    if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return true;
    const height = await connection.getBlockHeight("confirmed").catch(() => 0);
    if (height > lastValidBlockHeight) return false;
    await sleep(1000);
  }
}

export async function openBuy(plan: Plan, user: PublicKey, signOpen: SignOpen): Promise<Opened> {
  const { market } = plan;
  const vault = vaultPda(user);
  const pool = market.venue === "PumpSwap" ? market.pool.poolAccounts : undefined;
  const [orderInfo, ataInfo, accInfo] = await connection.getMultipleAccountsInfo([
    orderPda(user),
    associatedTokenAddress(user, market.mint, market.tokenProgram),
    market.venue === "PumpSwap" ? ammUserVolumeAccumulatorPda(vault) : userVolumeAccumulatorPda(vault),
  ]);
  const earlier = orderInfo ? decodeOrder(orderInfo.data) : null;

  // The session key exists before anything is signed, so a crash after
  // sending can still be finished (or refunded) on the next start.
  const session = Keypair.generate();
  await saveSessionKey(session);
  const pending: PendingOrder = {
    user: user.toBase58(),
    mint: market.mint.toBase58(),
    venue: market.venue,
    pool: pool && {
      address: pool.address.toBase58(),
      baseTokenAccount: pool.baseTokenAccount.toBase58(),
      quoteTokenAccount: pool.quoteTokenAccount.toBase58(),
    },
    tokenProgram: market.tokenProgram.toBase58(),
    buybackRecipient: market.buybackRecipient.toBase58(),
    decimals: market.decimals,
    mode: plan.mode,
    rungsBps: plan.rungs,
    amount: plan.amount.toString(),
    expectedTokensSeen: plan.quote.expectedTokensSeen.toString(),
    rawTokensSeen: plan.quote.rawTokensSeen.toString(),
    existed: { order: !!orderInfo, userTokenAccount: !!ataInfo, accumulator: !!accInfo },
    earlierOrderLamports: String(orderInfo?.lamports ?? 0),
    createdAt: Date.now(),
  };
  await savePending(pending);

  // A fresh "confirmed" blockhash: a "finalized" one made Solflare warn
  // "this transaction is for mainnet".
  const { context, value } = await connection.getLatestBlockhashAndContext("confirmed");
  let builtCount = 0;
  const build = (lifetimeSlots: bigint) => {
    const instructions = [
      // An order left open (one per wallet) is closed in the same transaction.
      ...(earlier?.status === "Open" ? [cancelIx({ user })] : []),
      openOrderIx({
        user,
        sessionKey: session.publicKey,
        mint: market.mint,
        pool,
        args: {
          venue: market.venue,
          rungsBps: plan.rungs,
          amount: plan.amount,
          rentReserve: plan.reserve.total,
          feeBudget: plan.budget.total,
          expectedTokensSeen: plan.quote.expectedTokensSeen,
          rawTokensSeen: plan.quote.rawTokensSeen,
          windowSlots: WINDOW_SLOTS,
          lifetimeSlots,
        },
      }),
    ];
    builtCount = instructions.length;
    // v0 so the wallet's signed bytes come back as a VersionedTransaction and
    // are sent exactly as signed.
    const message = new TransactionMessage({ payerKey: user, recentBlockhash: value.blockhash, instructions }).compileToV0Message();
    return new VersionedTransaction(message);
  };

  let result: WalletResult;
  try {
    result = await signOpen(user, build, context.slot);
  } catch (e) {
    console.log(`RUNG wallet error: code ${String((e as { code?: unknown })?.code)} ${String((e as Error)?.message ?? e)}`);
    await endSession();
    throw new BuyError(walletErrorText(e));
  }

  let signature: string;
  if (result.kind === "signed") {
    const signed = result.tx;
    console.log(`RUNG signed by wallet: ${describeSigned(signed, builtCount)}`);
    try {
      // Exactly the bytes the wallet signed; nothing rebuilt or re-signed.
      signature = await sendSigned(signed.serialize());
    } catch (e) {
      const text = String((e as Error)?.message ?? e);
      console.log(`RUNG send failed: ${text}`);
      await endSession();
      if (/blockhash not found|expired/i.test(text)) throw new BuyError(TOO_SLOW);
      throw new BuyError(`The buy could not be sent: ${text}`);
    }
  } else {
    signature = result.signature;
  }
  pending.openSignature = signature;
  await savePending(pending);
  console.log(`RUNG open sent: ${signature} (${result.kind === "signed" ? "by the app" : "by the wallet"})`);

  const landed = await waitConfirmed(signature, value.lastValidBlockHeight);
  if (!landed) {
    await endSession();
    throw new BuyError(TOO_SLOW);
  }
  const got = await connection
    .getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
    .catch(() => null);
  if (got?.meta?.err) {
    await endSession();
    const failure = classifyFailure(got.meta.err, got.meta.logMessages ?? []);
    throw new BuyError(`The buy did not open: ${describeFailure(failure)}. Nothing was bought.`);
  }
  if (got) console.log(`RUNG open on chain: fee ${got.meta?.fee}, version ${got.version}`);

  const order = await fetchOrder(connection, user);
  if (!order || order.status !== "Open" || !order.sessionKey.equals(session.publicKey)) {
    throw new BuyError("The order is not open on chain.");
  }
  return { pending, session, order };
}

/** Lifetimes: ours when the app sends, the program's maximum when the wallet does. */
export const LIFETIME_WHEN_APP_SENDS = LIFETIME_SLOTS;
export const LIFETIME_WHEN_WALLET_SENDS = MAX_LIFETIME_SLOTS;
