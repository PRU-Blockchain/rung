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

async function fetchAuthorization(): Promise<WalletAuthorization | null> {
  const cached = await AsyncStorage.getItem(AUTHORIZATION_STORAGE_KEY);
  return cached ? JSON.parse(cached, cacheReviver) : null;
}

async function persistAuthorization(
  auth: WalletAuthorization | null
): Promise<void> {
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallet-authorization"] });
    },
  });

  const authorizeSession = useCallback(
    async (wallet: AuthorizeAPI): Promise<Account> => {
      const result = await wallet.authorize({
        identity: APP_IDENTITY,
        chain: CHAIN_IDENTIFIER,
        auth_token: authorization?.authToken,
      });
      const next = getAuthorizationFromAuthorizationResult(
        result,
        authorization?.selectedAccount
      );
      await setAuthorization(next);
      return next.selectedAccount;
    },
    [authorization, setAuthorization]
  );

  const deauthorizeSession = useCallback(
    async (wallet: DeauthorizeAPI) => {
      if (authorization?.authToken != null) {
        await wallet.deauthorize({ auth_token: authorization.authToken });
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
