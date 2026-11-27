// Custom mode: one box per rung, arrows between them, "+" for a fourth and a
// fifth. The buyer types numbers only; commas and spaces are the app's business
// (Buğra, on his phone, Nov 27). The boxes write the same text the single line
// used to hold, so everything that checks it stays as it was.

import { Fragment, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { MAX_BOXES, boxesText, cleanBox, rungBoxes } from "./customBoxes";
import { colors } from "./ui";

export function CustomRungs({ text, onChange }: { text: string; onChange: (text: string) => void }) {
  const [boxes, setBoxes] = useState(() => rungBoxes(text));
  // The text can change from outside (the last buy's rungs arrive after the screen opens): follow it, but leave the
  // boxes alone when the change is our own edit.
  useEffect(() => {
    if (boxesText(boxes) !== boxesText(rungBoxes(text))) setBoxes(rungBoxes(text));
  }, [text]);
  const set = (i: number, typed: string) => {
    const next = boxes.map((b, j) => (j === i ? cleanBox(typed) : b));
    setBoxes(next);
    onChange(boxesText(next));
  };
  return (
    <View style={st.row}>
      {boxes.map((b, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <Text style={st.arrow} accessibilityElementsHidden importantForAccessibility="no">
              →
            </Text>
          )}
          <View style={st.box}>
            <TextInput
              style={st.input}
              value={b}
              onChangeText={(t) => set(i, t)}
              keyboardType="decimal-pad"
              maxLength={5}
              selectTextOnFocus
              accessibilityLabel={`Rung ${i + 1}, percent`}
            />
            <Text style={st.pct}>%</Text>
          </View>
        </Fragment>
      ))}
      {boxes.length < MAX_BOXES && (
        <Pressable accessibilityRole="button" accessibilityLabel="Add a rung" onPress={() => setBoxes([...boxes, ""])} style={st.add} hitSlop={6}>
          <Text style={st.addText}>+</Text>
        </Pressable>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  arrow: { fontSize: 15, color: colors.muted },
  box: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 46,
    borderRadius: 12,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 6,
  },
  input: { flexShrink: 1, minWidth: 22, padding: 0, textAlign: "right", fontSize: 16, fontWeight: "600", color: colors.text, fontVariant: ["tabular-nums"] },
  pct: { marginLeft: 2, fontSize: 13, color: colors.muted },
  add: { width: 40, height: 46, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", borderColor: colors.faint, alignItems: "center", justifyContent: "center" },
  addText: { fontSize: 20, lineHeight: 22, color: colors.muted },
});
