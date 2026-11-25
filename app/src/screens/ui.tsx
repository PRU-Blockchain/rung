// Small shared pieces: header with the network label, buttons, links.

import { ReactNode, useEffect, useState } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { NETWORK } from "../config";
import { explorerTx, shortAddress } from "../flow/format";
import { TokenInfo, useTokenInfo } from "../flow/tokenInfo";
import { tokenInitials, tokenTitle } from "../tokenLabel";

export const colors = {
  text: "#111111",
  muted: "#555555",
  faint: "#888888",
  line: "#e3e3e3",
  soft: "#f3f3f3",
  good: "#1b7a3a",
  bad: "#b00020",
  link: "#1a56b8",
};

export function Header({ right }: { right?: ReactNode }) {
  return (
    <View style={s.header}>
      <View>
        <Text style={s.title}>Rung</Text>
        <Text style={s.network}>{NETWORK.label}</Text>
      </View>
      {right}
    </View>
  );
}

export function Button({
  label,
  onPress,
  disabled,
  kind = "primary",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  kind?: "primary" | "secondary";
}) {
  const primary = kind === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={[s.button, primary ? s.primary : s.secondary, disabled && s.disabled]}
    >
      <Text style={[s.buttonText, primary ? s.primaryText : s.secondaryText]}>{label}</Text>
    </Pressable>
  );
}

const OUTCOME_NOTE: Record<string, string> = {
  slippage: "price above this rung",
  "not-landed": "did not land",
  failed: "failed",
};

export function TxLinkText({ label, signature, outcome }: { label: string; signature: string; outcome?: string }) {
  const note = outcome ? OUTCOME_NOTE[outcome] : undefined;
  return (
    <Text style={s.link} onPress={() => Linking.openURL(explorerTx(signature))}>
      {label}: {signature.slice(0, 8)}… (explorer){note ? ` · ${note}` : ""}
    </Text>
  );
}

/** The token's picture; its first two letters while there is none or none loads. */
function TokenPicture({ info }: { info: TokenInfo }) {
  const [at, setAt] = useState(0);
  const urls = info.imageUrls;
  useEffect(() => setAt(0), [urls.join(" ")]);
  if (at < urls.length) {
    return <Image source={{ uri: urls[at] }} style={s.tokenPicture} onError={() => setAt(at + 1)} accessibilityIgnoresInvertColors />;
  }
  return (
    <View style={[s.tokenPicture, s.tokenInitials]}>
      <Text style={s.tokenInitialsText}>{tokenInitials(info)}</Text>
    </View>
  );
}

/**
 * The token a screen is about: picture, name and symbol when they are known,
 * and always the address, because the name is whatever the token's maker wrote.
 * With `fromNetwork` the chain is asked; otherwise only what was read before is shown.
 */
export function TokenLine({
  mint,
  fromNetwork = false,
  hideAddress = false,
}: {
  mint: string;
  fromNetwork?: boolean;
  hideAddress?: boolean;
}) {
  const info = useTokenInfo(mint, fromNetwork);
  if (!info) return <Text style={s.body}>Token {shortAddress(mint)}</Text>;
  return (
    <View style={s.tokenLine}>
      <TokenPicture info={info} />
      <View style={{ flexShrink: 1 }}>
        <Text style={[s.body, { fontWeight: "600" }]} numberOfLines={1}>
          {tokenTitle(info)}
        </Text>
        {!hideAddress && <Text style={s.small}>Token {shortAddress(mint)}</Text>}
      </View>
    </View>
  );
}

/** The "Token" row of a list: the name when it was read before, and always the address. */
export function TokenRow({ mint }: { mint: string }) {
  const title = tokenTitle(useTokenInfo(mint));
  return <Row label="Token" value={title ? `${title} · ${shortAddress(mint)}` : shortAddress(mint)} />;
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#ffffff" },
  content: { padding: 20, paddingBottom: 40, gap: 12 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 },
  title: { fontSize: 28, fontWeight: "700", color: colors.text },
  network: {
    alignSelf: "flex-start",
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: "#eeeeee",
    color: "#333333",
    fontSize: 13,
  },
  h2: { fontSize: 15, fontWeight: "600", color: colors.text, marginTop: 4 },
  body: { fontSize: 15, color: colors.text },
  small: { fontSize: 12, color: colors.muted },
  error: { fontSize: 14, color: colors.bad },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
  },
  button: { borderRadius: 8, paddingHorizontal: 16, paddingVertical: 12, alignItems: "center" },
  primary: { backgroundColor: colors.text },
  secondary: { backgroundColor: "#ffffff", borderWidth: 1, borderColor: colors.text },
  disabled: { opacity: 0.35 },
  buttonText: { fontSize: 15, fontWeight: "600", textAlign: "center" },
  primaryText: { color: "#ffffff" },
  secondaryText: { color: colors.text },
  link: { fontSize: 12, color: colors.link, paddingVertical: 2 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  rowLabel: { fontSize: 13, color: colors.muted, flexShrink: 1 },
  rowValue: { fontSize: 13, color: colors.text, flexShrink: 1, textAlign: "right" },
  box: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 12, gap: 6 },
  tokenLine: { flexDirection: "row", alignItems: "center", gap: 10 },
  tokenPicture: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.soft },
  tokenInitials: { alignItems: "center", justifyContent: "center" },
  tokenInitialsText: { fontSize: 13, fontWeight: "700", color: colors.muted },
});
