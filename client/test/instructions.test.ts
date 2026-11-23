// (1) Instruction data and account metas equal the Rust builders byte for byte.
// (2) PDAs equal the Rust derivations.

import assert from "node:assert/strict";
import { test } from "node:test";

import { PublicKey } from "@solana/web3.js";

import {
  OpenOrderArgs,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  associatedTokenAddress,
  bondingCurvePda,
  cancelIx,
  computeUnitLimitIx,
  openOrderIx,
  orderPda,
  pumpEventAuthorityPda,
  pumpFeeConfigPda,
  pumpGlobalPda,
  refundIx,
  tryRungIx,
  userVolumeAccumulatorPda,
  vaultPda,
} from "../src/index";
import { ixJson, vectors } from "./helpers";

const v = vectors();
const inputs = v.instructions.inputs;
const user = new PublicKey(inputs.user);
const sessionKey = new PublicKey(inputs.session_key);
const mint = new PublicKey(inputs.mint);
const buybackRecipient = new PublicKey(inputs.buyback_recipient);
const a = inputs.open_order_args;

const args: OpenOrderArgs = {
  venue: a.venue,
  rungsBps: a.rungs_bps,
  amount: BigInt(a.amount),
  rentReserve: BigInt(a.rent_reserve),
  feeBudget: BigInt(a.fee_budget),
  expectedTokensSeen: BigInt(a.expected_tokens_seen),
  rawTokensSeen: BigInt(a.raw_tokens_seen),
  windowSlots: BigInt(a.window_slots),
  lifetimeSlots: BigInt(a.lifetime_slots),
};

test("open_order matches Rust", () => {
  assert.deepEqual(ixJson(openOrderIx({ user, sessionKey, mint, args })), v.instructions.open_order);
});

test("try_rung matches Rust (SPL Token and Token-2022), pump's 17 accounts included", () => {
  for (const [tokenProgram, key] of [
    [TOKEN_PROGRAM_ID, "try_rung_spl"],
    [TOKEN_2022_PROGRAM_ID, "try_rung_2022"],
  ] as const) {
    const ix = tryRungIx({ sessionKey, user, mint, tokenProgram, buybackRecipient, rungIndex: inputs.try_rung_index });
    assert.equal(ix.keys.length, 10 + 17);
    assert.deepEqual(ixJson(ix), v.instructions[key]);
  }
});

test("refund and cancel match Rust", () => {
  assert.deepEqual(ixJson(refundIx({ caller: sessionKey, user })), v.instructions.refund);
  assert.deepEqual(ixJson(cancelIx({ user })), v.instructions.cancel);
});

test("compute unit limit matches the Rust helper", () => {
  assert.deepEqual(ixJson(computeUnitLimitIx(inputs.cu_limit)), v.instructions.cu_limit);
});

test("PDAs match Rust", () => {
  const vault = vaultPda(user);
  const got = {
    order: orderPda(user),
    vault,
    bonding_curve: bondingCurvePda(mint),
    global: pumpGlobalPda(),
    event_authority: pumpEventAuthorityPda(),
    fee_config: pumpFeeConfigPda(),
    vault_accumulator: userVolumeAccumulatorPda(vault),
    user_ata_spl: associatedTokenAddress(user, mint, TOKEN_PROGRAM_ID),
    user_ata_2022: associatedTokenAddress(user, mint, TOKEN_2022_PROGRAM_ID),
    vault_ata_spl: associatedTokenAddress(vault, mint, TOKEN_PROGRAM_ID),
  };
  assert.deepEqual(Object.fromEntries(Object.entries(got).map(([k, p]) => [k, p.toBase58()])), v.pdas);
});

test("known pump addresses derive from their seeds", () => {
  assert.equal(pumpFeeConfigPda().toBase58(), "8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt");
  assert.equal(pumpGlobalPda().toBase58(), "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");
});
