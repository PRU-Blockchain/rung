// Polyfills first: crypto.getRandomValues and Buffer for web3.js.
import "./src/polyfills";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, LogBox, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { PublicKey } from "../client/src";

import { BuyError, inForeground, openBuy } from "./src/flow/buy";
import { Receipt } from "./src/flow/history";
import { Running, findUnfinished } from "./src/flow/ladder";
import { loadMarket } from "./src/flow/market";
import { Plan, makePlan, rungsForMode } from "./src/flow/plan";
import { BuyScreen } from "./src/screens/BuyScreen";
import { HistoryScreen } from "./src/screens/HistoryScreen";
import { LadderScreen } from "./src/screens/LadderScreen";
import { NotBoughtScreen } from "./src/screens/NotBoughtScreen";
import { ReceiptScreen } from "./src/screens/ReceiptScreen";
import { useAuthorization } from "./src/utils/useAuthorization";
import { useMobileWallet } from "./src/utils/useMobileWallet";

const queryClient = new QueryClient();

// web3.js logs every rate-limited retry of the public devnet RPC as an error;
// in development builds that covers the screen. They still reach Metro's log.
LogBox.ignoreLogs(["Server responded with 429"]);

type Screen =
  | { name: "start" }
  | { name: "buy" }
  | { name: "ladder"; running: Running }
  | { name: "receipt"; r: Receipt }
  | { name: "not-bought"; r: Receipt }
  | { name: "history"; back: Screen };

const message = (e: unknown) => (e instanceof BuyError ? e.message : `Something went wrong: ${(e as Error)?.message ?? e}`);

function Main() {
  const { selectedAccount } = useAuthorization();
  const { connect, disconnect, signOpen } = useMobileWallet();
  const [screen, setScreen] = useState<Screen>({ name: "start" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // An order left by an earlier run is finished first (or refunded).
  useEffect(() => {
    findUnfinished()
      .then((running) => setScreen(running ? { name: "ladder", running } : { name: "buy" }))
      .catch(() => setScreen({ name: "buy" }));
  }, []);

  const buy = async (getPlan: () => Promise<Plan>) => {
    setBusy(true);
    setError(null);
    try {
      // Network work happens while Rung is in front (its requests failed from
      // the background); the wallet then opens once, to authorize and sign.
      // Without any cached account the first buy connects first.
      let user: PublicKey;
      if (selectedAccount) user = selectedAccount.publicKey;
      else {
        user = (await connect()).publicKey;
        // The wallet answers before Rung is in front again; reading the chain
        // right away failed with "Network request failed" (seen with Phantom).
        await inForeground();
      }
      const plan = await getPlan();
      const opened = await openBuy(plan, user, signOpen);
      setScreen({ name: "ladder", running: opened });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const retry = (r: Receipt) =>
    buy(async () => {
      const market = await loadMarket(new PublicKey(r.mint));
      return makePlan(market, "launch", rungsForMode("launch"), BigInt(r.amount));
    });

  const go = (next: Screen) => {
    setError(null);
    setScreen(next);
  };

  switch (screen.name) {
    case "start":
      return (
        <View style={{ flex: 1, justifyContent: "center", backgroundColor: "#ffffff" }}>
          <ActivityIndicator />
        </View>
      );
    case "buy":
      return (
        <BuyScreen
          user={selectedAccount?.publicKey ?? null}
          busy={busy}
          error={error}
          onBuy={(plan) => buy(async () => plan)}
          onHistory={() => go({ name: "history", back: screen })}
          onDisconnect={() => disconnect().catch(() => undefined)}
        />
      );
    case "ladder":
      return (
        <LadderScreen
          running={screen.running}
          onDone={(r, err) => {
            if (!r) {
              setScreen({ name: "buy" });
              setError(err ?? "The order stopped.");
            } else go(r.outcome === "filled" ? { name: "receipt", r } : { name: "not-bought", r });
          }}
        />
      );
    case "receipt":
      return <ReceiptScreen r={screen.r} onNew={() => go({ name: "buy" })} onHistory={() => go({ name: "history", back: screen })} />;
    case "not-bought":
      return (
        <NotBoughtScreen
          r={screen.r}
          busy={busy}
          error={error}
          onRetry={() => retry(screen.r)}
          onNew={() => go({ name: "buy" })}
          onHistory={() => go({ name: "history", back: screen })}
        />
      );
    case "history":
      return <HistoryScreen onBack={() => go(screen.back)} />;
  }
}

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <Main />
        <StatusBar style="dark" />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
