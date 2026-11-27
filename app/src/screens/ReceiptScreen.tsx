import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { bpsText, priceText, shortAddress, sol, tokens } from "../flow/format";
import { Receipt, accumulatorLabel } from "../flow/history";
import { useTokenInfo } from "../flow/tokenInfo";
import { paidAboveSeenPct } from "../flow/ladder";
import { signedPctText } from "../percent";
import { tokenTitle } from "../tokenLabel";
import { Button, CheckIcon, Footer, Header, LinkButton, Row, TxLinkText, colors, s } from "./ui";

/** The links of a receipt, approval first. */
export function TxLinks({ r }: { r: Receipt }) {
  return (
    <View style={{ gap: 5 }}>
      {r.transactions.map((t) => (
        <TxLinkText key={t.signature} label={t.label} signature={t.signature} outcome={t.outcome} />
      ))}
    </View>
  );
}

/** What most buyers type, as the line's end. */
const TYPICAL_BPS = 2000;

/** The 20% / needed line: a red hatched track to 20%, green up to the rung that filled. */
function GapLine({ neededBps }: { neededBps: number }) {
  const share = neededBps / TYPICAL_BPS;
  return (
    <View style={st.gapViz} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={st.gapTrack}>
        {Array.from({ length: 40 }, (_, i) => (
          <View key={i} style={[st.hatch, { left: i * 12 - 8 }]} />
        ))}
      </View>
      <View style={[st.gapNeed, { width: `${share * 100}%` }]} />
      <Text style={[st.tick, { left: 0 }]}>0</Text>
      {share <= 0.8 && <Text style={[st.tick, { left: `${share * 100}%` }]}>{bpsText(neededBps)}</Text>}
      <Text style={[st.tick, { right: 0 }]}>{bpsText(TYPICAL_BPS)}</Text>
    </View>
  );
}

export function ReceiptScreen({
  r,
  onNew,
  onHistory,
  onSell,
}: {
  r: Receipt;
  onNew: () => void;
  onHistory: () => void;
  /** Opens the sale of what was just bought; absent when no wallet is connected. */
  onSell?: () => void;
}) {
  const amount = BigInt(r.amount);
  const seen = BigInt(r.expectedTokensSeen);
  const spent = BigInt(r.lamportsSpent ?? "0");
  const bought = BigInt(r.tokensBought ?? "0");
  const diff = bought > 0n ? paidAboveSeenPct(amount, seen, spent, bought) : 0;
  const title = tokenTitle(useTokenInfo(r.mint));
  const filledBps = r.filledRungBps ?? 0;
  const fees = BigInt(r.rungFees) + BigInt(r.approvalFee ?? "0");
  const [details, setDetails] = useState(false);
  return (
    <SafeAreaView style={s.screen}>
      <Header />
      <ScrollView contentContainerStyle={s.content}>
        <View style={st.done}>
          <CheckIcon />
          <View style={{ flexShrink: 1, gap: 2 }}>
            <Text style={st.doneTitle}>Bought {title || shortAddress(r.mint)}</Text>
            {title ? <Text style={s.addrSmall}>{shortAddress(r.mint)}</Text> : null}
          </View>
        </View>

        <View style={{ gap: 2 }}>
          <Text style={s.small}>Tokens bought</Text>
          <Text style={st.bigValue} numberOfLines={1} adjustsFontSizeToFit>
            {tokens(bought, r.decimals)}
          </Text>
        </View>

        <View style={s.card}>
          <Text style={st.gapTitle}>Most buyers type: 20% · This buy needed: {bpsText(filledBps)}</Text>
          {/* At 20% and above (Launch) the line would show nothing true: only the sentences. */}
          {filledBps > 0 && filledBps < TYPICAL_BPS && <GapLine neededBps={filledBps} />}
          <Text style={s.small}>The gap is what a sandwich bot can take from you.</Text>
        </View>

        <View>
          <Row label="Rung that filled" value={`try ${bpsText(filledBps)}`} />
          <Row label="SOL spent on the buy" value={sol(spent)} />
          <Row label="Fees" value={sol(fees)} last />
        </View>

        <LinkButton label="Details" onPress={() => setDetails(!details)} />
        {details && (
          <View>
            <Row label="Price you saw" value={priceText(amount, seen, r.decimals)} />
            <Row label="Price you paid" value={priceText(spent, bought, r.decimals)} />
            <Row label="Difference" value={signedPctText(diff)} />
            <Row label="Fees for the tries" value={sol(BigInt(r.rungFees))} />
            <Row label="approval fee (set by your wallet)" value={r.approvalFee ? sol(BigInt(r.approvalFee)) : "unknown"} />
            {r.userTokenAccountDeposit !== "0" && (
              <Row label="your token account deposit" value={sol(BigInt(r.userTokenAccountDeposit))} />
            )}
            {r.accumulatorDeposit !== "0" && <Row label={accumulatorLabel(r)} value={sol(BigInt(r.accumulatorDeposit))} />}
            {r.orderDeposit !== "0" && (
              <Row label="order record deposit (returns when the order closes)" value={sol(BigInt(r.orderDeposit))} />
            )}
          </View>
        )}

        <TxLinks r={r} />
      </ScrollView>
      <Footer>
        <Button label="Go to home" onPress={onNew} />
        <View style={{ flexDirection: "row", gap: 8 }}>
          {onSell && <Button label="Sell" kind="secondary" onPress={onSell} style={{ flex: 1 }} />}
          <Button label="History" kind="secondary" onPress={onHistory} style={{ flex: 1 }} />
        </View>
      </Footer>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  done: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 4 },
  doneTitle: { fontSize: 18, fontWeight: "600", lineHeight: 23, color: colors.text },
  bigValue: { fontSize: 40, fontWeight: "700", letterSpacing: -0.8, color: colors.text, fontVariant: ["tabular-nums"] },
  gapTitle: { fontSize: 15, fontWeight: "600", lineHeight: 20, color: colors.text },
  gapViz: { height: 38 },
  gapTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 4,
    height: 14,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: "rgba(242, 116, 116, 0.45)",
    overflow: "hidden",
  },
  hatch: { position: "absolute", top: -6, width: 6, height: 26, backgroundColor: colors.badSoft, transform: [{ rotate: "45deg" }] },
  gapNeed: {
    position: "absolute",
    left: 0,
    top: 4,
    height: 14,
    minWidth: 10,
    borderTopLeftRadius: 7,
    borderBottomLeftRadius: 7,
    backgroundColor: colors.good,
  },
  tick: { position: "absolute", top: 23, fontSize: 11, color: colors.muted, fontVariant: ["tabular-nums"] },
});
