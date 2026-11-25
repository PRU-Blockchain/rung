// How a token's name is written on a screen. Pure, with no React Native
// imports, so it is tested from client/test/app-token-label.test.ts.

export interface TokenNames {
  name: string;
  symbol: string;
}

/** "Catecoin · CATE"; the symbol only once when it says the same as the name. */
export function tokenTitle(t: TokenNames | null): string {
  if (!t) return "";
  if (!t.name || !t.symbol) return t.name || t.symbol;
  return t.name.toLowerCase() === t.symbol.toLowerCase() ? t.name : `${t.name} · ${t.symbol}`;
}

/** Up to two characters that stand in for the picture while there is none. */
export function tokenInitials(t: TokenNames | null): string {
  if (!t) return "";
  return Array.from((t.name || t.symbol).replace(/\s+/g, ""))
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
