// (5) Error mapping: a code counts only together with the program that raised it.

import assert from "node:assert/strict";
import { test } from "node:test";

import { PublicKey } from "@solana/web3.js";

import {
  COMPUTE_BUDGET_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  RUNG_ERRORS,
  RUNG_PROGRAM_ID,
  classifyFailure,
  errorName,
  failingProgramFromLogs,
} from "../src/index";
import { repoFile, vectors } from "./helpers";

const v = vectors();

test("RUNG_ERRORS equals the IDL's error list", () => {
  const idl = JSON.parse(repoFile("target/idl/rung.json"));
  const fromIdl = Object.fromEntries(idl.errors.map((e: { code: number; name: string }) => [e.code, pascal(e.name)]));
  assert.deepEqual(RUNG_ERRORS, fromIdl);
});

const pascal = (s: string) => s.replace(/(^|_)([a-z])/g, (_m, _u, c: string) => c.toUpperCase());

for (const c of v.errors) {
  test(`classifies the ${c.name} failure from real logs`, () => {
    const programIds = c.program_ids.map((k: string) => new PublicKey(k));
    const f = classifyFailure(c.err, c.logs, programIds);
    assert.equal(f.kind, c.expected.kind);
    assert.equal(f.code, c.expected.code);
    assert.equal(f.programId?.toBase58(), c.expected.program);
    assert.equal(f.instructionIndex, 1);
  });
}

test("pump's slippage failure names pump as the innermost failing program", () => {
  const c = v.errors.find((x: { name: string }) => x.name === "pump_slippage");
  const inner = failingProgramFromLogs(c.logs);
  assert.ok(inner?.programId.equals(PUMP_PROGRAM_ID));
  assert.equal(inner?.code, 6042);
});

test("6042 from Rung itself is not slippage", () => {
  const err = { InstructionError: [1, { Custom: 6042 }] };
  const logs = [`Program ${RUNG_PROGRAM_ID.toBase58()} invoke [1]`, `Program ${RUNG_PROGRAM_ID.toBase58()} failed: custom program error: 0x179a`];
  const f = classifyFailure(err, logs, [COMPUTE_BUDGET_PROGRAM_ID, RUNG_PROGRAM_ID]);
  assert.equal(f.kind, "rung");
  assert.equal(f.name, undefined);
});

test("without logs the top-level program from the instruction index is used", () => {
  const f = classifyFailure({ InstructionError: [2, { Custom: 6012 }] }, [], [
    COMPUTE_BUDGET_PROGRAM_ID,
    COMPUTE_BUDGET_PROGRAM_ID,
    RUNG_PROGRAM_ID,
  ]);
  assert.equal(f.kind, "order-filled");
  assert.equal(f.name, "OrderFilled");
});

test("errorName depends on the program", () => {
  assert.equal(errorName(PUMP_PROGRAM_ID, 6042), "BuySlippageBelowMinTokensOut");
  assert.equal(errorName(RUNG_PROGRAM_ID, 6012), "OrderFilled");
  assert.equal(errorName(PUMP_PROGRAM_ID, 6012), undefined);
  assert.equal(errorName(RUNG_PROGRAM_ID, 2006), "ConstraintSeeds");
  assert.equal(errorName(undefined, 6042), undefined);
});

test("non-custom errors are 'other'", () => {
  assert.equal(classifyFailure("BlockhashNotFound").kind, "other");
  assert.equal(classifyFailure({ InstructionError: [0, "InvalidAccountData"] }).kind, "other");
});
