import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { bpsText, pctText, priceText, shortAddress, sol, tokens } from "../flow/format";
import { Receipt, accumulatorLabel } from "../flow/history";
import { paidAboveSeenPct } from "../flow/ladder";
import { Button, Header, Row, TxLinkText, s } from "./ui";

/** The links of a receipt, approval first. */
export function TxLinks({ r }: { r: Receipt }) {
  return (
    <View>
      {r.transactions.map((t) => (
        <TxLinkText key={t.signature} label={t.label} signature={t.signature} outcome={t.outcome} />
      ))}
    </View>
  );
}

export function ReceiptScreen({ r, onNew, onHistory }: { r: Receipt; onNew: () => void; onHistory: () => void }) {
  const amount = BigInt(r.amount);
  const seen = BigInt(r.expectedTokensSeen);
  const spent = BigInt(r.lamportsSpent ?? "0");
  const bought = BigInt(r.tokensBought ?? "0");
  const diff = bought > 0n ? paidAboveSeenPct(amount, seen, spent, bought) : 0;
  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={s.content}>
        <Header />
        <Text style={[s.body, { fontWeight: "600" }]}>Bought {shortAddress(r.mint)}</Text>
        <View style={s.box}>
          <Row label="Price you saw" value={priceText(amount, seen, r.decimals)} />
          <Row label="Price you paid" value={priceText(spent, bought, r.decimals)} />
          <Row label="Difference" value={`${diff >= 0 ? "+" : "-"}${pctText(Math.abs(diff))}`} />
          <Row label="Rung that filled" value={`try ${bpsText(r.filledRungBps ?? 0)}`} />
          <Row label="Tokens bought" value={tokens(bought, r.decimals)} />
          <Row label="SOL spent on the buy" value={sol(spent)} />
        </View>

        <View style={s.box}>
          <Text style={s.h2}>Most buyers type: 20% · This buy needed: {bpsText(r.filledRungBps ?? 0)}</Text>
          <Text style={s.small}>The gap is what a sandwich bot can take from you.</Text>
        </View>

        <View style={s.box}>
          <Row label="Fees for the tries" value={sol(BigInt(r.rungFees))} />
          <Row label="approval fee (set by your wallet)" value={r.approvalFee ? sol(BigInt(r.approvalFee)) : "unknown"} />
          {r.userTokenAccountDeposit !== "0" && (
            <Row label="your token account deposit" value={sol(BigInt(r.userTokenAccountDeposit))} />
          )}
          {r.accumulatorDeposit !== "0" && (
            <Row label={accumulatorLabel(r)} value={sol(BigInt(r.accumulatorDeposit))} />
          )}
          {r.orderDeposit !== "0" && (
            <Row label="order record deposit (returns when the order closes)" value={sol(BigInt(r.orderDeposit))} />
          )}
        </View>

        <TxLinks r={r} />
        <Button label="New buy" onPress={onNew} />
        <Button label="History" kind="secondary" onPress={onHistory} />
      </ScrollView>
    </SafeAreaView>
  );
}
