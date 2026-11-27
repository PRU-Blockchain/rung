import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import { useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  Mode,
  PublicKey,
  ammUserVolumeAccumulatorPda,
  associatedTokenAddress,
  lamportsToUsd,
  orderPda,
  usdText,
  userVolumeAccumulatorPda,
  vaultPda,
} from "../../../client/src";

import { connection } from "../flow/connection";
import { walletIsShort, walletLine } from "../funds";
import { bpsText, parseSol, priceText, shortAddress, sol } from "../flow/format";
import { Market, MarketError, curveAgeSeconds, loadMarket, parseMint, priceKeys, venueText, withPrice } from "../flow/market";
import {
  Exists,
  MODE_OPTIONS,
  NOTHING_EXISTS,
  Plan,
  WIDE_FIRST_RUNG,
  amountError,
  leavesWallet,
  makePlan,
  maxFeeIfNoFill,
  parseCustomRungs,
  rungsForMode,
} from "../flow/plan";
import { useSolUsd, useTokenInfo } from "../flow/tokenInfo";
import { pressKey } from "./amountKeys";
import { BUY_PREFS_KEY, DEFAULT_BUY_PREFS, readBuyPrefs, writeBuyPrefs } from "./buyPrefs";
import { CustomRungs } from "./CustomRungs";
import { Keypad } from "./Keypad";
import { addressInText } from "./pasteAddress";
import { tokShort, wholeTokens } from "./tokShort";
import {
  Button,
  BuySellTabs,
  Chevron,
  ClipboardIcon,
  ClockIcon,
  CrossIcon,
  Footer,
  Header,
  IconButton,
  LinkButton,
  Sheet,
  TokenLineView,
  WalletWaitSheet,
  colors,
  s,
} from "./ui";

const PRESETS = ["0.01", "0.05", "0.1", "0.5"];

/** What each mode is for: the README's mode table, as on the site. */
export const MODE_FOR: Record<Mode, string> = {
  tight: "established tokens",
  normal: "established tokens, everyday buys",
  fast: "most-traded, fast-moving pools",
  launch: "a token's first two minutes",
  custom: "you choose 1–5 rungs and the cap",
};

const SUGGESTED = "suggested for a token's first two minutes";

const REFRESH_MS = 2500;
const YOUNG_CURVE_SECONDS = 120;

export function BuyScreen(props: {
  user: PublicKey | null;
  busy: boolean;
  error: string | null;
  onBuy: (plan: Plan) => void;
  onHistory: () => void;
  onTokens: () => void;
  onDisconnect: () => void;
}) {
  const [mintText, setMintText] = useState("");
  const [market, setMarket] = useState<Market | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  // When the curve was created (unix seconds). The age used to be read once, so
  // "suggested for a token's first two minutes" stayed on after two minutes.
  const [createdAt, setCreatedAt] = useState<number | null>(null);
  const [, setAgeTick] = useState(0);
  const [mode, setMode] = useState<Mode>(DEFAULT_BUY_PREFS.mode);
  const [customText, setCustomText] = useState(DEFAULT_BUY_PREFS.customText);
  const [amountText, setAmountText] = useState(DEFAULT_BUY_PREFS.amountText);
  // The screen opens with the amount and the mode of the last buy (Buğra, Nov 27). They are read once; if the
  // user has already changed something by then, what they chose stays.
  const touched = useRef(false);
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(BUY_PREFS_KEY)
      .then((text) => {
        if (!live || touched.current || text === null) return;
        const kept = readBuyPrefs(text);
        setMode(kept.mode);
        setCustomText(kept.customText);
        setAmountText(kept.amountText);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [orderExists, setOrderExists] = useState(false);
  const [exists, setExists] = useState<Exists>(NOTHING_EXISTS);
  const [details, setDetails] = useState(false);
  const usdPerSol = useSolUsd();

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
        // With a wallet: its balance, its order record, and the two accounts that outlive a buy (its token account
        // for this mint, the venue's volume account for its vault): their rent is not sent when they exist.
        const vault = props.user ? vaultPda(props.user) : null;
        const keys = [
          ...price,
          ...(props.user && vault
            ? [
                props.user,
                orderPda(props.user),
                associatedTokenAddress(props.user, m.mint, m.tokenProgram),
                m.venue === "PumpSwap" ? ammUserVolumeAccumulatorPda(vault) : userVolumeAccumulatorPda(vault),
              ]
            : []),
        ];
        const infos = await connection.getMultipleAccountsInfo(keys);
        if (!live) return;
        const [userInfo, orderInfo, ataInfo, accInfo] = infos.slice(price.length);
        const next = withPrice(m, infos.slice(0, price.length));
        // The curve completed while the screen was open: read the token again (pool or not yet).
        const fresh = next === "moved" ? await loadMarket(m.mint) : next;
        if (!live) return;
        setMarket(fresh);
        if (props.user) {
          setBalance(BigInt(userInfo?.lamports ?? 0));
          // An earlier order record (open ones are cancelled in the same transaction) is reused.
          setOrderExists(!!orderInfo);
          setExists({ userTokenAccount: !!ataInfo, accumulator: !!accInfo });
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

  // A wallet that was disconnected or swapped takes its balance and its order
  // record with it: what is on the screen must belong to the wallet named on it.
  useEffect(() => {
    setBalance(null);
    setOrderExists(false);
    setExists(NOTHING_EXISTS);
  }, [props.user?.toBase58()]);
  // Another token: its token account is another one.
  useEffect(() => setExists(NOTHING_EXISTS), [market?.mint.toBase58()]);

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

  const cost = plan ? leavesWallet(plan, orderExists, exists) : null;
  const capBps = rungs ? rungs[rungs.length - 1] : null;
  const reason =
    marketError ??
    (!market ? "Paste a token address." : null) ??
    (mode === "custom" && "error" in custom ? custom.error : null) ??
    amountProblem ??
    planError ??
    (!plan ? "Getting a quote…" : null) ??
    (walletIsShort(!!props.user, balance, cost?.total ?? null) ? "Not enough SOL in the wallet for this buy." : null);

  // Presentation only from here on.
  const [modeSheet, setModeSheet] = useState(false);
  const [walletSheet, setWalletSheet] = useState(false);
  const addressRef = useRef<TextInput>(null);
  const mintKey = market ? market.mint.toBase58() : null;
  const info = useTokenInfo(mintKey, true);
  const noToken = mintText.trim() === "";
  const shortOfSol = walletIsShort(!!props.user, balance, cost?.total ?? null);
  // The clipboard is read only when the user asks for it: the Paste button, or a tap on the empty token box.
  // An address inside a copied link or message is taken out of it.
  const paste = async () => {
    const text = await Clipboard.getStringAsync();
    setMintText(addressInText(text) ?? text.trim());
  };
  // A tap on the empty token box: when the clipboard holds a token address it goes straight in, one tap less
  // (Buğra, Nov 27); otherwise the box opens for typing as before.
  const pasteIfAddress = async (): Promise<boolean> => {
    try {
      const found = addressInText(await Clipboard.getStringAsync());
      if (!found) return false;
      setMintText(found);
      return true;
    } catch {
      return false;
    }
  };
  const tapTokenBox = async () => {
    if (noToken && (await pasteIfAddress())) return;
    addressRef.current?.focus();
  };
  const focusTokenBox = async () => {
    if (noToken && (await pasteIfAddress())) addressRef.current?.blur();
  };
  // Buying keeps this amount and mode for the next time the screen opens.
  const buy = () => {
    if (!plan) return;
    void AsyncStorage.setItem(BUY_PREFS_KEY, writeBuyPrefs({ mode, amountText, customText })).catch(() => {});
    props.onBuy(plan);
  };
  const chipLabel = MODE_OPTIONS.find((o) => o.mode === mode)?.label ?? "";
  const launchLabel = MODE_OPTIONS.find((o) => o.mode === "launch")?.label ?? "";
  const customError = mode === "custom" && "error" in custom ? custom.error : null;
  const wideFirst = mode === "custom" && "rungs" in custom && custom.rungs[0] >= 2000;

  // The line under the amount: its error, the quote's error, the token count, or "Getting a quote…".
  let amountSub: { text: string; error: boolean } | null = null;
  if (amountProblem) amountSub = { text: amountProblem, error: true };
  else if (planError) amountSub = { text: planError, error: true };
  else if (plan && market) {
    const count = tokShort(wholeTokens(plan.quote.expectedTokensSeen, market.decimals));
    amountSub = { text: `≈ ${count} ${info?.symbol || "tokens"}`, error: false };
  } else if (market && rungs) amountSub = { text: "Getting a quote…", error: false };

  const detailLines: string[] = [];
  if (capBps !== null) detailLines.push(`Price jumped above your ${bpsText(capBps)} cap? Rung doesn't buy. Your SOL comes back.`);
  if (plan) detailLines.push(`If no rung fills, max fee: ${sol(maxFeeIfNoFill(plan))} + approval fee set by your wallet`);
  detailLines.push("one wallet approval covers every try");
  if (market) {
    detailLines.push(
      venueText(market.venue) +
        (plan ? ` · Price you saw: ${priceText(plan.amount, plan.quote.expectedTokensSeen, market.decimals)}` : ""),
    );
  }
  if (plan && cost) {
    detailLines.push(
      `Leaves your wallet when the order opens: ${sol(cost.total)} + approval fee`,
      `buy: ${sol(cost.buy)}`,
      `rent share for the accounts a buy creates: ${sol(cost.rentShare)} (unused part comes back)`,
      `fee share for the tries: ${sol(cost.feeShare)} (unused part comes back)`,
      `order record deposit: ${cost.orderDeposit > 0n ? sol(cost.orderDeposit) : "none, your earlier order record is reused"}`,
      `rungs: ${plan.rungs.map(bpsText).join(" → ")}`,
    );
  }

  return (
    <SafeAreaView style={s.screen}>
      <Header
        right={
          <>
            {props.user && (
              <Pressable accessibilityRole="button" onPress={() => setWalletSheet(true)} style={st.walletChip}>
                <Text style={st.walletChipText}>{shortAddress(props.user.toBase58())}</Text>
              </Pressable>
            )}
            <IconButton label="History" onPress={props.onHistory}>
              <ClockIcon />
            </IconButton>
          </>
        }
      />

      <BuySellTabs active="buy" onBuy={() => undefined} onSell={props.onTokens} />

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={[s.content, { flexGrow: 1 }]}
        keyboardShouldPersistTaps="handled"
      >
        {market && mintKey ? (
          <View style={st.tokenCard}>
            <View style={{ flex: 1 }}>
              <TokenLineView mint={mintKey} info={info} size={44} />
            </View>
            <IconButton label="Clear" onPress={() => setMintText("")}>
              <CrossIcon />
            </IconButton>
          </View>
        ) : (
          <Pressable style={st.tokenEmpty} onPress={() => void tapTokenBox()}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={st.tokenEmptyLabel}>Token address</Text>
              <TextInput
                ref={addressRef}
                style={st.addressInput}
                value={mintText}
                onChangeText={setMintText}
                onFocus={() => void focusTokenBox()}
                placeholder="pump.fun token address"
                placeholderTextColor={colors.faint}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            {noToken ? (
              <IconButton label="Paste" onPress={paste}>
                <ClipboardIcon />
              </IconButton>
            ) : (
              <IconButton label="Clear" onPress={() => setMintText("")}>
                <CrossIcon />
              </IconButton>
            )}
          </Pressable>
        )}
        {marketError && <Text style={[s.error, st.under]}>{marketError}</Text>}

        <View style={[{ gap: 14, flexGrow: 1 }, !market && { opacity: 0.4 }]}>
          <View style={{ gap: 7 }}>
            <Pressable accessibilityRole="button" onPress={() => setModeSheet(true)} style={st.modeChip}>
              <Text style={st.modeChipKey}>Mode</Text>
              <Text style={st.modeChipValue}>{chipLabel}</Text>
              <Chevron />
            </Pressable>
            {customError && <Text style={[s.error, st.under]}>{customError}</Text>}
            {wideFirst && <Text style={[s.error, st.under]}>{WIDE_FIRST_RUNG}</Text>}
            {young && (
              <Pressable accessibilityRole="button" onPress={() => setMode("launch")}>
                <Text style={[s.small, st.under, { color: colors.text }]}>
                  {launchLabel} · {SUGGESTED}
                </Text>
              </Pressable>
            )}
          </View>

          <View style={st.amount} accessible accessibilityLabel="Amount (SOL)" accessibilityValue={{ text: `${amountText || "0"} SOL` }}>
            <Text style={[st.amountNum, !amountText && { color: colors.faint }]} numberOfLines={1} adjustsFontSizeToFit>
              {amountText || "0"}
              <Text style={st.amountUnit}> SOL</Text>
            </Text>
            {usdPerSol !== null && amount !== null && !amountProblem && (
              <Text style={st.usd}>≈ {usdText(lamportsToUsd(amount, usdPerSol))}</Text>
            )}
            {amountSub && <Text style={[st.amountSub, amountSub.error && { color: colors.bad }]}>{amountSub.text}</Text>}
            {shortOfSol && plan && <Text style={[st.amountSub, { color: colors.bad }]}>Not enough SOL in the wallet for this buy.</Text>}
          </View>

          <View style={st.presets}>
            {PRESETS.map((p) => {
              const on = amount !== null && parseSol(p) === amount;
              return (
                <Pressable
                  key={p}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    touched.current = true;
                    setAmountText(p);
                  }}
                  style={[st.preset, on && st.presetOn]}
                >
                  <Text style={st.presetText}>{p}</Text>
                </Pressable>
              );
            })}
          </View>

          <Keypad
            onKey={(k) => {
              touched.current = true;
              setAmountText((t) => pressKey(t, k));
            }}
          />
        </View>
      </ScrollView>

      <Footer>
        {props.error && <Text style={s.error}>{props.error}</Text>}
        {plan && market && (
          <View style={{ gap: 2 }}>
            {/* The wallet shows what leaves when the order opens, not what returns seconds later: say its number
                here first, so it is no surprise there (Buğra, Nov 27). */}
            <View style={st.feeRow}>
              {cost && <Text style={st.walletLine}>{walletLine(cost.total, cost.back)}</Text>}
              <LinkButton label="Details" onPress={() => setDetails(true)} />
            </View>
            <Text style={st.feeText}>
              Max fee <Text style={st.feeValue}>{sol(maxFeeIfNoFill(plan))}</Text>
            </Text>
          </View>
        )}
        <Button
          label={noToken ? "Paste" : "Buy once"}
          onPress={noToken ? () => void paste() : buy}
          disabled={noToken ? props.busy : !!reason || props.busy}
        />
        {!props.user && <Text style={[s.small, { textAlign: "center" }]}>The button connects your wallet first.</Text>}
      </Footer>

      <Sheet visible={modeSheet} onClose={() => setModeSheet(false)} title="Mode" avoidKeyboard>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 2 }}>
          {MODE_OPTIONS.map((o) => {
            const on = mode === o.mode;
            return (
              <Pressable
                key={o.mode}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                onPress={() => {
                  touched.current = true;
                  setMode(o.mode);
                  if (o.mode !== "custom") setModeSheet(false);
                }}
                style={[st.modeRow, on && { backgroundColor: colors.raise }]}
              >
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={st.modeRowLabel}>{o.label}</Text>
                  <Text style={s.small}>{MODE_FOR[o.mode]}</Text>
                  {o.mode === "launch" && young && <Text style={[s.small, { color: colors.text }]}>{SUGGESTED}</Text>}
                </View>
                <View style={[st.radio, on && st.radioOn]} />
              </Pressable>
            );
          })}
          {mode === "custom" && (
            <View style={{ gap: 8, paddingHorizontal: 12, paddingTop: 6, paddingBottom: 4 }}>
              <Text style={s.small}>Rungs in percent, increasing; the last one is your cap (at most 30%).</Text>
              <CustomRungs
                text={customText}
                onChange={(t) => {
                  touched.current = true;
                  setCustomText(t);
                }}
              />
              {"error" in custom && <Text style={s.error}>{custom.error}</Text>}
              {"rungs" in custom && custom.rungs[0] >= 2000 && <Text style={s.error}>{WIDE_FIRST_RUNG}</Text>}
            </View>
          )}
        </ScrollView>
      </Sheet>

      <Sheet visible={details} onClose={() => setDetails(false)} title="Details">
        <ScrollView contentContainerStyle={{ gap: 9 }}>
          {detailLines.map((t, i) => (
            <Text key={i} style={i === 0 ? st.detailFirst : st.detail}>
              {t}
            </Text>
          ))}
        </ScrollView>
      </Sheet>

      <Sheet visible={walletSheet && !!props.user} onClose={() => setWalletSheet(false)}>
        {props.user && (
          <View style={{ gap: 10 }}>
            <Text style={st.walletFull}>
              Wallet {shortAddress(props.user.toBase58())}
              {balance !== null ? ` · ${sol(balance)}` : ""}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setWalletSheet(false);
                props.onDisconnect();
              }}
              style={{ paddingVertical: 8 }}
            >
              <Text style={st.disconnect}>Disconnect</Text>
            </Pressable>
          </View>
        )}
      </Sheet>

      <WalletWaitSheet visible={props.busy} />
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  walletChip: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    justifyContent: "center",
  },
  walletChipText: { fontSize: 12, color: colors.text, fontFamily: "monospace" },
  tokenCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 18,
  },
  tokenEmpty: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingLeft: 16,
    paddingRight: 8,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.faint,
    borderRadius: 18,
  },
  tokenEmptyLabel: { fontSize: 12, color: colors.muted },
  addressInput: { fontSize: 16, color: colors.text, padding: 0, margin: 0 },
  under: { paddingLeft: 4, marginTop: -6 },
  modeChip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingLeft: 14,
    paddingRight: 12,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  modeChipKey: { fontSize: 12, color: colors.muted },
  modeChipValue: { fontSize: 14, fontWeight: "500", color: colors.text },
  // On a tall screen the room left over is shared: half opens up the amount, half goes to the keys
  // (Buğra, Nov 27; before, the keys took all of it).
  amount: { flexGrow: 1, alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 6 },
  amountNum: { fontSize: 54, fontWeight: "600", color: colors.text, letterSpacing: -1, fontVariant: ["tabular-nums"] },
  amountUnit: { fontSize: 20, fontWeight: "600", color: colors.muted, letterSpacing: 0 },
  usd: { fontSize: 14, fontWeight: "500", color: colors.text, fontVariant: ["tabular-nums"] },
  amountSub: { minHeight: 18, fontSize: 12.5, color: colors.muted, textAlign: "center", fontVariant: ["tabular-nums"] },
  presets: { flexDirection: "row", gap: 8 },
  preset: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  presetOn: { borderColor: colors.text, backgroundColor: colors.raise },
  presetText: { fontSize: 14.5, fontWeight: "600", color: colors.text, fontVariant: ["tabular-nums"] },
  feeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  feeText: { flexShrink: 1, fontSize: 13.5, color: colors.muted },
  walletLine: { flexShrink: 1, fontSize: 13.5, fontWeight: "600", color: colors.text, fontVariant: ["tabular-nums"] },
  feeValue: { fontWeight: "600", color: colors.text },
  modeRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 16 },
  modeRowLabel: { fontSize: 15, fontWeight: "600", color: colors.text },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.faint },
  radioOn: { borderColor: colors.text, backgroundColor: colors.raise, borderWidth: 6 },
  customInput: {
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  detailFirst: { fontSize: 13, lineHeight: 18, color: colors.text, fontWeight: "500" },
  detail: { fontSize: 13, lineHeight: 18, color: colors.muted },
  walletFull: { fontSize: 13, color: colors.muted, fontFamily: "monospace" },
  disconnect: { fontSize: 15, fontWeight: "600", color: colors.bad },
});
