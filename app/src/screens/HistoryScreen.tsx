import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { bpsText, priceText, shortAddress, sol } from "../flow/format";
import { Receipt, loadHistory, venueName } from "../flow/history";
import { TxLinks } from "./ReceiptScreen";
import { Button, Header, Row, s } from "./ui";

const MODE_NAMES: Record<string, string> = { tight: "Tight", normal: "Normal", fast: "Fast", launch: "Launch", custom: "Custom" };

/** Reads only local storage: works without a network. */
export function HistoryScreen({ onBack }: { onBack: () => void }) {
  const [list, setList] = useState<Receipt[] | null>(null);
  useEffect(() => {
    loadHistory().then(setList);
  }, []);
  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={s.content}>
        <Header />
        <Text style={s.h2}>History</Text>
        {list === null && <Text style={s.small}>Loading…</Text>}
        {list?.length === 0 && <Text style={s.small}>No buys yet.</Text>}
        {list?.map((r) => {
          const amount = BigInt(r.amount);
          const seen = BigInt(r.expectedTokensSeen);
          const filled = r.outcome === "filled" && r.tokensBought && r.lamportsSpent;
          const fees = BigInt(r.rungFees) + BigInt(r.approvalFee ?? "0");
          return (
            <View key={r.id} style={s.box}>
              <Text style={s.small}>{new Date(r.time).toLocaleString()}</Text>
              <Row label="Token" value={shortAddress(r.mint)} />
              <Row label="Venue" value={venueName(r)} />
              <Row label="Mode" value={`${MODE_NAMES[r.mode] ?? r.mode} (${r.rungsBps.map(bpsText).join(", ")})`} />
              <Row label="Rung" value={filled ? `try ${bpsText(r.filledRungBps ?? 0)}` : "not bought"} />
              <Row label="Price you saw" value={priceText(amount, seen, r.decimals)} />
              {filled && (
                <Row label="Price you paid" value={priceText(BigInt(r.lamportsSpent!), BigInt(r.tokensBought!), r.decimals)} />
              )}
              <Row label="Fees" value={sol(fees)} />
              <TxLinks r={r} />
            </View>
          );
        })}
        <Button label="Back" kind="secondary" onPress={onBack} />
      </ScrollView>
    </SafeAreaView>
  );
}
