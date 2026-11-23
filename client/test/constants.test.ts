import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import * as client from "../src/index";
import { CLIENT_DIR, repoFile } from "./helpers";

test("limits equal programs/rung/src/constants.rs", () => {
  const rust = repoFile("programs/rung/src/constants.rs");
  const found = new Map<string, bigint>();
  for (const m of rust.matchAll(/pub const (\w+): \w+ = ([\d_]+);/g)) found.set(m[1], BigInt(m[2].replaceAll("_", "")));
  const ts = client as unknown as Record<string, unknown>;
  assert.ok(found.size >= 12);
  for (const [name, value] of found) {
    assert.ok(name in ts, `${name} missing in constants.ts`);
    assert.equal(BigInt(ts[name] as number | bigint), value, name);
  }
});

test("program id, discriminators and seeds equal the IDL", () => {
  const idl = JSON.parse(repoFile("target/idl/rung.json"));
  assert.equal(idl.address, client.RUNG_PROGRAM_ID.toBase58());
  const ix = Object.fromEntries(idl.instructions.map((i: { name: string; discriminator: number[] }) => [i.name, i.discriminator]));
  assert.deepEqual(
    { open_order: client.RUNG_IX.openOrder, try_rung: client.RUNG_IX.tryRung, refund: client.RUNG_IX.refund, cancel: client.RUNG_IX.cancel },
    ix,
  );
  assert.deepEqual(idl.accounts[0].discriminator, client.ORDER_DISCRIMINATOR);
  for (const e of idl.events) assert.deepEqual(e.discriminator, client.RUNG_EVENT[e.name as keyof typeof client.RUNG_EVENT]);
  const seeds = Object.fromEntries(idl.constants.map((c: { name: string; value: string }) => [c.name, JSON.parse(c.value)]));
  assert.deepEqual(seeds.ORDER_SEED, Array.from(client.ORDER_SEED));
  assert.deepEqual(seeds.VAULT_SEED, Array.from(client.VAULT_SEED));
});

test("pump constants equal venue.rs", () => {
  const venue = repoFile("programs/rung/src/venue.rs");
  const disc = (name: string) => JSON.parse(new RegExp(`${name}: \\[u8; 8\\] = (\\[[^\\]]+\\])`).exec(venue)![1]);
  assert.deepEqual(disc("BONDING_CURVE_DISCRIMINATOR"), client.BONDING_CURVE_DISCRIMINATOR);
  assert.deepEqual(disc("BUY_EXACT_QUOTE_IN_V3_DISCRIMINATOR"), client.PUMP_IX.buyExactQuoteInV3);
  assert.ok(venue.includes(client.PUMP_PROGRAM_ID.toBase58()));
});

test("modes", () => {
  assert.deepEqual(client.MODES, {
    tight: [100, 200, 300],
    normal: [200, 300, 500],
    fast: [500, 1000, 1500],
    launch: [1000, 2000, 3000],
  });
  for (const rungs of Object.values(client.MODES)) assert.ok(rungs[rungs.length - 1] <= client.MAX_CAP_BPS);
});

test("Order account length is 8 + Order::INIT_SPACE", () => {
  // 3 keys, venue, status, rung_count, 5 x u16, 7 x u64, filled_rung, 2 x u64, 2 bumps.
  assert.equal(client.ORDER_ACCOUNT_LEN, 8 + 96 + 3 + 10 + 56 + 1 + 16 + 2);
});

test("src/ uses no Node-only APIs (it also runs in React Native and browsers)", () => {
  const dir = join(CLIENT_DIR, "src");
  for (const file of readdirSync(dir)) {
    const text = readFileSync(join(dir, file), "utf8");
    for (const banned of [/from "node:/, /from "(fs|path|os|crypto|child_process)"/, /\bprocess\./, /\brequire\(/, /\bBuffer\.from\b/]) {
      assert.ok(!banned.test(text), `${file} uses ${banned}`);
    }
  }
});
