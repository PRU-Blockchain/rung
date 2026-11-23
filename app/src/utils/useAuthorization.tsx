// Adapted from solana-mobile-expo-template (src/utils/useAuthorization.tsx):
// caches the MWA authorization (auth token + accounts) in AsyncStorage.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { PublicKey, PublicKeyInitData } from "@solana/web3.js";
import {
  Account as AuthorizedAccount,
  AuthorizationResult,
  AuthorizeAPI,
  AuthToken,
  Base64EncodedAddress,
  DeauthorizeAPI,
} from "@solana-mobile/mobile-wallet-adapter-protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { APP_IDENTITY, CHAIN_IDENTIFIER } from "../config";

export type Account = Readonly<{
  address: Base64EncodedAddress;
  label?: string;
  publicKey: PublicKey;
}>;

type WalletAuthorization = Readonly<{
  accounts: Account[];
  authToken: AuthToken;
  selectedAccount: Account;
}>;

function getPublicKeyFromAddress(address: Base64EncodedAddress): PublicKey {
  return new PublicKey(Buffer.from(address, "base64"));
}

function getAccountFromAuthorizedAccount(account: AuthorizedAccount): Account {
  return { ...account, publicKey: getPublicKeyFromAddress(account.address) };
}

function getAuthorizationFromAuthorizationResult(
  authorizationResult: AuthorizationResult,
  previouslySelectedAccount?: Account
): WalletAuthorization {
  let selectedAccount: Account;
  if (
    previouslySelectedAccount == null ||
    !authorizationResult.accounts.some(
      ({ address }) => address === previouslySelectedAccount.address
    )
  ) {
    selectedAccount = getAccountFromAuthorizedAccount(
      authorizationResult.accounts[0]
    );
  } else {
    selectedAccount = previouslySelectedAccount;
  }
  return {
    accounts: authorizationResult.accounts.map(getAccountFromAuthorizedAccount),
    authToken: authorizationResult.auth_token,
    selectedAccount,
  };
}

function cacheReviver(key: string, value: unknown) {
  if (key === "publicKey") {
    return new PublicKey(value as PublicKeyInitData);
  }
  return value;
}

const AUTHORIZATION_STORAGE_KEY = "authorization-cache";

/** The most recent authorization, shared by every hook instance (undefined until read). */
let latestAuthorization: WalletAuthorization | null | undefined;

async function fetchAuthorization(): Promise<WalletAuthorization | null> {
  const cached = await AsyncStorage.getItem(AUTHORIZATION_STORAGE_KEY);
  latestAuthorization = cached ? JSON.parse(cached, cacheReviver) : null;
  return latestAuthorization ?? null;
}

async function persistAuthorization(
  auth: WalletAuthorization | null
): Promise<void> {
  latestAuthorization = auth;
  if (auth == null) {
    await AsyncStorage.removeItem(AUTHORIZATION_STORAGE_KEY);
  } else {
    await AsyncStorage.setItem(AUTHORIZATION_STORAGE_KEY, JSON.stringify(auth));
  }
}

export function useAuthorization() {
  const queryClient = useQueryClient();
  const { data: authorization, isLoading } = useQuery({
    queryKey: ["wallet-authorization"],
    queryFn: () => fetchAuthorization(),
  });
  const { mutateAsync: setAuthorization } = useMutation({
    mutationFn: persistAuthorization,
    // Put the new value in the cache directly. With only an invalidate, the
    // screen kept showing the old state after Connect or Disconnect (seen with
    // the test wallet on the emulator) until the app was restarted.
    onSuccess: (_, auth) => {
      queryClient.setQueryData(["wallet-authorization"], auth);
    },
  });

  const authorizeSession = useCallback(
    async (wallet: AuthorizeAPI): Promise<Account> => {
      // The latest authorization, even when this callback was created before
      // a connect that just happened (a buy connects, then signs at once).
      const known = latestAuthorization !== undefined ? latestAuthorization : authorization;
      let result: AuthorizationResult;
      try {
        result = await wallet.authorize({
          identity: APP_IDENTITY,
          chain: CHAIN_IDENTIFIER,
          auth_token: known?.authToken,
        });
      } catch (e) {
        if (!known?.authToken) throw e;
        // The wallet refused the saved token (Phantom answers the legacy
        // `reauthorize` with -1): ask for a fresh authorization instead.
        console.log(`RUNG reauthorize refused, authorizing again: ${(e as Error)?.message ?? e}`);
        result = await wallet.authorize({ identity: APP_IDENTITY, chain: CHAIN_IDENTIFIER });
      }
      const next = getAuthorizationFromAuthorizationResult(
        result,
        known?.selectedAccount
      );
      await setAuthorization(next);
      return next.selectedAccount;
    },
    [authorization, setAuthorization]
  );

  const deauthorizeSession = useCallback(
    async (wallet: DeauthorizeAPI) => {
      const known = latestAuthorization !== undefined ? latestAuthorization : authorization;
      if (known?.authToken != null) {
        await wallet.deauthorize({ auth_token: known.authToken });
      }
      await setAuthorization(null);
    },
    [authorization, setAuthorization]
  );

  // Forget the cached authorization without opening the wallet.
  const clearAuthorization = useCallback(
    () => setAuthorization(null),
    [setAuthorization]
  );

  return useMemo(
    () => ({
      authorizeSession,
      deauthorizeSession,
      clearAuthorization,
      selectedAccount: authorization?.selectedAccount ?? null,
      isLoading,
    }),
    [authorization, authorizeSession, deauthorizeSession, clearAuthorization, isLoading]
  );
}
