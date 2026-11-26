// Small shared pieces: the dark theme, the top bar with the network badge,
// buttons, icons drawn with plain Views (no react-native-svg), the token line,
// bottom sheets, rows and transaction links.

import { ReactNode, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from "react-native";

import { NETWORK } from "../config";
import { bpsText, explorerTx, shortAddress } from "../flow/format";
import { MODE_OPTIONS } from "../flow/plan";
import { TokenInfo, useTokenInfo } from "../flow/tokenInfo";
import { tokenInitials, tokenTitle } from "../tokenLabel";

// The site's colours (web/app/globals.css, web/app/phone/phone.css).
export const colors = {
  bg: "#0B0D10",
  surface: "#13161B",
  raise: "#23272D",
  line: "#242931",
  text: "#ECEFF2",
  muted: "#96A0AB",
  faint: "#626973",
  accent: "#FFC233",
  accentPress: "#EDB01C",
  onAccent: "#191304",
  accentSoft: "rgba(255, 194, 51, 0.22)",
  good: "#46CF86",
  goodSoft: "rgba(70, 207, 134, 0.14)",
  bad: "#F27474",
  badSoft: "rgba(242, 116, 116, 0.16)",
  scrim: "rgba(5, 6, 8, 0.62)",
  link: "#ECEFF2",
};

/** "Tight 1% → 2% → 3%"; a custom order is "Custom" and its rungs. */
export function modeLabel(mode: string, rungsBps: number[]): string {
  if (mode === "custom") return `Custom ${rungsBps.map(bpsText).join(" → ")}`;
  return MODE_OPTIONS.find((o) => o.mode === mode)?.label ?? mode;
}

/* Icons, drawn with Views. */

/** The site's mark: two rails, three rungs, the lowest one yellow. */
export function Mark({ size = 18 }: { size?: number }) {
  const u = size / 20;
  const rail = { position: "absolute" as const, top: 2 * u, bottom: 2 * u, width: 2 * u, borderRadius: u, backgroundColor: colors.text };
  const rung = (top: number, color: string, h = 2.2) => ({
    position: "absolute" as const,
    left: 4 * u,
    width: 12 * u,
    top: top * u - (h * u) / 2,
    height: h * u,
    borderRadius: h * u,
    backgroundColor: color,
  });
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[rail, { left: 4 * u }]} />
      <View style={[rail, { left: 14 * u }]} />
      <View style={rung(5.5, colors.text)} />
      <View style={rung(10, colors.text)} />
      <View style={rung(14.5, colors.accent, 2.6)} />
    </View>
  );
}

/** A chevron: "down" for the mode chip and history rows, "left" for Back. */
export function Chevron({ dir = "down", size = 16, color = colors.muted }: { dir?: "down" | "up" | "left"; size?: number; color?: string }) {
  const side = size * 0.45;
  const rotate = dir === "down" ? "-45deg" : dir === "up" ? "135deg" : "45deg";
  const shift = dir === "down" ? { marginTop: -side / 2.5 } : dir === "up" ? { marginTop: side / 2.5 } : { marginLeft: side / 2.5 };
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={[
          { width: side, height: side, borderLeftWidth: 2, borderBottomWidth: 2, borderColor: color, transform: [{ rotate }] },
          shift,
        ]}
      />
    </View>
  );
}

/** A clock, for History. */
export function ClockIcon({ color = colors.muted }: { color?: string }) {
  return (
    <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 1.8, borderColor: color }}>
      <View style={{ position: "absolute", left: 7.3, top: 3, width: 1.8, height: 6, borderRadius: 1, backgroundColor: color }} />
      <View
        style={{
          position: "absolute",
          left: 7.6,
          top: 8.4,
          width: 4.5,
          height: 1.8,
          borderRadius: 1,
          backgroundColor: color,
          transform: [{ rotate: "30deg" }],
        }}
      />
    </View>
  );
}

/** An "×", for Clear. */
export function CrossIcon({ size = 16, color = colors.muted }: { size?: number; color?: string }) {
  const bar = { position: "absolute" as const, left: 0, top: size / 2 - 0.9, width: size, height: 1.8, borderRadius: 1, backgroundColor: color };
  return (
    <View style={{ width: size, height: size }}>
      <View style={[bar, { transform: [{ rotate: "45deg" }] }]} />
      <View style={[bar, { transform: [{ rotate: "-45deg" }] }]} />
    </View>
  );
}

/** A clipboard, for Paste. */
export function ClipboardIcon({ color = colors.muted }: { color?: string }) {
  return (
    <View style={{ width: 16, height: 20 }}>
      <View style={{ position: "absolute", left: 0, top: 2, width: 16, height: 18, borderRadius: 3, borderWidth: 1.8, borderColor: color }} />
      <View
        style={{
          position: "absolute",
          left: 4.5,
          top: 0,
          width: 7,
          height: 4.5,
          borderRadius: 1.5,
          borderWidth: 1.8,
          borderColor: color,
          backgroundColor: colors.surface,
        }}
      />
      <View style={{ position: "absolute", left: 4.5, top: 9, width: 7, height: 1.6, backgroundColor: color }} />
      <View style={{ position: "absolute", left: 4.5, top: 13, width: 7, height: 1.6, backgroundColor: color }} />
    </View>
  );
}

/** The keypad's delete key: a tag pointing left with an "×" in it. */
export function DeleteIcon({ color = colors.text }: { color?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <View
        style={{
          width: 0,
          height: 0,
          borderTopWidth: 9,
          borderBottomWidth: 9,
          borderRightWidth: 8,
          borderTopColor: "transparent",
          borderBottomColor: "transparent",
          borderRightColor: color,
        }}
      />
      <View
        style={{
          width: 20,
          height: 18,
          borderTopRightRadius: 3,
          borderBottomRightRadius: 3,
          backgroundColor: color,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CrossIcon size={9} color={colors.bg} />
      </View>
    </View>
  );
}

/** A check mark in a green circle, for the receipt. */
export function CheckIcon() {
  return (
    <View style={[s.roundIcon, { backgroundColor: colors.goodSoft }]}>
      <View
        style={{
          width: 7,
          height: 13,
          marginTop: -3,
          borderRightWidth: 2.4,
          borderBottomWidth: 2.4,
          borderColor: colors.good,
          transform: [{ rotate: "45deg" }],
        }}
      />
    </View>
  );
}

/** A turning-back arrow in a grey circle, for "not bought". */
export function ReturnIcon() {
  return (
    <View style={[s.roundIcon, { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.raise }]}>
      <View style={{ width: 22, height: 20 }}>
        <View
          style={{
            position: "absolute",
            left: 4,
            top: 4,
            width: 15,
            height: 14,
            borderTopWidth: 2,
            borderRightWidth: 2,
            borderBottomWidth: 2,
            borderTopRightRadius: 7,
            borderBottomRightRadius: 7,
            borderColor: colors.text,
          }}
        />
        <View
          style={{
            position: "absolute",
            left: 2,
            top: 1.5,
            width: 7,
            height: 7,
            borderLeftWidth: 2,
            borderBottomWidth: 2,
            borderColor: colors.text,
            transform: [{ rotate: "45deg" }],
          }}
        />
      </View>
    </View>
  );
}

/* Top bar. */

/** Green dot for mainnet, grey for devnet: the sign that tells real SOL from test SOL. */
export function NetworkBadge() {
  const main = NETWORK.label === "mainnet";
  const color = main ? colors.good : colors.muted;
  return (
    <View style={[s.net, { backgroundColor: main ? colors.goodSoft : colors.raise }]}>
      <View style={[s.netDot, { backgroundColor: color }]} />
      <Text style={[s.netText, { color }]}>{NETWORK.label}</Text>
    </View>
  );
}

/** The mark, "Rung" and the network badge; `right` sits at the far end. */
export function Header({ right }: { right?: ReactNode }) {
  return (
    <View style={s.topbar}>
      <View style={s.brand}>
        <Mark />
        <Text style={s.brandText}>Rung</Text>
      </View>
      <NetworkBadge />
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

export function IconButton({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [s.iconButton, pressed && { backgroundColor: colors.surface }]}
    >
      {children}
    </Pressable>
  );
}

/* Buttons. */

export function Button({
  label,
  onPress,
  disabled,
  kind = "primary",
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  kind?: "primary" | "secondary";
  style?: StyleProp<ViewStyle>;
}) {
  const primary = kind === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        primary ? s.primary : s.secondary,
        primary && pressed && { backgroundColor: colors.accentPress },
        !primary && pressed && { backgroundColor: colors.raise },
        primary && disabled && s.primaryDisabled,
        style,
      ]}
    >
      <Text
        style={[primary ? s.primaryText : s.secondaryText, primary && disabled && { color: colors.faint }]}
        numberOfLines={2}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** An underlined text button ("Details"). */
export function LinkButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8} style={{ paddingVertical: 6, alignSelf: "flex-start" }}>
      <Text style={s.linkButton}>{label}</Text>
    </Pressable>
  );
}

/** The fixed bottom of a screen, under its scrolling part. */
export function Footer({ children }: { children: ReactNode }) {
  return <View style={s.footer}>{children}</View>;
}

/* Bottom sheets: React Native's own Modal; Android Back closes them. */

export function Sheet({
  visible,
  onClose,
  title,
  avoidKeyboard = false,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  avoidKeyboard?: boolean;
  children: ReactNode;
}) {
  const body = (
    <View style={s.sheetWrap}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityElementsHidden importantForAccessibility="no" />
      <View style={s.sheet}>
        <View style={s.grab} />
        {title ? (
          <Text style={s.sheetTitle} accessibilityRole="header">
            {title}
          </Text>
        ) : null}
        {children}
      </View>
    </View>
  );
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {avoidKeyboard ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </Modal>
  );
}

/** "Waiting for your wallet…" with a spinner, while the wallet is open. It cannot be cancelled from here. */
export function WalletWaitSheet({ visible }: { visible: boolean }) {
  return (
    <Sheet visible={visible} onClose={() => undefined}>
      <View style={{ alignItems: "center", gap: 14, paddingVertical: 12 }}>
        <ActivityIndicator size="large" color={colors.text} />
        <Text style={[s.body, { fontSize: 16, fontWeight: "500" }]}>Waiting for your wallet…</Text>
      </View>
    </Sheet>
  );
}

/* Transaction links. */

const OUTCOME_NOTE: Record<string, string> = {
  slippage: "missed",
  "not-landed": "did not land",
  failed: "failed",
};

export function TxLinkText({ label, signature, outcome }: { label: string; signature: string; outcome?: string }) {
  const note = outcome ? OUTCOME_NOTE[outcome] : undefined;
  return (
    <Text style={s.link} onPress={() => Linking.openURL(explorerTx(signature))}>
      {label}: {signature.slice(0, 8)}… <Text style={{ textDecorationLine: "underline" }}>(explorer)</Text>
      {note ? ` · ${note}` : ""}
    </Text>
  );
}

/* The token. */

/** The token's picture; its first two letters while there is none or none loads. */
function TokenPicture({ info, size }: { info: TokenInfo; size: number }) {
  const [at, setAt] = useState(0);
  const urls = info.imageUrls;
  useEffect(() => setAt(0), [urls.join(" ")]);
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (at < urls.length) {
    return (
      <Image
        source={{ uri: urls[at] }}
        style={[s.tokenPicture, box]}
        onError={() => setAt(at + 1)}
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View style={[s.tokenPicture, s.tokenInitials, box]}>
      <Text style={[s.tokenInitialsText, { fontSize: size > 40 ? 15 : 13 }]}>{tokenInitials(info)}</Text>
    </View>
  );
}

/**
 * Picture, "Name · SYMBOL" and the address under it, from what is already known
 * (`info`). Without a name, only the address. `sub` is an extra line under them.
 */
export function TokenLineView({
  mint,
  info,
  size = 36,
  hideAddress = false,
  sub,
}: {
  mint: string;
  info: TokenInfo | null;
  size?: number;
  hideAddress?: boolean;
  sub?: string;
}) {
  const title = tokenTitle(info);
  return (
    <View style={s.tokenLine}>
      {info && <TokenPicture info={info} size={size} />}
      <View style={{ flexShrink: 1, gap: 2 }}>
        {title ? (
          <Text style={s.tokenName} numberOfLines={1}>
            {title}
          </Text>
        ) : null}
        {!(hideAddress && title) && <Text style={title ? s.addrSmall : s.addr}>{shortAddress(mint)}</Text>}
        {sub ? <Text style={s.small}>{sub}</Text> : null}
      </View>
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
  sub,
}: {
  mint: string;
  fromNetwork?: boolean;
  hideAddress?: boolean;
  sub?: string;
}) {
  const info = useTokenInfo(mint, fromNetwork);
  return <TokenLineView mint={mint} info={info} hideAddress={hideAddress} sub={sub} />;
}

/** The "Token" row of a list: the name when it was read before, and always the address. */
export function TokenRow({ mint }: { mint: string }) {
  const title = tokenTitle(useTokenInfo(mint));
  return <Row label="Token" value={title ? `${title} · ${shortAddress(mint)}` : shortAddress(mint)} />;
}

export function Row({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[s.row, last && { borderBottomWidth: 0 }]}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 14, gap: 14 },

  topbar: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 54, paddingLeft: 16, paddingRight: 10, paddingTop: 6, paddingBottom: 4 },
  brand: { flexDirection: "row", alignItems: "center", gap: 7 },
  brandText: { fontSize: 19, fontWeight: "800", color: colors.text, letterSpacing: -0.2 },
  net: { flexDirection: "row", alignItems: "center", gap: 6, height: 24, paddingHorizontal: 9, borderRadius: 999 },
  netDot: { width: 6, height: 6, borderRadius: 3 },
  netText: { fontSize: 12, fontWeight: "500", letterSpacing: 0.2 },
  topTitle: { fontSize: 19, fontWeight: "700", color: colors.text },
  iconButton: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },

  h2: { fontSize: 15, fontWeight: "600", color: colors.text },
  body: { fontSize: 15, color: colors.text },
  small: { fontSize: 12.5, lineHeight: 18, color: colors.muted },
  error: { fontSize: 13, lineHeight: 18, color: colors.bad },

  primary: {
    minHeight: 60,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  primaryDisabled: { backgroundColor: colors.raise },
  primaryText: { fontSize: 18, fontWeight: "700", color: colors.onAccent, textAlign: "center" },
  secondary: {
    minHeight: 50,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  secondaryText: { fontSize: 15, fontWeight: "600", color: colors.text, textAlign: "center" },
  linkButton: { fontSize: 13, fontWeight: "500", color: colors.text, textDecorationLine: "underline" },
  link: { fontSize: 11.5, lineHeight: 17, color: colors.muted, fontFamily: "monospace" },

  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.bg,
  },

  sheetWrap: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.scrim },
  sheet: {
    maxHeight: "86%",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    backgroundColor: colors.surface,
  },
  grab: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.faint, alignSelf: "center", marginTop: 2, marginBottom: 12 },
  sheetTitle: { fontSize: 19, fontWeight: "700", color: colors.text, marginBottom: 10 },

  card: { borderWidth: 1, borderColor: colors.line, borderRadius: 18, backgroundColor: colors.surface, padding: 14, gap: 12 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 14,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowLabel: { fontSize: 13, color: colors.muted, flexShrink: 1 },
  rowValue: { fontSize: 13, color: colors.text, flexShrink: 1, textAlign: "right" },

  tokenLine: { flexDirection: "row", alignItems: "center", gap: 10 },
  tokenPicture: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.raise },
  tokenInitials: { alignItems: "center", justifyContent: "center" },
  tokenInitialsText: { fontSize: 13, fontWeight: "700", color: colors.text },
  tokenName: { fontSize: 17, fontWeight: "700", color: colors.text },
  addr: { fontSize: 15, fontWeight: "500", color: colors.text, fontFamily: "monospace" },
  addrSmall: { fontSize: 12, color: colors.muted, fontFamily: "monospace" },
  roundIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
});
