// Display helpers. Amounts stay bigint until the last step.

const LAMPORTS = 1_000_000_000n;

/** "0.00003325 SOL": exact, trailing zeros dropped. */
export function sol(lamports: bigint): string {
  const neg = lamports < 0n;
  const v = neg ? -lamports : lamports;
  const frac = (v % LAMPORTS).toString().padStart(9, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${v / LAMPORTS}${frac ? `.${frac}` : ""} SOL`;
}

/** Token base units with decimals, trailing zeros dropped. */
export function tokens(amount: bigint, decimals: number): string {
  const s = amount.toString().padStart(decimals + 1, "0");
  if (decimals === 0) return s;
  const frac = s.slice(-decimals).replace(/0+$/, "");
  const whole = s.slice(0, -decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${whole}.${frac}` : whole;
}

/** A positive number with `digits` significant digits, never in exponent form. */
export function significant(value: number, digits = 4): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  const decimals = Math.max(0, digits - 1 - Math.floor(Math.log10(value)));
  return value.toFixed(Math.min(decimals, 20));
}

/** SOL per whole token for `lamports` paid for `baseUnits` tokens. */
export function priceSolPerToken(lamports: bigint, baseUnits: bigint, decimals: number): number {
  if (baseUnits === 0n) return 0;
  return (Number(lamports) / Number(baseUnits)) * 10 ** decimals / 1e9;
}

export const priceText = (lamports: bigint, baseUnits: bigint, decimals: number) =>
  `${significant(priceSolPerToken(lamports, baseUnits, decimals))} SOL per token`;

/** Basis points as a percent without trailing zeros: 150 -> "1.5%". */
export const bpsText = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;

/** Percent with up to two decimals. */
export const pctText = (pct: number) => `${Number(pct.toFixed(2))}%`;

export const shortAddress = (address: string) => `${address.slice(0, 4)}...${address.slice(-4)}`;

export const explorerTx = (signature: string) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;

/** "0.01" -> 10_000_000n; null if it is not a SOL amount with at most 9 decimals. */
export function parseSol(text: string): bigint | null {
  const m = /^(\d+)(?:\.(\d{0,9}))?$/.exec(text.trim());
  if (!m) return null;
  return BigInt(m[1]) * LAMPORTS + BigInt((m[2] ?? "").padEnd(9, "0"));
}
