// Adapted from solana-mobile-expo-template (src/utils/useMobileWallet.tsx).
// Connect (authorize), disconnect (deauthorize), and the buy's single wallet
// session: authorize with the cached token, read the capabilities, then sign.
import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { useCallback, useMemo } from "react";

import type { SignOpen, WalletResult } from "../flow/buy";
import { LIFETIME_WHEN_APP_SENDS, LIFETIME_WHEN_WALLET_SENDS } from "../flow/buy";
import { Account, useAuthorization } from "./useAuthorization";

export function useMobileWallet() {
  const { authorizeSession, deauthorizeSession, clearAuthorization } =
    useAuthorization();

  const connect = useCallback(
    async (): Promise<Account> =>
      await transact((wallet) => authorizeSession(wallet)),
    [authorizeSession]
  );

  const disconnect = useCallback(async (): Promise<void> => {
    try {
      await transact((wallet) => deauthorizeSession(wallet));
    } finally {
      // Forget the local authorization even if the wallet could not be reached.
      await clearAuthorization();
    }
  }, [deauthorizeSession, clearAuthorization]);

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

  return useMemo(() => ({ connect, disconnect, signOpen }), [connect, disconnect, signOpen]);
}
