// The Sell side of the app: the wallet's pump.fun tokens, each with one
// action, sell all. Buying without a way out sent buyers to another app to
// sell (Buğra, on his phone, Nov 27). The sale climbs like a buy: tightest
// rung first, one wallet approval for every try (flow/sell.ts).

import { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, Vibration, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PresetMode, PublicKey } from "../../../client/src";

import { bpsText, explorerTx, sol } from "../flow/format";
import { MarketError } from "../flow/market";
import { MODE_OPTIONS, rungsForMode } from "../flow/plan";
import { Holding, SaleResult, SellError, SellQuote, SignTxs, loadHoldings, quoteSell, sendSellLadder } from "../flow/sell";
import { useTokenInfo } from "../flow/tokenInfo";
import { SaleRungState, sellMinimums } from "./sellLadder";
import { tokShort, wholeTokens } from "./tokShort";
import { Button, BuySellTabs, Header, Row, Sheet, TokenLineView, WalletWaitSheet, colors, s } from "./ui";

/** pump.fun tokens have six decimals; the exact number comes with the sale's quote. */
const LIST_DECIMALS = 6;

/** The ladders a sale can use: the four modes, as for a buy. */
const SELL_MODES = MODE_OPTIONS.filter((o) => o.mode !== "custom") as { mode: PresetMode; label: string }[];
const MODE_NAME: Record<PresetMode, string> = { tight: "Tight", normal: "Normal", fast: "Fast", launch: "Launch" };

function TokenItem({ h, onSell }: { h: Holding; onSell: () => void }) {
  const info = useTokenInfo(h.mint, true);
  return (
    <View style={st.item}>
      <View style={{ flex: 1 }}>
        <TokenLineView mint={h.mint} info={info} sub={`${tokShort(wholeTokens(h.amount, LIST_DECIMALS))} ${info?.symbol ?? ""}`.trim()} />
      </View>
      <Pressable accessibilityRole="button" onPress={onSell} style={({ pressed }) => [st.sell, pressed && { backgroundColor: colors.raise }]}>
        <Text style={st.sellText}>Sell</Text>
      </Pressable>
    </View>
  );
}

const message = (e: unknown) =>
  e instanceof SellError || e instanceof MarketError
    ? e.message
    : /Network request failed/i.test(String((e as Error)?.message ?? e))
      ? "No network connection. Check it and try again."
      : `Something went wrong: ${String((e as Error)?.message ?? e)}`;

const STATE_TEXT: Record<SaleRungState, string> = { trying: "trying…", sold: "sold", missed: "missed", "not-needed": "not needed" };
const stateColor = (state: SaleRungState | undefined) =>
  state === "sold" ? colors.good : state === "missed" ? colors.bad : state === "trying" ? colors.accent : colors.line;

export function TokensScreen(props: {
  /** Null when no wallet is connected: the screen then offers to connect. */
  user: PublicKey | null;
  signTxs: SignTxs;
  /** Opens the sale of this token at once (from a receipt). */
  sellMint?: string;
  onBuy: () => void;
  onConnect: () => void;
  connecting: boolean;
  connectError: string | null;
}) {
  const user = props.user;
  const [list, setList] = useState<Holding[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [mint, setMint] = useState<string | null>(props.sellMint ?? null);
  const [quote, setQuote] = useState<SellQuote | null>(null);
  const [mode, setMode] = useState<PresetMode>("tight");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "wallet" | "selling">("idle");
  const [states, setStates] = useState<(SaleRungState | undefined)[]>([]);
  const [result, setResult] = useState<SaleResult | null>(null);
  const info = useTokenInfo(mint, true);
  const rungs = rungsForMode(mode);

  const reload = () => {
    if (!user) return;
    setListError(null);
    loadHoldings(user)
      .then(setList)
      .catch((e) => setListError(message(e)));
  };
  useEffect(reload, [user?.toBase58()]);

  // The token picked: price its sale. Nothing is sent here.
  useEffect(() => {
    setQuote(null);
    setError(null);
    setResult(null);
    setStates([]);
    if (!mint || !user) return;
    let live = true;
    quoteSell(user, new PublicKey(mint))
      .then((q) => live && setQuote(q))
      .catch((e) => live && setError(message(e)));
    return () => {
      live = false;
    };
  }, [mint, user?.toBase58()]);

  const busy = phase !== "idle";
  const close = () => {
    if (busy) return;
    setMint(null);
    if (result) reload();
  };
  const sell = async () => {
    if (!quote || !user || busy) return;
    setPhase("wallet");
    setError(null);
    setStates([]);
    try {
      const r = await sendSellLadder(user, quote, rungs, props.signTxs, (i, state) => {
        // The wallet has answered: from here on the rungs are tried.
        setPhase("selling");
        if (state === "trying") Vibration.vibrate(12);
        if (state === "sold") Vibration.vibrate([0, 28, 70, 28]);
        setStates((prev) => {
          const next = [...prev];
          next[i] = state;
          return next;
        });
      });
      setResult(r);
    } catch (e) {
      setError(message(e));
    } finally {
      setPhase("idle");
    }
  };

  const symbol = info?.symbol || "tokens";
  const soldBps = result && result.soldRungIndex !== null ? rungs[result.soldRungIndex] : null;
  const notSold = result !== null && result.soldRungIndex === null;
  const showLadder = phase === "selling" || result !== null;
  return (
    <SafeAreaView style={s.screen}>
      <Header />
      <BuySellTabs active="sell" onBuy={props.onBuy} onSell={() => undefined} />
      <ScrollView contentContainerStyle={[s.content, { gap: 8 }]}>
        {!user ? (
          <View style={{ gap: 12, paddingTop: 8 }}>
            <Text style={st.lead}>Connect your wallet to see the pump.fun tokens it holds.</Text>
            {props.connectError && <Text style={s.error}>{props.connectError}</Text>}
            <Button label="Connect wallet" onPress={props.onConnect} disabled={props.connecting} />
          </View>
        ) : (
          <>
            <Text style={st.heading} accessibilityRole="header">
              Your tokens
            </Text>
            {listError && <Text style={s.error}>{listError}</Text>}
            {list === null && !listError && <Text style={s.small}>Loading…</Text>}
            {list?.length === 0 && <Text style={s.small}>No pump.fun tokens in this wallet.</Text>}
            {list?.map((h) => <TokenItem key={h.mint} h={h} onSell={() => setMint(h.mint)} />)}
          </>
        )}
      </ScrollView>

      <Sheet visible={mint !== null && phase !== "wallet"} onClose={close} title={soldBps !== null ? "Sold" : notSold ? "Not sold" : "Sell all"}>
        {mint && (
          <View style={{ gap: 12 }}>
            <TokenLineView mint={mint} info={info} />

            {showLadder && (
              <View style={st.mini}>
                {rungs.map((bps, i) => (
                  <View key={bps} style={st.miniCard}>
                    <View style={[st.miniBar, { backgroundColor: stateColor(states[i]) }]} />
                    <Text style={st.miniText}>try {bpsText(bps)}</Text>
                    <Text style={st.miniState}>{states[i] ? STATE_TEXT[states[i]!] : " "}</Text>
                  </View>
                ))}
              </View>
            )}

            {soldBps !== null && result ? (
              <>
                <View>
                  <Row label="Rung that sold" value={`try ${bpsText(soldBps)}`} last={result.walletChange === null} />
                  {result.walletChange !== null && <Row label="Back in your wallet" value={sol(result.walletChange)} last />}
                </View>
                {result.signature && (
                  <Text style={s.link} onPress={() => Linking.openURL(explorerTx(result.signature!))}>
                    sale: {result.signature.slice(0, 8)}… <Text style={{ textDecorationLine: "underline" }}>(explorer)</Text>
                  </Text>
                )}
                <Button label="Done" onPress={close} />
              </>
            ) : notSold ? (
              <>
                <Text style={st.lead}>Price fell below your cap. Nothing was sold; your tokens are still in your wallet.</Text>
                <Button label="Done" onPress={close} />
              </>
            ) : phase === "selling" ? (
              <Text style={s.small}>Rung climbs for you, automatically</Text>
            ) : (
              <>
                {!quote && !error && <Text style={s.small}>Pricing the sale…</Text>}
                {quote && (
                  <>
                    <View style={st.chips}>
                      {SELL_MODES.map((o) => {
                        const on = o.mode === mode;
                        return (
                          <Pressable
                            key={o.mode}
                            accessibilityRole="button"
                            accessibilityState={{ selected: on }}
                            onPress={() => setMode(o.mode)}
                            style={[st.chip, on && st.chipOn]}
                          >
                            <Text style={st.chipText}>{MODE_NAME[o.mode]}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text style={s.small}>
                      Tries {rungs.map(bpsText).join(" → ")} below the price now, tightest first, and sells once. One wallet approval covers
                      every try.
                    </Text>
                    <View>
                      <Row label="You sell" value={`${tokShort(wholeTokens(quote.tokens, quote.market.decimals))} ${symbol}`} />
                      <Row label="The sale pays about" value={sol(quote.simulated)} />
                      <Row
                        label={`At least (your cap, ${bpsText(rungs[rungs.length - 1])})`}
                        value={sol(sellMinimums(quote.simulated, rungs)[rungs.length - 1])}
                      />
                      <Row label="Your token account's deposit, back too" value={sol(quote.accountRent)} last />
                    </View>
                  </>
                )}
                {error && <Text style={s.error}>{error}</Text>}
                <Button label="Sell all" onPress={() => void sell()} disabled={!quote} />
              </>
            )}
          </View>
        )}
      </Sheet>
      <WalletWaitSheet visible={phase === "wallet"} />
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  heading: { fontSize: 13, color: colors.muted, paddingTop: 2 },
  lead: { fontSize: 15, lineHeight: 21, color: colors.text },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  sell: { minHeight: 40, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.line, justifyContent: "center" },
  sellText: { fontSize: 14, fontWeight: "600", color: colors.text },
  chips: { flexDirection: "row", gap: 8 },
  chip: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  chipOn: { borderColor: colors.text, backgroundColor: colors.raise },
  chipText: { fontSize: 14, fontWeight: "600", color: colors.text },
  mini: { flexDirection: "row", gap: 8 },
  miniCard: { flex: 1, gap: 4, padding: 10, borderRadius: 14, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line },
  miniBar: { height: 6, borderRadius: 3 },
  miniText: { fontSize: 12.5, fontWeight: "600", color: colors.text },
  miniState: { fontSize: 11.5, color: colors.muted },
});
