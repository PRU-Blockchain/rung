// Adapted from solana-mobile-expo-template (src/utils/useMobileWallet.tsx).
// The skeleton only connects (authorize) and disconnects (deauthorize).
// Transactions go through MWA `signAndSendTransactions` (not the deprecated
// `signTransactions`); the helper is here for the buy screen, unused for now.
import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import {
  Transaction,
  TransactionSignature,
  VersionedTransaction,
} from "@solana/web3.js";
import { useCallback, useMemo } from "react";
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

  const signAndSendTransaction = useCallback(
    async (
      transaction: Transaction | VersionedTransaction,
      minContextSlot: number
    ): Promise<TransactionSignature> =>
      await transact(async (wallet) => {
        await authorizeSession(wallet);
        const signatures = await wallet.signAndSendTransactions({
          transactions: [transaction],
          minContextSlot,
        });
        return signatures[0];
      }),
    [authorizeSession]
  );

  return useMemo(
    () => ({ connect, disconnect, signAndSendTransaction }),
    [connect, disconnect, signAndSendTransaction]
  );
}
