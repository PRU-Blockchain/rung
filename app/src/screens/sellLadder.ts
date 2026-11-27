// The sale's ladder: one signed sale per rung, tightest first; the next one is
// sent only if the one before missed. Pure: the screen and flow/sell.ts do the
// signing and sending. Tested from client/test/app-sell-ladder.test.ts.

/** One minimum per rung: the simulated amount less that rung's percent. */
export const sellMinimums = (simulated: bigint, rungsBps: number[]): bigint[] =>
  rungsBps.map((bps) => (simulated * BigInt(10_000 - bps)) / 10_000n);

export type SaleTry =
  | { kind: "sold"; signature: string }
  /** The venue refused: the price is below this rung's minimum. Nothing was sold by this try. */
  | { kind: "missed"; signature?: string }
  /** Sent, and its outcome could not be read. */
  | { kind: "unknown"; signature: string };

export type SaleRungState = "trying" | "sold" | "missed" | "not-needed";

/** A sale that was sent and whose outcome is not known: the climb stops, so no second sale can follow a first that landed. */
export class SaleUnconfirmed extends Error {
  constructor(public signature: string) {
    super("The sale was sent but could not be confirmed.");
  }
}

/**
 * Tries the rungs in order. The first that sells ends the climb; a rung that
 * missed is followed by the next. Any error, and a try whose outcome is
 * unknown, stops it: the next sale is only ever sent after a certain miss.
 */
export async function climbSale(
  rungCount: number,
  tryRung: (rungIndex: number) => Promise<SaleTry>,
  onState: (rungIndex: number, state: SaleRungState) => void,
): Promise<{ rungIndex: number; signature: string } | null> {
  for (let i = 0; i < rungCount; i++) {
    onState(i, "trying");
    const r = await tryRung(i);
    if (r.kind === "sold") {
      onState(i, "sold");
      for (let j = i + 1; j < rungCount; j++) onState(j, "not-needed");
      return { rungIndex: i, signature: r.signature };
    }
    if (r.kind === "unknown") throw new SaleUnconfirmed(r.signature);
    onState(i, "missed");
  }
  return null;
}
