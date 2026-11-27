// Adapted from solana-mobile-expo-template (src/utils/useMobileWallet.tsx).
// Connect (authorize), disconnect (deauthorize), and the buy's single wallet
// session: authorize with the cached token, read the capabilities, then sign.
import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { useCallback, useMemo } from "react";

import type { SignOpen, WalletResult } from "../flow/buy";
import { LIFETIME_WHEN_APP_SENDS, LIFETIME_WHEN_WALLET_SENDS } from "../flow/buy";
import type { LadderSigned, SignTxs } from "../flow/sell";
import { Account, useAuthorization } from "./useAuthorization";

export function useMobileWallet() {
  const { authorizeSession, clearAuthorization } = useAuthorization();

  const connect = useCallback(
    async (): Promise<Account> =>
      await transact((wallet) => authorizeSession(wallet)),
    [authorizeSession]
  );

  // Disconnect forgets the wallet here, at once, without opening it. It used to open the wallet to withdraw the
  // authorization first: Android then asked which wallet app to open, a wrong pick left the buyer inside that
  // wallet, and until the wallet answered Rung stayed connected (seen on the emulator, Nov 27). The wallet's own
  // record of the authorization stays until it expires or is removed there; it gives Rung nothing by itself.
  const disconnect = useCallback(async (): Promise<void> => {
    await clearAuthorization();
  }, [clearAuthorization]);

  /**
   * One wallet window for a buy: authorize (silent with a valid cached token)
   * and sign in the same session. The app sends the signed transaction itself
   * (see flow/buy.ts for why); only a wallet that cannot sign without sending
   * gets `signAndSendTransactions`.
   */
  const signOpen: SignOpen = useCallback(
    async (user: PublicKey, build: (lifetime: bigint) => VersionedTransaction, minContextSlot: number) =>
      await transact(async (wallet): Promise<WalletResult> => {
        const account = await authorizeSession(wallet);
        if (!account.publicKey.equals(user)) throw new Error("WRONG_ACCOUNT");
        let caps: Record<string, unknown> | null = null;
        try {
          caps = (await wallet.getCapabilities()) as unknown as Record<string, unknown>;
        } catch (e) {
          console.log(`RUNG getCapabilities failed: ${(e as Error)?.message ?? e}`);
        }
        console.log(`RUNG wallet capabilities: ${JSON.stringify(caps)}`);
        const features = Array.isArray(caps?.features) ? (caps!.features as string[]) : [];
        const canSignOnly =
          caps == null ||
          caps.supports_sign_transactions === true ||
          features.includes("solana:signTransactions") ||
          // MWA 1.x wallets report no feature list; signTransactions is mandatory there.
          (caps.features === undefined && caps.supports_sign_transactions === undefined);
        if (canSignOnly) {
          const [signed] = await wallet.signTransactions({ transactions: [build(LIFETIME_WHEN_APP_SENDS)] });
          return { kind: "signed", tx: signed as VersionedTransaction };
        }
        const [signature] = await wallet.signAndSendTransactions({
          transactions: [build(LIFETIME_WHEN_WALLET_SENDS)],
          minContextSlot,
        });
        return { kind: "sent", signature };
      }),
    [authorizeSession]
  );

  /**
   * One wallet window for a ladder of sales: authorize, then sign every transaction in the same approval. The app
   * sends them one at a time. A wallet that cannot sign without sending, or that takes fewer transactions per
   * request, gets only the last one (the widest) and sends it itself.
   */
  const signTxs: SignTxs = useCallback(
    async (user: PublicKey, txs: VersionedTransaction[], minContextSlot: number) =>
      await transact(async (wallet): Promise<LadderSigned> => {
        const account = await authorizeSession(wallet);
        if (!account.publicKey.equals(user)) throw new Error("WRONG_ACCOUNT");
        let caps: Record<string, unknown> | null = null;
        try {
          caps = (await wallet.getCapabilities()) as unknown as Record<string, unknown>;
        } catch {
          // an older wallet: signTransactions is mandatory there
        }
        const features = Array.isArray(caps?.features) ? (caps!.features as string[]) : [];
        const canSignOnly =
          caps == null ||
          caps.supports_sign_transactions === true ||
          features.includes("solana:signTransactions") ||
          (caps.features === undefined && caps.supports_sign_transactions === undefined);
        const perRequest = typeof caps?.max_transactions_per_request === "number" ? caps.max_transactions_per_request : txs.length;
        if (canSignOnly) {
          const batch = perRequest >= txs.length ? txs : [txs[txs.length - 1]];
          const signed = await wallet.signTransactions({ transactions: batch });
          return { kind: "signed", txs: signed as VersionedTransaction[] };
        }
        const [signature] = await wallet.signAndSendTransactions({ transactions: [txs[txs.length - 1]], minContextSlot });
        return { kind: "sent", signature };
      }),
    [authorizeSession]
  );

  return useMemo(() => ({ connect, disconnect, signOpen, signTxs }), [connect, disconnect, signOpen, signTxs]);
}
