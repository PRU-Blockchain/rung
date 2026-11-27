// What the phone does in the hand while the ladder runs (Buğra, Nov 27): a
// short tick each time a try is sent, two pulses when it bought, one longer
// pulse when the order ends with a refund. Pure: the screen calls Vibration.

/** The part of a ladder event this rule looks at. */
export interface HapticEvent {
  type: string;
  kind?: string;
  attempt?: { kind: string; outcome: string };
}

/** Milliseconds, or an Android pattern (wait, buzz, wait, buzz); null for no vibration. */
export function vibrationFor(e: HapticEvent): number | number[] | null {
  if (e.type === "sent" && e.kind === "try") return 12;
  if (e.type === "sent" && e.kind === "refund") return 40;
  if (e.type === "result" && e.attempt?.kind === "try" && e.attempt.outcome === "filled") return [0, 28, 70, 28];
  return null;
}
