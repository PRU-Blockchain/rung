// Selling the Rung way (Buğra, Nov 27: picking a slippage for a sale goes
// against what Rung is for). The sale tries the tightest rung first and climbs
// only as needed, like a buy. Without a change to the program this is done
// with one wallet approval that signs one sale per rung; the app sends the
// tightest, and the next one only if that one missed. The first that lands
// ends it: the others are never sent.
import assert from "node:assert/strict";
import { test } from "node:test";

import { climbSale, sellMinimums } from "../../app/src/screens/sellLadder";

test("one minimum per rung, below the simulated amount by that rung's percent", () => {
  assert.deepEqual(sellMinimums(10_000_000n, [100, 200, 300]), [9_900_000n, 9_800_000n, 9_700_000n]);
  assert.deepEqual(sellMinimums(10_000_000n, [1000, 2000, 3000]), [9_000_000n, 8_000_000n, 7_000_000n]);
});

test("the tightest rung sells: the others are never tried", async () => {
  const tried: number[] = [];
  const states: string[] = [];
  const result = await climbSale(
    3,
    async (i) => {
      tried.push(i);
      return { kind: "sold", signature: `sig${i}` };
    },
    (i, state) => states.push(`${i}:${state}`),
  );
  assert.deepEqual(result, { rungIndex: 0, signature: "sig0" });
  assert.deepEqual(tried, [0]);
  assert.deepEqual(states, ["0:trying", "0:sold", "1:not-needed", "2:not-needed"]);
});

test("a rung that misses is followed by the next one", async () => {
  const tried: number[] = [];
  const states: string[] = [];
  const result = await climbSale(
    3,
    async (i) => {
      tried.push(i);
      return i < 1 ? { kind: "missed" } : { kind: "sold", signature: `sig${i}` };
    },
    (i, state) => states.push(`${i}:${state}`),
  );
  assert.deepEqual(result, { rungIndex: 1, signature: "sig1" });
  assert.deepEqual(tried, [0, 1]);
  assert.deepEqual(states, ["0:trying", "0:missed", "1:trying", "1:sold", "2:not-needed"]);
});

test("every rung misses: nothing is sold", async () => {
  const states: string[] = [];
  const result = await climbSale(3, async () => ({ kind: "missed" }), (i, state) => states.push(`${i}:${state}`));
  assert.equal(result, null);
  assert.deepEqual(states, ["0:trying", "0:missed", "1:trying", "1:missed", "2:trying", "2:missed"]);
});

test("an error that is not a miss stops the climb: no further sale is sent blind", async () => {
  const tried: number[] = [];
  await assert.rejects(
    climbSale(
      3,
      async (i) => {
        tried.push(i);
        throw new Error("no network");
      },
      () => undefined,
    ),
    /no network/,
  );
  assert.deepEqual(tried, [0]);
});

test("a rung whose outcome is unknown stops the climb too: a second sale could otherwise follow a first that landed", async () => {
  const tried: number[] = [];
  await assert.rejects(
    climbSale(
      3,
      async (i) => {
        tried.push(i);
        return { kind: "unknown", signature: "sigX" };
      },
      () => undefined,
    ),
    /could not be confirmed/,
  );
  assert.deepEqual(tried, [0]);
});
