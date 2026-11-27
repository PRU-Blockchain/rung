// Custom mode: one box per rung, arrows between them, "+" for a fourth and a
// fifth, typed with the app's own keypad. The buyer types numbers only; commas
// and spaces are the app's business (Buğra, on his phone, Nov 27). The boxes
// write the same text the single line used to hold, so everything that checks
// it stays as it was.
//
// The system keyboard is not used: inside these small boxes its cursor and
// selection were unreliable (typing 0.01 gave 1), and it squeezed the sheet.

import { Fragment, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Keypad } from "./Keypad";
import { MAX_BOXES, boxesText, pressPickedBox, rungBoxes } from "./customBoxes";
import { colors } from "./ui";

export function CustomRungs({ text, onChange }: { text: string; onChange: (text: string) => void }) {
  const [boxes, setBoxes] = useState(() => rungBoxes(text));
  const [at, setAt] = useState(0);
  // The box picked is typed over by its first key (see pressPickedBox).
  const [justPicked, setJustPicked] = useState(true);
  // The text can change from outside (the last buy's rungs arrive after the screen opens): follow it, but leave the
  // boxes alone when the change is our own edit.
  useEffect(() => {
    if (boxesText(boxes) !== boxesText(rungBoxes(text))) setBoxes(rungBoxes(text));
  }, [text]);
  const press = (key: string) => {
    const next = boxes.map((b, j) => (j === at ? pressPickedBox(b, key, justPicked) : b));
    setJustPicked(false);
    setBoxes(next);
    onChange(boxesText(next));
  };
  return (
    <View style={{ gap: 10 }}>
      <View style={st.row}>
        {boxes.map((b, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <Text style={st.arrow} accessibilityElementsHidden importantForAccessibility="no">
                →
              </Text>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Rung ${i + 1}, percent`}
              accessibilityValue={{ text: b || "empty" }}
              accessibilityState={{ selected: i === at }}
              onPress={() => {
                setAt(i);
                setJustPicked(true);
              }}
              style={[st.box, i === at && st.boxOn]}
            >
              <Text style={[st.value, !b && { color: colors.faint }]}>{b || "–"}</Text>
              <Text style={st.pct}>%</Text>
            </Pressable>
          </Fragment>
        ))}
        {boxes.length < MAX_BOXES && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a rung"
            onPress={() => {
              setBoxes([...boxes, ""]);
              setAt(boxes.length);
              setJustPicked(true);
            }}
            style={st.add}
            hitSlop={6}
          >
            <Text style={st.addText}>+</Text>
          </Pressable>
        )}
      </View>
      <Keypad onKey={press} compact />
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
  boxOn: { borderColor: colors.text },
  value: { fontSize: 16, fontWeight: "600", color: colors.text, fontVariant: ["tabular-nums"] },
  pct: { marginLeft: 2, fontSize: 13, color: colors.muted },
  add: { width: 40, height: 46, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", borderColor: colors.faint, alignItems: "center", justifyContent: "center" },
  addText: { fontSize: 20, lineHeight: 22, color: colors.muted },
});
