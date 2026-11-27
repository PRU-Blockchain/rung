import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { Mode } from "../../../client/src";
import { bpsText, pctText, sol } from "../flow/format";
import { Receipt } from "../flow/history";
import { MODE_OPTIONS } from "../flow/plan";
import { MODE_FOR } from "./BuyScreen";
import { capScale } from "./capScale";
import { TxLinks } from "./ReceiptScreen";
import { Button, Footer, Header, LinkButton, Row, Sheet, TokenLine, WalletWaitSheet, colors, modeLabel, s } from "./ui";

const PRICE_ABOVE_CAP = "Price went above your cap.";
const SOL_IS_BACK = "Not bought. Your SOL is back.";
export const NOT_BOUGHT = `${PRICE_ABOVE_CAP} ${SOL_IS_BACK}`;

/** The modes a retry can pick: the four ladders. A custom ladder is set on the buy screen. */
const RETRY_MODES = MODE_OPTIONS.filter((o) => o.mode !== "custom");

/** The heading in two parts, the reason small and "Not bought…" big; same words as before. */
function heading(r: Receipt): { small?: string; big: string; after?: string } {
  if (r.outcome === "not-bought" && !r.transactions.some((t) => t.label.startsWith("try"))) {
    return { small: "The order ran out of time before any rung was tried.", big: SOL_IS_BACK };
  }
  if (r.outcome === "not-bought") return { small: PRICE_ABOVE_CAP, big: SOL_IS_BACK };
  return { big: "Not bought, and the refund was not seen yet.", after: "Open the links below to check." };
}

/**
 * The cap and where the price went, on one line: green up to the cap (what you allowed), red hatching from the cap to
 * the price after the last try. Drawn only when that price is known and above the cap.
 */
function CapLine({ capBps, abovePct }: { capBps: number; abovePct: number }) {
  const at = capScale(capBps, abovePct);
  if (!at) return null;
  const pc = (x: number) => `${x * 100}%` as const;
  return (
    <View style={st.capViz} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={st.capTrack}>
        <View style={[st.capOver, { left: pc(at.cap), width: pc(at.price - at.cap) }]}>
          {Array.from({ length: 40 }, (_, i) => (
            <View key={i} style={[st.hatch, { left: i * 12 - 8 }]} />
          ))}
        </View>
        <View style={[st.capAllowed, { width: pc(at.cap) }]} />
      </View>
      <View style={[st.capMark, { left: pc(at.cap) }]} />
      <View style={[st.priceDot, { left: pc(at.price) }]} />
      <Text style={[st.tick, { right: pc(1 - at.cap), color: colors.text }]}>cap {bpsText(capBps)}</Text>
      <Text style={[st.tick, { left: pc(at.price), color: colors.bad }]}>+{pctText(abovePct)}</Text>
    </View>
  );
}

export function NotBoughtScreen(props: {
  r: Receipt;
  busy: boolean;
  error: string | null;
  /** A new order for the same token and amount, in the mode picked. */
  onRetry: (mode: Mode) => void;
  onNew: () => void;
  onHistory: () => void;
}) {
  const { r } = props;
  const fees = BigInt(r.rungFees) + BigInt(r.approvalFee ?? "0");
  const above = r.priceNowAbovePct;
  const h = heading(r);
  const capBps = r.rungsBps[r.rungsBps.length - 1] ?? 0;
  const refunded = r.outcome === "not-bought";
  const overCap = above !== undefined && capScale(capBps, above) !== null;
  const [details, setDetails] = useState(false);
  const [retry, setRetry] = useState(false);
  return (
    <SafeAreaView style={s.screen}>
      <Header />
      <ScrollView contentContainerStyle={s.content}>
        <View style={st.top}>
          <TokenLine mint={r.mint} sub={`${sol(BigInt(r.amount))} · ${modeLabel(r.mode, r.rungsBps)}`} />
        </View>

        <View style={{ gap: 6 }}>
          {h.small && <Text style={st.reason}>{h.small}</Text>}
          <Text style={st.big}>{h.big}</Text>
          {h.after && <Text style={st.reason}>{h.after}</Text>}
        </View>
        {/* "Open the links below to check": when the refund was not seen, the links stay on the screen itself. */}
        {!refunded && <TxLinks r={r} />}

        {/* One card per rung: tried and missed in red, not tried in grey. */}
        <View style={st.mini}>
          {r.rungsBps.map((bps) => {
            const label = `try ${bpsText(bps)}`;
            const tried = r.transactions.some((t) => t.label === label);
            return (
              <View key={bps} style={st.miniCard}>
                <View style={[st.miniBar, { backgroundColor: tried ? colors.bad : colors.line }]} />
                <Text style={[st.miniText, !tried && { color: colors.muted }]}>{label}</Text>
              </View>
            );
          })}
        </View>

        {/* The cap doing its job, in one picture; the sentence alone when the price is not above the cap any more. */}
        {above !== undefined && (
          <View style={s.card}>
            {overCap ? (
              <>
                <Text style={st.capTitle}>
                  Your cap: {bpsText(capBps)} · Price after the last try: +{pctText(above)}
                </Text>
                <CapLine capBps={capBps} abovePct={above} />
                <Text style={s.small}>Rung doesn't buy above your cap.</Text>
              </>
            ) : (
              <Text style={s.small}>
                After the last try the price was {pctText(Math.abs(above))} {above >= 0 ? "above" : "below"} the price you saw.
              </Text>
            )}
          </View>
        )}

        <View>
          {refunded && <Row label="Back in your wallet" value={sol(BigInt(r.amount))} />}
          <Row label="Fees" value={sol(fees)} last />
        </View>

        <LinkButton label="Details" onPress={() => setDetails(true)} />
      </ScrollView>
      <Footer>
        {props.error && <Text style={s.error}>{props.error}</Text>}
        <Button label="Retry" onPress={() => setRetry(true)} disabled={props.busy} />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button label="New buy" kind="secondary" onPress={props.onNew} style={{ flex: 1 }} />
          <Button label="History" kind="secondary" onPress={props.onHistory} style={{ flex: 1 }} />
        </View>
      </Footer>

      {/* Retry: pick a mode and the order goes, same token and amount. */}
      <Sheet visible={retry && !props.busy} onClose={() => setRetry(false)} title="Retry with">
        <Text style={[s.small, { paddingHorizontal: 12, paddingBottom: 6 }]}>
          Same token, same amount: {sol(BigInt(r.amount))}. Your wallet asks once.
        </Text>
        <View style={{ gap: 2 }}>
          {RETRY_MODES.map((o) => (
            <Pressable
              key={o.mode}
              accessibilityRole="button"
              onPress={() => {
                setRetry(false);
                props.onRetry(o.mode);
              }}
              style={({ pressed }) => [st.modeRow, pressed && { backgroundColor: colors.raise }]}
            >
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={st.modeRowLabel}>{o.label}</Text>
                <Text style={s.small}>{MODE_FOR[o.mode]}</Text>
              </View>
              {o.mode === r.mode && <Text style={st.tried}>just tried</Text>}
            </Pressable>
          ))}
        </View>
      </Sheet>

      <Sheet visible={details} onClose={() => setDetails(false)} title="Details">
        <ScrollView contentContainerStyle={{ gap: 12 }}>
          <View>
            <Row label="Fees for the tries and the refund" value={sol(BigInt(r.rungFees))} />
            <Row label="approval fee (set by your wallet)" value={r.approvalFee ? sol(BigInt(r.approvalFee)) : "unknown"} last />
          </View>
          <TxLinks r={r} />
        </ScrollView>
      </Sheet>

      <WalletWaitSheet visible={props.busy} />
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  top: { paddingTop: 6 },
  reason: { fontSize: 15, lineHeight: 21, color: colors.muted },
  big: { fontSize: 30, fontWeight: "800", lineHeight: 33, letterSpacing: -0.3, color: colors.text },
  mini: { flexDirection: "row", gap: 8 },
  miniCard: {
    flex: 1,
    gap: 6,
    padding: 10,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  miniBar: { height: 6, borderRadius: 3 },
  miniText: { fontSize: 12.5, fontWeight: "600", color: colors.text },
  capTitle: { fontSize: 15, fontWeight: "600", lineHeight: 20, color: colors.text },
  capViz: { height: 42 },
  capTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 6,
    height: 14,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  capAllowed: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: colors.good },
  capOver: { position: "absolute", top: 0, bottom: 0, overflow: "hidden", backgroundColor: "rgba(242, 116, 116, 0.10)" },
  hatch: { position: "absolute", top: -6, width: 6, height: 26, backgroundColor: colors.badSoft, transform: [{ rotate: "45deg" }] },
  capMark: { position: "absolute", top: 1, width: 2, height: 24, marginLeft: -1, borderRadius: 1, backgroundColor: colors.text },
  priceDot: {
    position: "absolute",
    top: 6,
    width: 14,
    height: 14,
    marginLeft: -7,
    borderRadius: 7,
    backgroundColor: colors.bad,
    borderWidth: 2,
    borderColor: colors.bg,
  },
  tick: { position: "absolute", top: 27, fontSize: 11, fontWeight: "600", fontVariant: ["tabular-nums"] },
  modeRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 16 },
  modeRowLabel: { fontSize: 15, fontWeight: "600", color: colors.text },
  tried: { fontSize: 12, color: colors.muted },
});
