import { ScrollView, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { pctText, shortAddress, sol } from "../flow/format";
import { Receipt } from "../flow/history";
import { TxLinks } from "./ReceiptScreen";
import { Button, Header, s } from "./ui";

export const NOT_BOUGHT = "Price went above your cap. Not bought. Your SOL is back.";

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
  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={s.content}>
        <Header />
        <Text style={s.body}>Token {shortAddress(r.mint)}</Text>
        {r.outcome === "not-bought" ? (
          <Text style={[s.body, { fontWeight: "600" }]}>{NOT_BOUGHT}</Text>
        ) : (
          <Text style={[s.body, { fontWeight: "600" }]}>
            Not bought, and the refund was not seen yet. Open the links below to check.
          </Text>
        )}
        {above !== undefined && (
          <Text style={s.body}>
            After the last try the price was {pctText(Math.abs(above))} {above >= 0 ? "above" : "below"} the price you saw.
          </Text>
        )}
        <Text style={s.body}>Fees: {sol(fees)}.</Text>
        <Text style={s.small}>
          (tries and refund {sol(BigInt(r.rungFees))}, approval fee set by your wallet{" "}
          {r.approvalFee ? sol(BigInt(r.approvalFee)) : "unknown"})
        </Text>
        <TxLinks r={r} />
        <Button label={r.mode === "launch" ? "Retry" : "Retry with Launch mode"} onPress={props.onRetry} disabled={props.busy} />
        {props.busy && <Text style={s.small}>Waiting for your wallet…</Text>}
        {props.error && <Text style={s.error}>{props.error}</Text>}
        <Button label="New buy" kind="secondary" onPress={props.onNew} />
        <Button label="History" kind="secondary" onPress={props.onHistory} />
      </ScrollView>
    </SafeAreaView>
  );
}
