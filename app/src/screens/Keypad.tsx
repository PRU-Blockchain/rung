// The buy screen's own keypad: digits, "." and delete. The system keyboard
// stays closed; the room it took goes to the keys.

import { Pressable, StyleSheet, Text, View } from "react-native";

import { DeleteIcon, colors } from "./ui";

const KEYS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [".", "0", "del"],
];

/** `compact`: fixed, lower keys, for a keypad inside a sheet (the custom rungs). */
export function Keypad({ onKey, compact = false }: { onKey: (key: string) => void; compact?: boolean }) {
  return (
    <View style={compact ? st.padCompact : st.pad}>
      {KEYS.map((row) => (
        <View key={row.join("")} style={compact ? st.rowCompact : st.row}>
          {row.map((k) => (
            <Pressable
              key={k}
              accessibilityRole="button"
              accessibilityLabel={k === "del" ? "Delete" : k}
              onPress={() => onKey(k)}
              style={({ pressed }) => [st.key, compact && st.keyCompact, pressed && { backgroundColor: colors.raise }]}
            >
              {k === "del" ? <DeleteIcon /> : <Text style={st.keyText}>{k}</Text>}
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  pad: { flexGrow: 1, gap: 2 },
  row: { flexDirection: "row", gap: 2, flexGrow: 1 },
  padCompact: { gap: 2 },
  rowCompact: { flexDirection: "row", gap: 2 },
  keyCompact: { minHeight: 44 },
  key: { flex: 1, minHeight: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  keyText: { fontSize: 23, fontWeight: "500", color: colors.text },
});
