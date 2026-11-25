import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { LadderEvent, findEvent } from "../../../client/src";

import { bpsText, pctText, priceText } from "../flow/format";
import { Receipt } from "../flow/history";
import { Running, paidAboveSeenPct, runOrder } from "../flow/ladder";
import { Header, TokenLine, TxLinkText, colors, s } from "./ui";

type RungState =
  | { kind: "waiting" }
  | { kind: "trying" }
  | { kind: "slipped" }
  | { kind: "filled"; abovePct: number }
  | { kind: "failed"; text: string }
  | { kind: "not-needed" }
  | { kind: "not-tried" };

function stateText(st: RungState): string {
  switch (st.kind) {
    case "waiting":
      return "waiting";
    case "trying":
      return "trying…";
    case "slipped":
      return "price was above this rung";
    case "filled":
      return st.abovePct >= 0
        ? `bought, ${pctText(st.abovePct)} above the price you saw`
        : `bought, ${pctText(-st.abovePct)} below the price you saw`;
    case "failed":
      return `did not go through (${st.text})`;
    case "not-needed":
      return "not needed";
    case "not-tried":
      return "not tried, the order ran out of time";
  }
}

export function LadderScreen({ running, onDone }: { running: Running; onDone: (r: Receipt | null, error?: string) => void }) {
  const p = running.pending;
  const [states, setStates] = useState<RungState[]>(p.rungsBps.map(() => ({ kind: "waiting" })));
  const [links, setLinks] = useState<{ label: string; signature: string }[]>(
    [...(p.openSignature ? [{ label: "approval", signature: p.openSignature }] : []), ...(p.attempts ?? [])],
  );
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const amount = BigInt(p.amount);
    const seen = BigInt(p.expectedTokensSeen);
    const onEvent = (e: LadderEvent) => {
      if (e.type === "sent") {
        const label = e.kind === "try" ? `try ${bpsText(p.rungsBps[e.rungIndex ?? 0])}` : e.kind === "refund" ? "refund" : "unused fees back";
        setLinks((l) => [...l, { label, signature: e.signature }]);
        if (e.kind === "try" && e.rungIndex !== undefined) {
          const i = e.rungIndex;
          setStates((st) => st.map((x, j) => (j === i ? { kind: "trying" } : x)));
        }
      }
      if (e.type === "result" && e.attempt.kind === "try" && e.attempt.rungIndex !== undefined) {
        const a = e.attempt;
        const i = a.rungIndex!;
        setStates((st) =>
          st.map((x, j) => {
            if (j === i) {
              if (a.outcome === "filled") {
                const f = findEvent(a.logs ?? [], "OrderFilled");
                return { kind: "filled", abovePct: f ? paidAboveSeenPct(amount, seen, f.lamportsSpent, f.tokensBought) : 0 };
              }
              if (a.outcome === "slippage") return { kind: "slipped" };
              if (a.outcome === "order-filled") return { kind: "not-needed" };
              return { kind: "failed", text: a.outcome };
            }
            if (j > i && (a.outcome === "filled" || a.outcome === "order-filled")) return { kind: "not-needed" };
            return x;
          }),
        );
      }
      if ((e.type === "result" && e.attempt.kind === "refund") || (e.type === "sent" && e.kind === "refund")) {
        setStates((st) => st.map((x) => (x.kind === "waiting" ? { kind: "not-tried" } : x)));
      }
    };
    runOrder(running, onEvent)
      .then((receipt) => {
        if (receipt.filledRungIndex !== undefined && receipt.tokensBought && receipt.lamportsSpent) {
          const above = paidAboveSeenPct(amount, seen, BigInt(receipt.lamportsSpent), BigInt(receipt.tokensBought));
          setStates((st) => st.map((x, j) => (j === receipt.filledRungIndex ? { kind: "filled", abovePct: above } : x)));
        }
        // A moment on the finished ladder before the receipt.
        setTimeout(() => onDone(receipt), 2500);
      })
      .catch((e) => onDone(null, (e as Error).message));
  }, []);

  // Narrowest rung at the bottom: the ladder climbs up.
  const order = p.rungsBps.map((bps, i) => ({ bps, i })).reverse();
  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={s.content}>
        <Header />
        <TokenLine mint={p.mint} />
        <Text style={s.body}>Price you saw: {priceText(BigInt(p.amount), BigInt(p.expectedTokensSeen), p.decimals)}</Text>
        <View style={[s.box, { gap: 10 }]}>
          {order.map(({ bps, i }) => {
            const st = states[i];
            const color = st.kind === "filled" ? colors.good : st.kind === "slipped" || st.kind === "failed" ? colors.bad : colors.text;
            return (
              <View key={i} style={{ flexDirection: "row", gap: 12, alignItems: "baseline" }}>
                <Text style={[s.body, { width: 76, fontWeight: "600" }]}>try {bpsText(bps)}</Text>
                <Text style={[s.body, { flex: 1, color }]}>{stateText(st)}</Text>
              </View>
            );
          })}
        </View>
        <Text style={s.small}>Rung climbs for you, automatically</Text>
        <View style={{ marginTop: 8 }}>
          {links.map((l) => (
            <TxLinkText key={l.signature} label={l.label} signature={l.signature} />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
