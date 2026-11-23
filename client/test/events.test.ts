// (4) Events decoded from real program logs (captured by client_vectors.rs).

import assert from "node:assert/strict";
import { test } from "node:test";

import { PUMP_PROGRAM_ID, RungEvent, findEvent, parseEvents } from "../src/index";
import { vectors } from "./helpers";

const v = vectors();

/** The JSON shape the Rust side writes: keys base58, u64 as decimal strings. */
function plain(e: RungEvent): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(e).map(([k, x]) => [
      k,
      typeof x === "bigint" ? x.toString() : typeof x === "object" && x && "toBase58" in x ? x.toBase58() : x,
    ]),
  );
}

for (const c of v.logs) {
  test(`events in the ${c.name} logs`, () => {
    const events = parseEvents(c.logs).map(plain);
    assert.deepEqual(events, c.events);
  });
}

test("each event kind appears in the vectors", () => {
  const names = v.logs.flatMap((c: { events: { name: string }[] }) => c.events.map((e) => e.name));
  for (const n of ["OrderOpened", "OrderFilled", "OrderRefunded"]) assert.ok(names.includes(n), n);
  const reasons = v.logs.flatMap((c: { events: { reason?: string }[] }) => c.events.map((e) => e.reason));
  assert.ok(reasons.includes("GaveUp") && reasons.includes("Cancelled"));
});

test("findEvent returns the fill", () => {
  const filled = findEvent(v.logs.find((c: { name: string }) => c.name === "try_rung_filled").logs, "OrderFilled");
  assert.equal(filled?.rungIndex, 1);
  assert.equal(filled?.rungBps, 300);
});

test("a data line written by another program is not a Rung event", () => {
  const logs: string[] = v.logs.find((c: { name: string }) => c.name === "try_rung_filled").logs;
  const data = logs.find((l) => l.startsWith("Program data: "))!;
  const pump = PUMP_PROGRAM_ID.toBase58();
  const forged = [`Program ${pump} invoke [1]`, data, `Program ${pump} success`];
  assert.deepEqual(parseEvents(forged), []);
});
