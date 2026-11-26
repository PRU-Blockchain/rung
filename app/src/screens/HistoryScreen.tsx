import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { bpsText, priceText, shortAddress, sol } from "../flow/format";
import { Receipt, loadHistory, sortOldReceipts, venueName } from "../flow/history";
import { useTokenInfo } from "../flow/tokenInfo";
import { tokenTitle } from "../tokenLabel";
import { TxLinks } from "./ReceiptScreen";
import { Button, Chevron, Footer, IconButton, Row, TokenRow, colors, s } from "./ui";

const MODE_NAMES: Record<string, string> = { tight: "Tight", normal: "Normal", fast: "Fast", launch: "Launch", custom: "Custom" };

/** One buy: a dot, the token, mode and date, the result; tapping it opens the rows and the links. */
function HistoryItem({ r }: { r: Receipt }) {
  const [open, setOpen] = useState(false);
  const title = tokenTitle(useTokenInfo(r.mint));
  const amount = BigInt(r.amount);
  const seen = BigInt(r.expectedTokensSeen);
  const filled = r.outcome === "filled" && r.tokensBought && r.lamportsSpent;
  const fees = BigInt(r.rungFees) + BigInt(r.approvalFee ?? "0");
  const mode = MODE_NAMES[r.mode] ?? r.mode;
  const result = filled ? `try ${bpsText(r.filledRungBps ?? 0)}` : "not bought";
  return (
    <View style={st.item}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={st.itemRow}
      >
        <View style={[st.dot, { backgroundColor: filled ? colors.good : colors.bad }]} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={st.itemTitle} numberOfLines={1}>
            {title || shortAddress(r.mint)}
          </Text>
          <Text style={st.itemSub}>
            {mode} · {new Date(r.time).toLocaleDateString()}
          </Text>
        </View>
        <Text style={st.itemResult}>{result}</Text>
        <Chevron dir={open ? "up" : "down"} />
      </Pressable>
      {open && (
        <View style={st.itemBody}>
          <Text style={s.small}>{new Date(r.time).toLocaleString()}</Text>
          <TokenRow mint={r.mint} />
          <Row label="Venue" value={venueName(r)} />
          <Row label="Mode" value={`${mode} (${r.rungsBps.map(bpsText).join(", ")})`} />
          <Row label="Rung" value={result} />
          <Row label="Price you saw" value={priceText(amount, seen, r.decimals)} />
          {filled && (
            <Row label="Price you paid" value={priceText(BigInt(r.lamportsSpent!), BigInt(r.tokensBought!), r.decimals)} />
          )}
          <Row label="Fees" value={sol(fees)} last />
          <TxLinks r={r} />
        </View>
      )}
    </View>
  );
}

/** Reads only local storage: works without a network. (Old receipts are sorted by network once, when there is one.) */
export function HistoryScreen({ onBack }: { onBack: () => void }) {
  const [list, setList] = useState<Receipt[] | null>(null);
  useEffect(() => {
    let live = true;
    const show = () => loadHistory().then((l) => live && setList(l));
    void show().then(() => sortOldReceipts().then((changed) => changed && show()));
    return () => {
      live = false;
    };
  }, []);
  return (
    <SafeAreaView style={s.screen}>
      <View style={[s.topbar, { paddingLeft: 4 }]}>
        <IconButton label="Back" onPress={onBack}>
          <Chevron dir="left" size={22} color={colors.text} />
        </IconButton>
        <Text style={s.topTitle} accessibilityRole="header">
          History
        </Text>
      </View>
      <ScrollView contentContainerStyle={[s.content, { gap: 8 }]}>
        {list === null && <Text style={s.small}>Loading…</Text>}
        {list?.length === 0 && <Text style={s.small}>No buys yet.</Text>}
        {list?.map((r) => <HistoryItem key={r.id} r={r} />)}
      </ScrollView>
      <Footer>
        <Button label="Back" kind="secondary" onPress={onBack} />
      </Footer>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  item: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, backgroundColor: colors.surface },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  itemTitle: { fontSize: 14, fontWeight: "600", color: colors.text },
  itemSub: { fontSize: 12, color: colors.muted },
  itemResult: { fontSize: 13, fontWeight: "600", color: colors.text },
  itemBody: { paddingHorizontal: 12, paddingBottom: 10, gap: 0 },
});
