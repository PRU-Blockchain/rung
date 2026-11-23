// Opening an order: one transaction, one wallet approval (MWA signAndSendTransactions).

import {
  Keypair,
  Order,
  PublicKey,
  Transaction,
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

import { connection } from "./connection";
import { LIFETIME_SLOTS, Plan, WINDOW_SLOTS } from "./plan";
import { PendingOrder, endSession, saveSessionKey, savePending } from "./session";

/** Signs and sends one transaction through the wallet; resolves to its signature. */
export type SignAndSend = (tx: Transaction, minContextSlot: number) => Promise<string>;

export interface Opened {
  pending: PendingOrder;
  session: Keypair;
  order: Order;
}

/** A buy that did not open, worded for the screen. */
export class BuyError extends Error {}

function walletErrorText(e: unknown): string {
  const code = (e as { code?: unknown })?.code;
  const text = String((e as Error)?.message ?? e);
  if (code === -3 || /declin|not signed|reject/i.test(text)) return "The wallet did not approve the buy. Nothing was sent.";
  if (/CancellationException|cancel/i.test(text)) return "The wallet closed before approving. Nothing was sent.";
  if (code === -2 || code === -4) return "The wallet could not send the buy. Nothing was bought.";
  return `The wallet returned an error: ${text}`;
}

/** Our order, open on chain with this session key? */
async function ourOrderIsOpen(user: PublicKey, session: Keypair): Promise<Order | null> {
  const info = await connection.getAccountInfo(orderPda(user), "confirmed");
  if (!info) return null;
  const o = decodeOrder(info.data);
  return o.status === "Open" && o.sessionKey.equals(session.publicKey) ? o : null;
}

export async function openBuy(plan: Plan, user: PublicKey, signAndSend: SignAndSend): Promise<Opened> {
  const { market } = plan;
  const vault = vaultPda(user);
  const [orderInfo, ataInfo, accInfo] = await connection.getMultipleAccountsInfo([
    orderPda(user),
    associatedTokenAddress(user, market.mint, market.tokenProgram),
    userVolumeAccumulatorPda(vault),
  ]);
  const earlier = orderInfo ? decodeOrder(orderInfo.data) : null;

  // The session key exists before anything is signed, so a crash after the
  // wallet sends can still be finished (or refunded) on the next start.
  const session = Keypair.generate();
  await saveSessionKey(session);
  const pending: PendingOrder = {
    user: user.toBase58(),
    mint: market.mint.toBase58(),
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

  const instructions = [
    // An order left open (one per wallet) is closed in the same transaction.
    ...(earlier?.status === "Open" ? [cancelIx({ user })] : []),
    openOrderIx({
      user,
      sessionKey: session.publicKey,
      mint: market.mint,
      args: {
        venue: "Curve",
        rungsBps: plan.rungs,
        amount: plan.amount,
        rentReserve: plan.reserve.total,
        feeBudget: plan.budget.total,
        expectedTokensSeen: plan.quote.expectedTokensSeen,
        rawTokensSeen: plan.quote.rawTokensSeen,
        windowSlots: WINDOW_SLOTS,
        lifetimeSlots: LIFETIME_SLOTS,
      },
    }),
  ];
  const { context, value } = await connection.getLatestBlockhashAndContext("confirmed");
  const tx = new Transaction({ feePayer: user, blockhash: value.blockhash, lastValidBlockHeight: value.lastValidBlockHeight }).add(
    ...instructions,
  );

  let signature: string;
  try {
    signature = await signAndSend(tx, context.slot);
  } catch (e) {
    // The wallet may have sent it before failing to answer: trust the chain.
    const order = await ourOrderIsOpen(user, session).catch(() => null);
    if (order) return { pending, session, order };
    await endSession();
    throw new BuyError(walletErrorText(e));
  }
  pending.openSignature = signature;
  await savePending(pending);

  try {
    await connection.confirmTransaction({ signature, ...value }, "confirmed");
  } catch {
    // Expired or slow: the order account below decides.
  }
  const got = await connection
    .getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
    .catch(() => null);
  if (got?.meta?.err) {
    await endSession();
    const failure = classifyFailure(got.meta.err, got.meta.logMessages ?? [], instructions.map((i) => i.programId));
    throw new BuyError(`The buy did not open: ${describeFailure(failure)}. Nothing was bought.`);
  }
  if (got) {
    // What the wallet actually sent, for the test notes (no secrets here).
    const keys = got.transaction.message.getAccountKeys();
    const programs = got.transaction.message.compiledInstructions.map((c) => keys.get(c.programIdIndex)?.toBase58());
    console.log(
      `RUNG open check: built ${instructions.length} instruction(s), on chain ${programs.length}: ${programs.join(", ")}; fee ${got.meta?.fee}`,
    );
  }

  const order = await fetchOrder(connection, user);
  if (!order || order.status !== "Open" || !order.sessionKey.equals(session.publicKey)) {
    if (!got) {
      await endSession();
      throw new BuyError("The buy did not reach the network in time. Nothing was bought.");
    }
    throw new BuyError("The order is not open on chain.");
  }
  return { pending, session, order };
}
