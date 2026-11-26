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

export function Keypad({ onKey }: { onKey: (key: string) => void }) {
  return (
    <View style={st.pad}>
      {KEYS.map((row) => (
        <View key={row.join("")} style={st.row}>
          {row.map((k) => (
            <Pressable
              key={k}
              accessibilityRole="button"
              accessibilityLabel={k === "del" ? "Delete" : k}
              onPress={() => onKey(k)}
              style={({ pressed }) => [st.key, pressed && { backgroundColor: colors.raise }]}
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
  key: { flex: 1, minHeight: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  keyText: { fontSize: 23, fontWeight: "500", color: colors.text },
});
