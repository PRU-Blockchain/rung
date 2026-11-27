// Selling a pump.fun token from the wallet: one transaction, signed by the
// wallet, sent by the app. Rung's program has no part in it: this is the plain
// sell of the venue (pump's curve or a PumpSwap pool), the same one the
// command-line script has used on mainnet since Nov 24, 2026
// (scripts/ladder.ts, --sell-all). The whole balance is sold; the emptied
// token account is closed so its rent comes back.
//
// The sale climbs like a buy: one sale per rung, each with a minimum taken
// from a simulation of the same sale made just before, less that rung's
// percent. One wallet approval signs them all; the tightest is sent first and
// the next only if it missed (sendSellLadder).

import {
  PublicKey,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TransactionMessage,
  VersionedTransaction,
  WSOL_MINT,
  ammUserVolumeAccumulatorPda,
  associatedTokenAddress,
  base64Decode,
  closeTokenAccountIx,
  computeUnitLimitIx,
  createAtaIdempotentIx,
  pumpCloseVolumeAccumulatorIx,
  pumpSellV3Ix,
  pumpSwapCloseVolumeAccumulatorIx,
  pumpSwapSellV2Ix,
  tokenAccountAmount,
  userVolumeAccumulatorPda,
  wsolAta,
} from "../../../client/src";

import { CLUSTER } from "../config";
import { SaleRungState, SaleTry, SaleUnconfirmed, climbSale, sellMinimums } from "../screens/sellLadder";
import { Holding, holdingsFrom, showsInTokens } from "../screens/sellRules";
import { walletProblemText } from "../sendFailure";
import { sendSigned, waitConfirmed } from "./buy";
import { connection } from "./connection";
import { Market, loadMarket } from "./market";

type Ix = ReturnType<typeof computeUnitLimitIx>;

/** A sale that did not happen, worded for the screen. */
export class SellError extends Error {}

const SELL_CU_LIMIT = 250_000;

/** The wallet's pump.fun tokens with a balance (see showsInTokens for which ones are listed). */
export async function loadHoldings(user: PublicKey): Promise<Holding[]> {
  const [classic, t22] = await Promise.all(
    [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((programId) => connection.getTokenAccountsByOwner(user, { programId }, "confirmed")),
  );
  const wsol = WSOL_MINT.toBase58();
  return holdingsFrom([...classic.value, ...t22.value].map((a) => a.account.data)).filter(
    (h) => h.mint !== wsol && showsInTokens(h.mint, CLUSTER),
  );
}

export interface SellQuote {
  market: Market;
  /** The wallet's whole balance of the token, in base units. */
  tokens: bigint;
  /** What the sale pays right now, from a simulation of the same sale. */
  simulated: bigint;
  /** Rent of the token account, which is closed after the sale: comes back on top. */
  accountRent: bigint;
  /** The sale's instructions for a given minimum. */
  instructions: (minOut: bigint) => Ix[];
}

async function simulate(user: PublicKey, instructions: Ix[], watch: PublicKey) {
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const probe = new VersionedTransaction(new TransactionMessage({ payerKey: user, recentBlockhash: blockhash, instructions }).compileToV0Message());
  const sim = (
    await connection.simulateTransaction(probe, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
      accounts: { encoding: "base64", addresses: [watch.toBase58()] },
    })
  ).value;
  if (sim.err) {
    console.log(`RUNG sell simulation failed: ${JSON.stringify(sim.err)}`);
    throw new SellError("This sale does not go through right now. Nothing was sent.");
  }
  const post = sim.accounts?.[0];
  if (!post) throw new SellError("The sale could not be priced right now. Nothing was sent.");
  return post;
}

/** Prices the sale of the wallet's whole balance of `mint`; sends nothing. */
export async function quoteSell(user: PublicKey, mint: PublicKey): Promise<SellQuote> {
  const m = await loadMarket(mint);
  const ata = associatedTokenAddress(user, mint, m.tokenProgram);

  if (m.venue === "Curve") {
    const accumulator = userVolumeAccumulatorPda(user);
    const [ataInfo, accBefore, walletInfo] = await connection.getMultipleAccountsInfo([ata, accumulator, user], "confirmed");
    const tokens = ataInfo ? tokenAccountAmount(ataInfo.data) : 0n;
    if (tokens === 0n || !walletInfo) throw new SellError("This wallet holds none of this token.");
    const sell = (minOut: bigint) =>
      pumpSellV3Ix({ seller: user, mint, tokenProgram: m.tokenProgram, buybackRecipient: m.buybackRecipient, tokensIn: tokens, minLamportsOut: minOut });
    // pump opens a volume account for a seller that has none; close it again so its rent comes back.
    const closeVolume = accBefore ? [] : [pumpCloseVolumeAccumulatorIx(user)];
    const post = await simulate(user, [computeUnitLimitIx(SELL_CU_LIMIT), sell(1n), ...closeVolume], user);
    // The wallet's change in the simulation; if the simulation charged the fee this is a little low, which only makes the minimum safer.
    const simulated = BigInt(post.lamports) - BigInt(walletInfo.lamports);
    if (simulated <= 0n) throw new SellError("This sale would pay nothing right now. Nothing was sent.");
    return {
      market: m,
      tokens,
      simulated,
      accountRent: BigInt(ataInfo!.lamports),
      instructions: (minOut) => [
        computeUnitLimitIx(SELL_CU_LIMIT),
        sell(minOut),
        closeTokenAccountIx({ account: ata, destination: user, owner: user, tokenProgram: m.tokenProgram }),
        ...closeVolume,
      ],
    };
  }

  const wsol = wsolAta(user);
  const accumulator = ammUserVolumeAccumulatorPda(user);
  const [ataInfo, accBefore, wsolBefore] = await connection.getMultipleAccountsInfo([ata, accumulator, wsol], "confirmed");
  const tokens = ataInfo ? tokenAccountAmount(ataInfo.data) : 0n;
  if (tokens === 0n) throw new SellError("This wallet holds none of this token.");
  const sell = (minOut: bigint) =>
    pumpSwapSellV2Ix({
      seller: user,
      mint,
      tokenProgram: m.tokenProgram,
      pool: m.pool.poolAccounts,
      buybackWsolAccount: m.buybackRecipient,
      tokensIn: tokens,
      minLamportsOut: minOut,
    });
  const openWsol = createAtaIdempotentIx({ payer: user, owner: user, mint: WSOL_MINT, tokenProgram: TOKEN_PROGRAM_ID });
  // PumpSwap opens a volume account for a seller that has none: closed again in the same transaction.
  const closeVolume = accBefore ? [] : [pumpSwapCloseVolumeAccumulatorIx(user)];
  // What the sale pays right now: simulate it and read the wrapped-SOL account (less what it held before, if it existed).
  const post = await simulate(user, [computeUnitLimitIx(SELL_CU_LIMIT), openWsol, sell(1n), ...closeVolume], wsol);
  const held = wsolBefore ? tokenAccountAmount(wsolBefore.data) : 0n;
  const simulated = tokenAccountAmount(base64Decode((post.data as unknown as [string, string])[0])) - held;
  if (simulated <= 0n) throw new SellError("This sale would pay nothing right now. Nothing was sent.");
  return {
    market: m,
    tokens,
    simulated,
    accountRent: BigInt(ataInfo!.lamports),
    instructions: (minOut) => [
      computeUnitLimitIx(SELL_CU_LIMIT),
      openWsol,
      sell(minOut),
      // Unwraps what the pool paid (and any wrapped SOL the wallet already held) into SOL.
      closeTokenAccountIx({ account: wsol, destination: user, owner: user, tokenProgram: TOKEN_PROGRAM_ID }),
      closeTokenAccountIx({ account: ata, destination: user, owner: user, tokenProgram: m.tokenProgram }),
      ...closeVolume,
    ],
  };
}

/** What the wallet hands back for a ladder of sales: every sale signed, or (a wallet that cannot sign without sending) the widest one sent. */
export type LadderSigned = { kind: "signed"; txs: VersionedTransaction[] } | { kind: "sent"; signature: string };

/** Opens the wallet once: authorize `user`, then sign all of these transactions in one approval. */
export type SignTxs = (user: PublicKey, txs: VersionedTransaction[], minContextSlot: number) => Promise<LadderSigned>;

export interface SaleResult {
  /** The rung that sold, or null when every rung missed: nothing was sold and the tokens are still in the wallet. */
  soldRungIndex: number | null;
  signature?: string;
  /** The wallet's change in the sale's transaction (what the sale paid, the rent back, less the fee); null when it could not be read. */
  walletChange: bigint | null;
}

/** A venue refusing a sale (its own program error): the price is below that sale's minimum. */
const isRefusal = (text: string) => /custom program error|InstructionError/i.test(text);

async function landedTx(signature: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }).catch(() => null);
    if (tx?.meta) return tx;
    await new Promise((r) => setTimeout(r, 800));
  }
  return null;
}

/**
 * Sells the Rung way: one wallet approval signs one sale per rung, each with
 * that rung's minimum. The app sends the tightest; the next one only after the
 * one before certainly missed. Every sale sells the whole balance and closes
 * the token account, so at most one of them can ever succeed.
 */
export async function sendSellLadder(
  user: PublicKey,
  q: SellQuote,
  rungsBps: number[],
  signTxs: SignTxs,
  onState: (rungIndex: number, state: SaleRungState) => void,
): Promise<SaleResult> {
  const { context, value } = await connection.getLatestBlockhashAndContext("confirmed");
  const txs = sellMinimums(q.simulated, rungsBps).map(
    (minOut) =>
      new VersionedTransaction(
        new TransactionMessage({ payerKey: user, recentBlockhash: value.blockhash, instructions: q.instructions(minOut) }).compileToV0Message(),
      ),
  );

  let signed: LadderSigned;
  try {
    signed = await signTxs(user, txs, context.slot);
  } catch (e) {
    const text = String((e as Error)?.message ?? e);
    console.log(`RUNG sell: wallet error ${String((e as { code?: unknown })?.code)} ${text}`);
    const worded = walletProblemText((e as { code?: unknown })?.code, text);
    throw new SellError(worded ? worded.replace("the buy", "the sale") : `The wallet returned an error: ${text}`);
  }

  const outcome = async (signature: string): Promise<SaleTry> => {
    // Past its blockhash it can no longer land: a certain miss.
    if (!(await waitConfirmed(signature, value.lastValidBlockHeight))) return { kind: "missed", signature };
    const tx = await landedTx(signature);
    if (!tx) return { kind: "unknown", signature };
    return tx.meta?.err ? { kind: "missed", signature } : { kind: "sold", signature };
  };

  let sold: { rungIndex: number; signature: string } | null;
  try {
    if (signed.kind === "sent") {
      // The wallet sent the widest sale itself: one try, at the cap.
      const last = rungsBps.length - 1;
      for (let i = 0; i < last; i++) onState(i, "not-needed");
      sold = await climbSale(1, () => outcome(signed.signature), (_, state) => onState(last, state)).then((r) => r && { ...r, rungIndex: last });
    } else {
      // A wallet that takes fewer transactions per request signed only the widest: it stands for the last rung.
      const ready = signed.txs;
      const offset = rungsBps.length - ready.length;
      for (let i = 0; i < offset; i++) onState(i, "not-needed");
      const climbed = await climbSale(
        ready.length,
        async (i) => {
          let signature: string;
          try {
            // The RPC simulates before it forwards: a sale the venue would refuse is not sent and costs nothing.
            signature = await sendSigned(ready[i].serialize());
          } catch (e) {
            const text = String((e as Error)?.message ?? e);
            console.log(`RUNG sell rung ${i} not sent: ${text.slice(0, 160)}`);
            if (isRefusal(text)) return { kind: "missed" };
            throw new SellError("The sale could not be sent. Nothing was sold. Try again.");
          }
          console.log(`RUNG sell rung ${i} sent: ${signature}`);
          return outcome(signature);
        },
        (i, state) => onState(i + offset, state),
      );
      sold = climbed && { ...climbed, rungIndex: climbed.rungIndex + offset };
    }
  } catch (e) {
    if (e instanceof SaleUnconfirmed) {
      throw new SellError("The sale was sent but could not be confirmed. Check your wallet before selling again.");
    }
    throw e;
  }
  if (!sold) return { soldRungIndex: null, walletChange: null };
  const tx = await landedTx(sold.signature);
  const walletChange = tx?.meta ? BigInt(tx.meta.postBalances[0]) - BigInt(tx.meta.preBalances[0]) : null;
  return { soldRungIndex: sold.rungIndex, signature: sold.signature, walletChange };
}

export type { Holding };
