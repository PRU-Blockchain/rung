// Polyfills first: crypto.getRandomValues and Buffer for web3.js.
import "./src/polyfills";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, BackHandler, LogBox, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { PresetMode, PublicKey, orderPda } from "../client/src";

import { BuyError, inForeground, openBuy } from "./src/flow/buy";
import { walletProblemText } from "./src/sendFailure";
import { Receipt } from "./src/flow/history";
import { Running, findUnfinished } from "./src/flow/ladder";
import { loadMarket } from "./src/flow/market";
import { connection } from "./src/flow/connection";
import { walletIsShort } from "./src/funds";
import { Plan, leavesWallet, makePlan, rungsForMode } from "./src/flow/plan";
import { BuyScreen } from "./src/screens/BuyScreen";
import { HistoryScreen } from "./src/screens/HistoryScreen";
import { LadderScreen } from "./src/screens/LadderScreen";
import { NotBoughtScreen } from "./src/screens/NotBoughtScreen";
import { ReceiptScreen } from "./src/screens/ReceiptScreen";
import { useAuthorization } from "./src/utils/useAuthorization";
import { useMobileWallet } from "./src/utils/useMobileWallet";

const queryClient = new QueryClient();

// web3.js logs every rate-limited retry of the public RPC as an error;
// in development builds that covers the screen. They still reach Metro's log.
LogBox.ignoreLogs(["Server responded with 429"]);

type Screen =
  | { name: "start" }
  | { name: "buy" }
  | { name: "ladder"; running: Running }
  | { name: "receipt"; r: Receipt }
  | { name: "not-bought"; r: Receipt }
  | { name: "history"; back: Screen };

// With the network off, a buy only showed "Something went wrong: Network request failed";
// with the wallet locked, the name of a Java exception. Connecting fails here too,
// before a buy exists, so the wallet's errors are worded in this place as well.
const message = (e: unknown) => {
  if (e instanceof BuyError) return e.message;
  const text = String((e as Error)?.message ?? e);
  if (/Network request failed/i.test(text)) return "No network connection. Check it and try again.";
  return walletProblemText((e as { code?: unknown })?.code, text) ?? `Something went wrong: ${text}`;
};

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
      const justConnected = !selectedAccount;
      if (selectedAccount) user = selectedAccount.publicKey;
      else {
        user = (await connect()).publicKey;
        // The wallet answers before Rung is in front again; reading the chain
        // right away failed with "Network request failed" (seen with Phantom).
        await inForeground();
      }
      const plan = await getPlan();
      // A wallet connected by this very press has not had its balance looked at yet (the buy screen checks only
      // a wallet it already knows): look now, so the wallet is not opened a second time for an order that
      // cannot be paid.
      if (justConnected) {
        const [balance, order] = await Promise.all([connection.getBalance(user), connection.getAccountInfo(orderPda(user))]);
        if (walletIsShort(true, BigInt(balance), leavesWallet(plan, order !== null).total)) {
          throw new BuyError("Not enough SOL in the wallet for this buy.");
        }
      }
      const opened = await openBuy(plan, user, signOpen);
      setScreen({ name: "ladder", running: opened });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  // Retry from the "not bought" screen: the same token and amount, in the mode picked there (Buğra, Nov 27;
  // before, the only retry was Launch mode). A new order and a new wallet approval.
  const retry = (r: Receipt, mode: PresetMode) =>
    buy(async () => {
      const market = await loadMarket(new PublicKey(r.mint));
      return makePlan(market, mode, rungsForMode(mode), BigInt(r.amount));
    });

  const go = (next: Screen) => {
    setError(null);
    setScreen(next);
  };

  // Android Back: it closed the app from History (and from the receipt
  // screens). History goes back to where it was opened from, the receipt and
  // "not bought" screens to the buy screen. While a ladder runs Back is
  // ignored: the tries and the refund are sent from this app's JS, so it must
  // keep running. On the buy screen Back does what Android does.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (busy) return true; // a wallet request or a retry is on its way
      switch (screen.name) {
        case "history":
          go(screen.back);
          return true;
        case "receipt":
        case "not-bought":
          go({ name: "buy" });
          return true;
        case "ladder":
        case "start":
          return true;
        default:
          return false;
      }
    });
    return () => sub.remove();
  }, [screen, busy]);

  switch (screen.name) {
    case "start":
      return (
        <View style={{ flex: 1, justifyContent: "center", backgroundColor: "#0B0D10" }}>
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
          onRetry={(mode) => mode !== "custom" && retry(screen.r, mode)}
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
        <StatusBar style="light" />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
