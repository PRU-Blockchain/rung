// Polyfills first: crypto.getRandomValues and Buffer for web3.js.
import "./src/polyfills";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

// The repo's TypeScript client, resolved from ../client/src by metro.config.js.
import { MODES, RUNG_PROGRAM_ID } from "../client/src";

import { CLUSTER } from "./src/config";
import { useAuthorization } from "./src/utils/useAuthorization";
import { useMobileWallet } from "./src/utils/useMobileWallet";
import { runSelfCheck } from "./src/utils/selfCheck";

const queryClient = new QueryClient();

// The four preset modes from the client, plus "custom" (a type-only mode in
// client/src/constants.ts whose rungs come from the user).
const MODE_NAMES = [...Object.keys(MODES), "custom"];

function shorten(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function Home() {
  const { selectedAccount } = useAuthorization();
  const { connect, disconnect } = useMobileWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selfCheck, setSelfCheck] = useState("running");

  useEffect(() => {
    runSelfCheck()
      .then(setSelfCheck)
      .catch((e) => setSelfCheck(`failed (${(e as Error).message})`));
  }, []);

  const run = (action: () => Promise<unknown>) => async () => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>Rung</Text>
      <Text style={styles.network}>{CLUSTER}</Text>

      <View style={styles.wallet}>
        {selectedAccount ? (
          <>
            <Text style={styles.address} testID="wallet-address">
              {shorten(selectedAccount.publicKey.toBase58())}
            </Text>
            <Pressable
              style={[styles.button, styles.secondary]}
              disabled={busy}
              onPress={run(disconnect)}
            >
              <Text style={styles.secondaryText}>Disconnect</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            style={styles.button}
            disabled={busy}
            onPress={run(connect)}
          >
            <Text style={styles.buttonText}>Connect wallet</Text>
          </Pressable>
        )}
        {busy && <ActivityIndicator style={styles.spinner} />}
        {error && <Text style={styles.error}>{error}</Text>}
      </View>

      <View style={styles.footer}>
        <Text style={styles.small}>Self-check: {selfCheck}</Text>
        <Text style={styles.small}>Program: {RUNG_PROGRAM_ID.toBase58()}</Text>
        <Text style={styles.small}>Modes: {MODE_NAMES.join(", ")}</Text>
      </View>
      <StatusBar style="dark" />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <Home />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#ffffff", padding: 24 },
  title: { fontSize: 32, fontWeight: "700", color: "#111111", marginTop: 24 },
  network: {
    alignSelf: "flex-start",
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: "#eeeeee",
    color: "#333333",
    fontSize: 13,
  },
  wallet: { flex: 1, justifyContent: "center", alignItems: "center" },
  address: { fontSize: 20, fontFamily: "monospace", color: "#111111", marginBottom: 16 },
  button: {
    backgroundColor: "#111111",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
  secondary: { backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#111111" },
  secondaryText: { color: "#111111", fontSize: 16, fontWeight: "600" },
  spinner: { marginTop: 16 },
  error: { marginTop: 16, color: "#b00020", textAlign: "center" },
  footer: { gap: 4 },
  small: { fontSize: 12, color: "#555555" },
});
