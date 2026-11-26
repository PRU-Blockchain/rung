import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { bpsText, pctText, sol } from "../flow/format";
import { Receipt } from "../flow/history";
import { TxLinks } from "./ReceiptScreen";
import { Button, Footer, Header, LinkButton, ReturnIcon, TokenLine, WalletWaitSheet, colors, s } from "./ui";

const PRICE_ABOVE_CAP = "Price went above your cap.";
const SOL_IS_BACK = "Not bought. Your SOL is back.";
export const NOT_BOUGHT = `${PRICE_ABOVE_CAP} ${SOL_IS_BACK}`;

/** The heading in two parts, the reason small and "Not bought…" big; same words as before. */
function heading(r: Receipt): { small?: string; big: string; after?: string } {
  if (r.outcome === "not-bought" && !r.transactions.some((t) => t.label.startsWith("try"))) {
    return { small: "The order ran out of time before any rung was tried.", big: SOL_IS_BACK };
  }
  if (r.outcome === "not-bought") return { small: PRICE_ABOVE_CAP, big: SOL_IS_BACK };
  return { big: "Not bought, and the refund was not seen yet.", after: "Open the links below to check." };
}

export function NotBoughtScreen(props: {
  r: Receipt;
  busy: boolean;
  error: string | null;
  onRetry: () => void;
  onNew: () => void;
  onHistory: () => void;
}) {
  const { r } = props;
  const fees = BigInt(r.rungFees) + BigInt(r.approvalFee ?? "0");
  const above = r.priceNowAbovePct;
  const h = heading(r);
  const [details, setDetails] = useState(false);
  return (
    <SafeAreaView style={s.screen}>
      <Header />
      <ScrollView contentContainerStyle={s.content}>
        <View style={{ gap: 14, paddingTop: 6 }}>
          <ReturnIcon />
          <TokenLine mint={r.mint} />
          <View style={{ gap: 6 }}>
            {h.small && <Text style={st.reason}>{h.small}</Text>}
            <Text style={st.big}>{h.big}</Text>
            {h.after && <Text style={st.reason}>{h.after}</Text>}
          </View>
        </View>

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

        <Text style={st.fees}>Fees: {sol(fees)}.</Text>
        <LinkButton label="Details" onPress={() => setDetails(!details)} />
        {details && (
          <View style={{ gap: 6 }}>
            {above !== undefined && (
              <Text style={s.small}>
                After the last try the price was {pctText(Math.abs(above))} {above >= 0 ? "above" : "below"} the price you saw.
              </Text>
            )}
            <Text style={s.small}>
              (tries and refund {sol(BigInt(r.rungFees))}, approval fee set by your wallet{" "}
              {r.approvalFee ? sol(BigInt(r.approvalFee)) : "unknown"})
            </Text>
          </View>
        )}
        <TxLinks r={r} />
      </ScrollView>
      <Footer>
        {props.error && <Text style={s.error}>{props.error}</Text>}
        <Button label={r.mode === "launch" ? "Retry" : "Retry with Launch mode"} onPress={props.onRetry} disabled={props.busy} />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button label="New buy" kind="secondary" onPress={props.onNew} style={{ flex: 1 }} />
          <Button label="History" kind="secondary" onPress={props.onHistory} style={{ flex: 1 }} />
        </View>
      </Footer>
      <WalletWaitSheet visible={props.busy} />
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
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
  fees: { fontSize: 14, lineHeight: 20, color: colors.text },
});
