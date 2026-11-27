import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, Vibration, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { LadderEvent, findEvent } from "../../../client/src";

import { bpsText, sol } from "../flow/format";
import { Receipt } from "../flow/history";
import { Running, paidAboveSeenPct, runOrder } from "../flow/ladder";
import { signedPctText } from "../percent";
import { vibrationFor } from "./ladderHaptics";
import { Header, TokenLine, TxLinkText, colors, modeLabel, s } from "./ui";

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
      return "missed";
    case "filled": {
      // "bought · +2.28%"; just "bought" when the difference rounds to nothing.
      const diff = signedPctText(st.abovePct);
      return diff === "0%" ? "bought" : `bought · ${diff}`;
    }
    case "failed":
      return `did not go through (${st.text})`;
    case "not-needed":
      return "not needed";
    case "not-tried":
      return "not tried";
  }
}

/** The rung's bar: yellow while tried, green when it bought, red when it missed, dashed when not used. */
function barStyle(st: RungState) {
  switch (st.kind) {
    case "trying":
      return { bar: { backgroundColor: colors.accent }, halo: colors.accentSoft, text: colors.text };
    case "filled":
      return { bar: { backgroundColor: colors.good }, halo: colors.goodSoft, text: colors.good };
    case "slipped":
    case "failed":
      return { bar: { backgroundColor: colors.bad }, halo: null, text: colors.bad };
    case "not-needed":
    case "not-tried":
      return {
        bar: { backgroundColor: "transparent", borderWidth: 1.5, borderStyle: "dashed" as const, borderColor: colors.line },
        halo: null,
        text: colors.muted,
      };
    default:
      return { bar: { backgroundColor: colors.line }, halo: null, text: colors.muted };
  }
}

export function LadderScreen({ running, onDone }: { running: Running; onDone: (r: Receipt | null, error?: string) => void }) {
  const p = running.pending;
  const [states, setStates] = useState<RungState[]>(p.rungsBps.map(() => ({ kind: "waiting" })));
  const [links, setLinks] = useState<{ label: string; signature: string; outcome?: string }[]>(
    [...(p.openSignature ? [{ label: "approval", signature: p.openSignature }] : []), ...(p.attempts ?? [])],
  );
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const amount = BigInt(p.amount);
    const seen = BigInt(p.expectedTokensSeen);
    const onEvent = (e: LadderEvent) => {
      // In the hand: a tick at each try, two pulses at a buy, one longer pulse at a refund.
      const buzz = vibrationFor(e);
      if (buzz !== null) Vibration.vibrate(buzz);
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
        // The missed try's link says so too.
        if (a.outcome === "slippage") {
          setLinks((l) => l.map((x) => (x.signature === a.signature ? { ...x, outcome: a.outcome } : x)));
        }
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
  const rowHeight = p.rungsBps.length > 3 ? 62 : 78;
  return (
    <SafeAreaView style={s.screen}>
      <Header />
      <ScrollView contentContainerStyle={s.content}>
        <TokenLine mint={p.mint} sub={`${sol(BigInt(p.amount))} · ${modeLabel(p.mode, p.rungsBps)}`} />
        <View style={st.ladder}>
          <View style={[st.rail, { left: 20 }]} />
          <View style={[st.rail, { left: 80 }]} />
          {order.map(({ bps, i }) => {
            const state = states[i];
            const look = barStyle(state);
            const faded = state.kind === "not-needed" || state.kind === "not-tried";
            return (
              <View key={i} style={[st.rung, { minHeight: rowHeight }]}>
                {look.halo && <View style={[st.halo, { backgroundColor: look.halo }]} />}
                <View style={[st.bar, look.bar]} />
                <View style={[st.rungText, faded && { opacity: 0.55 }]}>
                  <Text style={st.rungLabel}>try {bpsText(bps)}</Text>
                  <Text style={[st.rungState, { color: look.text }, state.kind === "filled" && { fontWeight: "500" }]}>
                    {stateText(state)}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
        <Text style={[s.small, { fontSize: 13 }]}>Rung climbs for you, automatically</Text>
        <View style={{ gap: 5 }}>
          {links.map((l) => (
            <TxLinkText key={l.signature} label={l.label} signature={l.signature} outcome={l.outcome} />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  ladder: { position: "relative", paddingVertical: 20, marginTop: 2 },
  rail: { position: "absolute", top: 0, bottom: 0, width: 3, borderRadius: 2, backgroundColor: colors.line },
  rung: { justifyContent: "center", paddingLeft: 110 },
  bar: { position: "absolute", left: 13, width: 77, top: "50%", height: 10, marginTop: -5, borderRadius: 5 },
  halo: { position: "absolute", left: 7, width: 89, top: "50%", height: 22, marginTop: -11, borderRadius: 11 },
  rungText: { gap: 3 },
  rungLabel: { fontSize: 17, fontWeight: "700", color: colors.text },
  rungState: { fontSize: 14, lineHeight: 19 },
});
