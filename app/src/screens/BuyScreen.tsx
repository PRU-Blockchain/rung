import * as Clipboard from "expo-clipboard";
import { useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Mode, PublicKey, orderPda } from "../../../client/src";

import { connection } from "../flow/connection";
import { bpsText, parseSol, priceText, shortAddress, sol, tokens } from "../flow/format";
import { Market, MarketError, curveAgeSeconds, loadMarket, parseMint, priceKeys, venueText, withPrice } from "../flow/market";
import {
  MODE_OPTIONS,
  Plan,
  WIDE_FIRST_RUNG,
  amountError,
  leavesWallet,
  makePlan,
  maxFeeIfNoFill,
  parseCustomRungs,
  rungsForMode,
} from "../flow/plan";
import { Button, Header, colors, s } from "./ui";

const REFRESH_MS = 2500;
const YOUNG_CURVE_SECONDS = 120;

export function BuyScreen(props: {
  user: PublicKey | null;
  busy: boolean;
  error: string | null;
  onBuy: (plan: Plan) => void;
  onHistory: () => void;
  onDisconnect: () => void;
}) {
  const [mintText, setMintText] = useState("");
  const [market, setMarket] = useState<Market | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  // When the curve was created (unix seconds). The age used to be read once, so
  // "suggested for a token's first two minutes" stayed on after two minutes.
  const [createdAt, setCreatedAt] = useState<number | null>(null);
  const [, setAgeTick] = useState(0);
  const [mode, setMode] = useState<Mode>("tight");
  const [customText, setCustomText] = useState("1, 2, 3");
  const [amountText, setAmountText] = useState("0.01");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [orderExists, setOrderExists] = useState(false);
  const [details, setDetails] = useState(false);

  // Load the token when the address changes.
  useEffect(() => {
    setMarket(null);
    setMarketError(null);
    setCreatedAt(null);
    const text = mintText.trim();
    if (!text) return;
    const mint = parseMint(text);
    if (!mint) {
      setMarketError("This is not a token address.");
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      loadMarket(mint)
        .then((m) => live && setMarket(m))
        .catch((e) => live && setMarketError(e instanceof MarketError ? e.message : "Could not read this token. Check the network."));
      curveAgeSeconds(mint)
        .then((a) => live && a !== null && setCreatedAt(Date.now() / 1000 - a))
        .catch(() => undefined);
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [mintText]);

  // Re-render once the curve turns two minutes old, so the suggestion goes away.
  useEffect(() => {
    if (createdAt === null) return;
    const left = createdAt + YOUNG_CURVE_SECONDS - Date.now() / 1000;
    if (left <= 0) return;
    const t = setTimeout(() => setAgeTick((n) => n + 1), left * 1000 + 100);
    return () => clearTimeout(t);
  }, [createdAt]);
  // Only a token still on its curve can be that young; a pool token gets no suggestion.
  const young = market?.venue === "Curve" && createdAt !== null && Date.now() / 1000 - createdAt < YOUNG_CURVE_SECONDS;

  // Refresh the curve or pool (quote), the wallet balance and the order account every few seconds.
  const marketRef = useRef(market);
  marketRef.current = market;
  useEffect(() => {
    if (!market) return;
    let live = true;
    const id = setInterval(async () => {
      const m = marketRef.current;
      if (!m) return;
      try {
        const price = priceKeys(m);
        const keys = [...price, ...(props.user ? [props.user, orderPda(props.user)] : [])];
        const infos = await connection.getMultipleAccountsInfo(keys);
        if (!live) return;
        const [userInfo, orderInfo] = infos.slice(price.length);
        const next = withPrice(m, infos.slice(0, price.length));
        // The curve completed while the screen was open: read the token again (pool or not yet).
        const fresh = next === "moved" ? await loadMarket(m.mint) : next;
        if (!live) return;
        setMarket(fresh);
        if (props.user) {
          setBalance(BigInt(userInfo?.lamports ?? 0));
          // An earlier order record (open ones are cancelled in the same transaction) is reused.
          setOrderExists(!!orderInfo);
        }
      } catch (e) {
        if (live && e instanceof MarketError) {
          setMarket(null);
          setMarketError(e.message);
        }
      }
    }, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [market?.mint.toBase58(), props.user?.toBase58()]);

  // A buy that failed (e.g. "Approval took too long") is reported at the
  // bottom of the screen. Coming back from the wallet or the launcher, Android
  // reopened the keyboard on the address field and it covered that line:
  // close it and scroll to the message.
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (!props.error) return;
    Keyboard.dismiss();
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 300);
    return () => clearTimeout(t);
  }, [props.error]);

  const custom = useMemo(() => parseCustomRungs(customText), [customText]);
  const rungs = mode === "custom" ? ("rungs" in custom ? custom.rungs : null) : rungsForMode(mode);
  const amount = parseSol(amountText);
  const amountProblem = amountError(amount);

  useEffect(() => {
    setPlanError(null);
    if (!market || !rungs || amountProblem || amount === null) {
      setPlan(null);
      return;
    }
    let live = true;
    makePlan(market, mode, rungs, amount)
      .then((p) => live && setPlan(p))
      .catch((e) => {
        if (!live) return;
        setPlan(null);
        setPlanError((e as Error).message);
      });
    return () => {
      live = false;
    };
  }, [market, mode, rungs?.join(","), amount]);

  const cost = plan ? leavesWallet(plan, orderExists) : null;
  const capBps = rungs ? rungs[rungs.length - 1] : null;
  const reason =
    marketError ??
    (!market ? "Paste a token address." : null) ??
    (mode === "custom" && "error" in custom ? custom.error : null) ??
    amountProblem ??
    planError ??
    (!plan ? "Getting a quote…" : null) ??
    (balance !== null && cost && balance < cost.total + 100_000n ? "Not enough SOL in the wallet for this buy." : null);

  return (
    <SafeAreaView style={s.screen}>
      <ScrollView ref={scrollRef} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Header
          right={
            <Pressable onPress={props.onHistory} accessibilityRole="button">
              <Text style={[s.body, { color: colors.link, marginTop: 8 }]}>History</Text>
            </Pressable>
          }
        />

        <Text style={s.h2}>Token address</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput
            style={[s.input, { flex: 1 }]}
            value={mintText}
            onChangeText={setMintText}
            placeholder="pump.fun token address"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Button label="Paste" kind="secondary" onPress={async () => setMintText((await Clipboard.getStringAsync()).trim())} />
        </View>
        {marketError && <Text style={s.error}>{marketError}</Text>}
        {market && (
          <View style={s.box}>
            <Text style={s.body}>Token {shortAddress(market.mint.toBase58())}</Text>
            <Text style={s.small}>{venueText(market.venue)}</Text>
            {plan && (
              <>
                <Text style={s.body}>
                  Price you saw: {priceText(plan.amount, plan.quote.expectedTokensSeen, market.decimals)}
                </Text>
                <Text style={s.small}>
                  {sol(plan.amount)} buys about {tokens(plan.quote.expectedTokensSeen, market.decimals)} tokens now
                </Text>
              </>
            )}
          </View>
        )}

        <Text style={s.h2}>Mode</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {MODE_OPTIONS.map((o) => {
            const on = mode === o.mode;
            const suggested = o.mode === "launch" && young;
            return (
              <Pressable
                key={o.mode}
                accessibilityRole="button"
                onPress={() => setMode(o.mode)}
                style={[s.button, { width: "48%", paddingVertical: 9, paddingHorizontal: 10 }, on ? s.primary : s.secondary]}
              >
                <Text style={[s.buttonText, on ? s.primaryText : s.secondaryText]}>{o.label}</Text>
                {suggested && (
                  <Text style={[s.small, { color: on ? "#dddddd" : colors.muted, textAlign: "center" }]}>
                    suggested for a token's first two minutes
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>
        {mode === "custom" && (
          <View style={{ gap: 6 }}>
            <Text style={s.small}>Rungs in percent, increasing; the last one is your cap (at most 30%).</Text>
            <TextInput
              style={s.input}
              value={customText}
              onChangeText={setCustomText}
              placeholder="1, 2, 3"
              placeholderTextColor={colors.faint}
              keyboardType="numbers-and-punctuation"
            />
            {"error" in custom && <Text style={s.error}>{custom.error}</Text>}
            {"rungs" in custom && custom.rungs[0] >= 2000 && <Text style={s.error}>{WIDE_FIRST_RUNG}</Text>}
          </View>
        )}

        <Text style={s.h2}>Amount (SOL)</Text>
        <TextInput
          style={s.input}
          value={amountText}
          onChangeText={setAmountText}
          keyboardType="decimal-pad"
          placeholder="0.01"
          placeholderTextColor={colors.faint}
        />

        {plan && (
          <View style={{ gap: 2, marginTop: 6 }}>
            <Text style={s.body}>If no rung fills, max fee: {sol(maxFeeIfNoFill(plan))}</Text>
            <Text style={s.small}>+ approval fee set by your wallet</Text>
            <Pressable onPress={() => setDetails(!details)} accessibilityRole="button">
              <Text style={[s.small, { color: colors.link, paddingVertical: 4 }]}>{details ? "Hide details" : "Details"}</Text>
            </Pressable>
            {details && cost && (
              <View style={s.box}>
                <Text style={s.small}>Leaves your wallet when the order opens: {sol(cost.total)} + approval fee</Text>
                <Text style={s.small}>buy: {sol(cost.buy)}</Text>
                <Text style={s.small}>rent share for the accounts a buy creates: {sol(cost.rentShare)} (unused part comes back)</Text>
                <Text style={s.small}>fee share for the tries: {sol(cost.feeShare)} (unused part comes back)</Text>
                <Text style={s.small}>
                  order record deposit: {cost.orderDeposit > 0n ? sol(cost.orderDeposit) : "none, your earlier order record is reused"}
                </Text>
                <Text style={s.small}>rungs: {plan.rungs.map(bpsText).join(" → ")}</Text>
              </View>
            )}
          </View>
        )}

        <Button
          label="Buy once · one wallet approval covers every try"
          onPress={() => plan && props.onBuy(plan)}
          disabled={!!reason || props.busy}
        />
        {capBps !== null && (
          <Text style={s.small}>
            Price jumped above your {bpsText(capBps)} cap? Rung doesn't buy. Your SOL comes back.
          </Text>
        )}
        {reason && !props.busy && <Text style={s.small}>{reason}</Text>}
        {props.busy && <Text style={s.small}>Waiting for your wallet…</Text>}
        {props.error && <Text style={s.error}>{props.error}</Text>}
        {!props.user && <Text style={s.small}>The button connects your wallet first.</Text>}
        {props.user && (
          <Text style={[s.small, { marginTop: 12 }]}>
            Wallet {shortAddress(props.user.toBase58())}
            {balance !== null ? ` · ${sol(balance)}` : ""} ·{" "}
            <Text style={{ color: colors.link }} onPress={props.onDisconnect}>
              Disconnect
            </Text>
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
