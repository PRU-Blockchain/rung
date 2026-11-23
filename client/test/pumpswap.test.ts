// (7) PumpSwap: instructions, PDAs, pool decoding, the pool quote and fee
// tier, budget, errors and venue resolution.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { AccountInfo, Connection, Keypair, PublicKey } from "@solana/web3.js";

import {
  AMM_FEE_CONFIG,
  AMM_GLOBAL_CONFIG,
  COMPUTE_BUDGET_PROGRAM_ID,
  OpenOrderArgs,
  POOL_CU_LIMIT,
  POOL_DISCRIMINATOR,
  PUMP_PROGRAM_ID,
  PUMP_SWAP_IX,
  PUMP_SWAP_PROGRAM_ID,
  RUNG_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  WSOL_MINT,
  ammEventAuthorityPda,
  ammFeeConfigPda,
  ammGlobalConfigPda,
  ammUserVolumeAccumulatorPda,
  associatedTokenAddress,
  base64Decode,
  bondingCurvePda,
  canonicalPoolPda,
  classifyFailure,
  concat,
  cuLimitFor,
  decodeAmmGlobalConfig,
  decodeFeeConfig,
  decodeMint,
  decodePool,
  decodeTokenAccount,
  errorName,
  feeBudget,
  fetchPoolMarket,
  findBuybackWsolAccounts,
  openOrderIx,
  poolAuthorityPda,
  poolExpectedTokens,
  poolFees,
  poolReserves,
  pumpSwapBuyExactQuoteInV2Ix,
  quotePoolOrder,
  rawQuote,
  rentReserve,
  resolveVenue,
  tryRungIx,
  u16,
  u64,
  u8,
  vaultPda,
  wsolAta,
} from "../src/index";
import { REPO_DIR, ixJson, repoFile, vectors } from "./helpers";

const v = vectors();
const ps = v.pumpswap;
const user = new PublicKey(v.instructions.inputs.user);
const sessionKey = new PublicKey(v.instructions.inputs.session_key);
const mint = new PublicKey(v.instructions.inputs.mint);
const a = ps.inputs.open_order_args;
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
const poolFor = (tokenProgram: PublicKey) => {
  const address = canonicalPoolPda(mint);
  return {
    address,
    baseTokenAccount: associatedTokenAddress(address, mint, tokenProgram),
    quoteTokenAccount: wsolAta(address),
  };
};
const buybackWsol = wsolAta(new PublicKey(ps.inputs.buyback_wallet));

// --- instructions and PDAs (byte for byte with client_vectors.rs) ------------------

test("PumpSwap open_order matches Rust: pool as venue account, its two token accounts as remaining", () => {
  const ix = openOrderIx({ user, sessionKey, mint, args, pool: poolFor(TOKEN_PROGRAM_ID) });
  assert.deepEqual(ixJson(ix), ps.open_order);
  assert.throws(() => openOrderIx({ user, sessionKey, mint, args }), /needs the pool's accounts/);
  const wrongPool = { ...poolFor(TOKEN_PROGRAM_ID), address: Keypair.generate().publicKey };
  assert.throws(() => openOrderIx({ user, sessionKey, mint, args, pool: wrongPool }), /not the canonical/);
});

test("PumpSwap try_rung matches Rust (SPL Token and Token-2022), PumpSwap's 17 accounts included", () => {
  for (const [tokenProgram, key] of [
    [TOKEN_PROGRAM_ID, "try_rung_spl"],
    [TOKEN_2022_PROGRAM_ID, "try_rung_2022"],
  ] as const) {
    const ix = tryRungIx({
      sessionKey,
      user,
      mint,
      tokenProgram,
      buybackRecipient: buybackWsol,
      rungIndex: ps.inputs.try_rung_index,
      venue: "PumpSwap",
      pool: poolFor(tokenProgram),
    });
    assert.equal(ix.keys.length, 10 + 17);
    assert.deepEqual(ixJson(ix), v.pumpswap[key]);
  }
  assert.throws(
    () => tryRungIx({ sessionKey, user, mint, tokenProgram: TOKEN_PROGRAM_ID, buybackRecipient: buybackWsol, rungIndex: 0, venue: "PumpSwap" }),
    /needs the pool's accounts/,
  );
});

test("direct buy_exact_quote_in_v2 matches Rust (24 bytes of data, buyer signs)", () => {
  const ix = pumpSwapBuyExactQuoteInV2Ix({
    buyer: user,
    mint,
    tokenProgram: TOKEN_PROGRAM_ID,
    pool: poolFor(TOKEN_PROGRAM_ID),
    buybackWsolAccount: buybackWsol,
    spendable: BigInt(ps.inputs.direct_buy.spendable),
    minTokensOut: BigInt(ps.inputs.direct_buy.min_tokens_out),
  });
  assert.equal(ix.data.length, 24);
  assert.deepEqual(ixJson(ix), ps.direct_buy);
});

test("PumpSwap PDAs match Rust", () => {
  const vault = vaultPda(user);
  const got = {
    pool_authority: poolAuthorityPda(mint),
    canonical_pool: canonicalPoolPda(mint),
    pool_base_spl: poolFor(TOKEN_PROGRAM_ID).baseTokenAccount,
    pool_base_2022: poolFor(TOKEN_2022_PROGRAM_ID).baseTokenAccount,
    pool_quote: poolFor(TOKEN_PROGRAM_ID).quoteTokenAccount,
    global_config: ammGlobalConfigPda(),
    fee_config: ammFeeConfigPda(),
    event_authority: ammEventAuthorityPda(),
    vault_accumulator: ammUserVolumeAccumulatorPda(vault),
    vault_wsol: wsolAta(vault),
    buyback_wsol: buybackWsol,
  };
  assert.deepEqual(Object.fromEntries(Object.entries(got).map(([k, p]) => [k, p.toBase58()])), ps.pdas);
});

test("known PumpSwap addresses derive from their seeds (docs/pump-arayuz.md K1)", () => {
  assert.ok(ammGlobalConfigPda().equals(AMM_GLOBAL_CONFIG));
  assert.ok(ammFeeConfigPda().equals(AMM_FEE_CONFIG));
  assert.equal(ammEventAuthorityPda().toBase58(), "GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR");
  // The mainnet proof: mint 76fF...pump -> pool authority EBTq...VRiX -> pool C4E4...UJr.
  const m = new PublicKey("76fFhcA142kf9gdg11ahYTmEiZnPXokxJkcF1axupump");
  assert.equal(poolAuthorityPda(m).toBase58(), "EBTqQ1g8NSPXorW6HcerzQABkdRmqrXXwMBLgSq3VRiX");
  assert.equal(canonicalPoolPda(m).toBase58(), "C4E4jTqFXTsCYD2UvRTXmSDDjrMuLZtwrnxNJo9XYUJr");
});

test("PumpSwap constants equal pump_swap.rs", () => {
  const rs = repoFile("programs/rung/src/pump_swap.rs");
  const disc = (name: string) => JSON.parse(new RegExp(`${name}: \\[u8; 8\\] = (\\[[^\\]]+\\])`).exec(rs)![1]);
  assert.deepEqual(disc("POOL_DISCRIMINATOR"), POOL_DISCRIMINATOR);
  assert.deepEqual(disc("BUY_EXACT_QUOTE_IN_V2_DISCRIMINATOR"), PUMP_SWAP_IX.buyExactQuoteInV2);
  assert.ok(rs.includes(PUMP_SWAP_PROGRAM_ID.toBase58()));
});

// --- Pool decoding ---------------------------------------------------------------------

const k = (byte: number) => new PublicKey(new Uint8Array(32).fill(byte));

function i128(value: bigint): Uint8Array {
  const out = new Uint8Array(16);
  const x = BigInt.asUintN(128, value);
  out.set(u64(x & ((1n << 64n) - 1n)), 0);
  out.set(u64(x >> 64n), 8);
  return out;
}

function poolBytes(virtualQuote?: bigint, flags = { mayhem: false, cashback: false }): Uint8Array {
  return concat(
    Uint8Array.from(POOL_DISCRIMINATOR),
    u8(254),
    u16(0),
    k(1).toBytes(), // creator
    k(2).toBytes(), // base_mint
    WSOL_MINT.toBytes(), // quote_mint
    k(3).toBytes(), // lp_mint
    k(4).toBytes(), // pool_base_token_account
    k(5).toBytes(), // pool_quote_token_account
    u64(7n), // lp_supply
    k(6).toBytes(), // coin_creator
    u8(flags.mayhem ? 1 : 0),
    u8(flags.cashback ? 1 : 0),
    virtualQuote === undefined ? new Uint8Array(0) : i128(virtualQuote),
  );
}

test("decodePool reads the current layout, a negative virtual quote reserve included", () => {
  const p = decodePool(poolBytes(-17_584_390_927n));
  assert.equal(p.poolBump, 254);
  assert.equal(p.index, 0);
  assert.ok(p.creator.equals(k(1)) && p.baseMint.equals(k(2)) && p.quoteMint.equals(WSOL_MINT));
  assert.ok(p.poolBaseTokenAccount.equals(k(4)) && p.poolQuoteTokenAccount.equals(k(5)));
  assert.ok(p.coinCreator.equals(k(6)));
  assert.equal(p.virtualQuoteReserves, -17_584_390_927n);
  assert.equal(p.dataLength, 261);
  assert.equal(decodePool(poolBytes(0n, { mayhem: true, cashback: true })).isCashbackCoin, true);
});

test("decodePool: older, shorter pools read missing fields as zero, like parse_pool", () => {
  const old = poolBytes(undefined); // 245 bytes: no virtual_quote_reserves
  assert.equal(decodePool(old).virtualQuoteReserves, 0n);
  // A partial i128 is ignored, as the program does.
  const partial = concat(old, new Uint8Array(8).fill(0xff));
  assert.equal(decodePool(partial).virtualQuoteReserves, 0n);
  // The shortest the program accepts ends at pool_quote_token_account (203 bytes).
  const shortest = old.slice(0, 203);
  const p = decodePool(shortest);
  assert.ok(p.poolQuoteTokenAccount.equals(k(5)));
  assert.equal(p.lpSupply, 0n);
  assert.equal(p.isCashbackCoin, false);
  assert.throws(() => decodePool(old.slice(0, 202)), /too short/);
  const wrong = old.slice();
  wrong[0] ^= 0xff;
  assert.throws(() => decodePool(wrong), /not a PumpSwap Pool/);
});

test("poolReserves adds the virtual quote reserve and rejects empty ones (pump_swap.rs tests)", () => {
  assert.deepEqual(poolReserves({ virtualQuoteReserves: -400n }, 1_000n, 1_000n), {
    virtualTokenReserves: 1_000n,
    virtualQuoteReserves: 600n,
  });
  assert.throws(() => poolReserves({ virtualQuoteReserves: -1_000n }, 1_000n, 1_000n));
  assert.throws(() => poolReserves({ virtualQuoteReserves: -1_000n }, 1_000n, 999n));
  assert.throws(() => poolReserves({ virtualQuoteReserves: 0n }, 0n, 5_000n));
});

// --- quote and fee tier: real_pumpswap.rs T5 (mainnet snapshot, 2026-11-23) -------------

const T5 = {
  amount: 100_000_000n,
  base: 130_814_685_142_676n,
  quoteBalance: 133_237_571_035n,
  virtual: 17_584_390_927n,
  effectiveQuote: 150_821_961_962n,
  supply: 952_824_178_824_215n,
  marketCap: 1_098_552_596_739n,
  tier: { lpFeeBps: 20n, protocolFeeBps: 5n, creatorFeeBps: 95n },
  actual: 85_649_916_388n,
  raw: 86_677_037_219n,
};

test("poolExpectedTokens reproduces the real PumpSwap buy of real_pumpswap.rs T5 (difference 0)", () => {
  const reserves = poolReserves({ virtualQuoteReserves: T5.virtual }, T5.base, T5.quoteBalance);
  assert.equal(reserves.virtualQuoteReserves, T5.effectiveQuote);
  assert.equal(poolExpectedTokens(T5.amount, reserves, T5.tier), T5.actual);
  assert.equal(rawQuote(T5.amount, reserves), T5.raw);
  const fees = (lp: bigint) => ({ lpFeeBps: lp, protocolFeeBps: 0n, creatorFeeBps: 0n });
  const cfg = {
    bump: 0,
    admin: PublicKey.default,
    flatFees: fees(25n),
    feeTiers: [
      { marketCapLamportsThreshold: 0n, fees: { lpFeeBps: 2n, protocolFeeBps: 93n, creatorFeeBps: 30n } },
      { marketCapLamportsThreshold: 420_000_000_000n, fees: T5.tier },
      { marketCapLamportsThreshold: 98_240_000_000_000n, fees: { lpFeeBps: 20n, protocolFeeBps: 5n, creatorFeeBps: 5n } },
    ],
    stableFeeTiers: [],
    exoticFlatFees: fees(0n),
  };
  const q = quotePoolOrder(T5.amount, reserves, cfg, T5.supply);
  assert.deepEqual(q, { ...T5.tier, marketCapLamports: T5.marketCap, amount: T5.amount, expectedTokensSeen: T5.actual, rawTokensSeen: T5.raw });
  // Below the first threshold the first tier applies; flat fees are never used for the canonical pool.
  assert.equal(poolFees({ virtualTokenReserves: T5.supply, virtualQuoteReserves: 1n }, cfg, T5.supply).protocolFeeBps, 93n);
});

const FIXTURE = join(REPO_DIR, "programs/rung/tests/fixtures/pumpswap/accounts.json");

test("decoders read the PumpSwap mainnet fixture; fee tier and quote are T5's", { skip: !existsSync(FIXTURE) }, () => {
  const json = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const raw = (address: string) => {
    const x = json.accounts.find((y: { address: string }) => y.address === address);
    assert.ok(x?.exists, `fixture account ${address}`);
    return base64Decode(x.data);
  };
  const buy = json.buy_accounts.map((x: { address: string }) => new PublicKey(x.address));
  const fmint = buy[3];
  assert.ok(buy[0].equals(canonicalPoolPda(fmint)));
  const pool = decodePool(raw(buy[0].toBase58()));
  assert.equal(pool.dataLength, 301);
  assert.ok(pool.baseMint.equals(fmint) && pool.quoteMint.equals(WSOL_MINT));
  assert.ok(pool.creator.equals(poolAuthorityPda(fmint)));
  assert.ok(pool.poolBaseTokenAccount.equals(buy[7]) && pool.poolQuoteTokenAccount.equals(buy[8]));
  assert.equal(pool.virtualQuoteReserves, T5.virtual);
  assert.equal(pool.isCashbackCoin, false);
  assert.equal(pool.isMayhemMode, false);

  const base = decodeTokenAccount(raw(buy[7].toBase58())).amount;
  const quote = decodeTokenAccount(raw(buy[8].toBase58())).amount;
  assert.equal(base, T5.base);
  assert.equal(quote, T5.quoteBalance);
  const { supply } = decodeMint(raw(fmint.toBase58()));
  assert.equal(supply, T5.supply);

  const feeConfig = decodeFeeConfig(raw(AMM_FEE_CONFIG.toBase58()));
  assert.equal(feeConfig.feeTiers.length, 25);
  assert.deepEqual(feeConfig.flatFees, { lpFeeBps: 25n, protocolFeeBps: 5n, creatorFeeBps: 0n });
  const q = quotePoolOrder(T5.amount, poolReserves(pool, base, quote), feeConfig, supply);
  assert.deepEqual(
    { lp: q.lpFeeBps, protocol: q.protocolFeeBps, creator: q.creatorFeeBps, mcap: q.marketCapLamports },
    { lp: 20n, protocol: 5n, creator: 95n, mcap: T5.marketCap },
  );
  assert.equal(q.expectedTokensSeen, T5.actual);
  assert.equal(q.rawTokensSeen, T5.raw);

  const global = decodeAmmGlobalConfig(raw(AMM_GLOBAL_CONFIG.toBase58()));
  assert.equal(global.buybackBasisPoints, 5_000n);
  const buyback = decodeTokenAccount(raw(buy[14].toBase58()));
  assert.ok(buyback.mint.equals(WSOL_MINT));
  assert.ok(global.buybackFeeRecipients.some((w) => w.equals(buyback.owner)));
  assert.ok(wsolAta(buyback.owner).equals(buy[14]));
});

// --- budget -------------------------------------------------------------------------------

test("pool tries get a higher compute unit limit; the max fee grows with it", () => {
  assert.equal(cuLimitFor("Curve"), 200_000);
  assert.equal(cuLimitFor("PumpSwap"), POOL_CU_LIMIT);
  assert.ok(POOL_CU_LIMIT > 219_000, "above the highest pool fill measured");
  const curve = feeBudget({ rungCount: 3, rentExemptMinimum: 890_880n, cuPrice: 5_000n });
  const pool = feeBudget({ rungCount: 3, rentExemptMinimum: 890_880n, cuPrice: 5_000n, venue: "PumpSwap" });
  assert.equal(curve.tries, 3n * (5_000n + 1_000n));
  assert.equal(pool.tries, 3n * (5_000n + 1_300n));
});

test("pool rent reserve adds the vault's wrapped-SOL account and stays within the limit", async () => {
  // Mainnet rent (docs/pump-arayuz.md K7): 165 B 1,488,440; 170 B 1,513,840; 137 B 1,346,200.
  const mainnet: Record<number, bigint> = { 165: 1_488_440n, 170: 1_513_840n, 137: 1_346_200n };
  const rent = async (len: number) => mainnet[len];
  const t22 = await rentReserve(rent, TOKEN_2022_PROGRAM_ID, undefined, "PumpSwap");
  assert.equal(t22.vaultWsolAccount, 1_488_440n);
  assert.equal(t22.total - t22.margin, 5_862_320n); // K7's peak
  assert.equal(t22.total, 6_362_320n);
  const curve = await rentReserve(rent, TOKEN_2022_PROGRAM_ID);
  assert.equal(curve.vaultWsolAccount, 0n);
  assert.equal(curve.total, t22.total - 1_488_440n);
});

// --- errors -----------------------------------------------------------------------------

test("6040 is slippage only from PumpSwap; 6042 only from pump", () => {
  const logs = (program: PublicKey, code: number) => [
    `Program ${RUNG_PROGRAM_ID.toBase58()} invoke [1]`,
    `Program ${program.toBase58()} invoke [2]`,
    `Program ${program.toBase58()} failed: custom program error: 0x${code.toString(16)}`,
    `Program ${RUNG_PROGRAM_ID.toBase58()} failed: custom program error: 0x${code.toString(16)}`,
  ];
  const ids = [COMPUTE_BUDGET_PROGRAM_ID, RUNG_PROGRAM_ID];
  const err = (code: number) => ({ InstructionError: [1, { Custom: code }] });
  assert.equal(classifyFailure(err(6040), logs(PUMP_SWAP_PROGRAM_ID, 6040), ids).kind, "slippage");
  assert.equal(classifyFailure(err(6040), logs(PUMP_PROGRAM_ID, 6040), ids).kind, "other");
  assert.equal(classifyFailure(err(6042), logs(PUMP_SWAP_PROGRAM_ID, 6042), ids).kind, "other");
  assert.equal(errorName(PUMP_PROGRAM_ID, 6040), "BuyNotEnoughSolToCoverRent");
  assert.equal(errorName(PUMP_SWAP_PROGRAM_ID, 6040), "BuySlippageBelowMinBaseAmountOut");
  assert.equal(errorName(PUMP_SWAP_PROGRAM_ID, 6079), "CashbackCoinNotSupported");
  assert.equal(errorName(PUMP_SWAP_PROGRAM_ID, 6027), "AccountTypeNotSupported");
  assert.equal(errorName(PUMP_SWAP_PROGRAM_ID, 6053), "BuybackFeeRecipientNotAuthorized");
});

test("the PumpSwap slippage vector names PumpSwap as the failing program", () => {
  const c = v.errors.find((x: { name: string }) => x.name === "pumpswap_slippage");
  const f = classifyFailure(c.err, c.logs, c.program_ids.map((x: string) => new PublicKey(x)));
  assert.equal(f.kind, "slippage");
  assert.ok(f.programId?.equals(PUMP_SWAP_PROGRAM_ID));
  assert.equal(f.name, "BuySlippageBelowMinBaseAmountOut");
});

// --- venue resolution with a fake connection -------------------------------------------

type Accounts = Map<string, AccountInfo<Uint8Array>>;
const info = (owner: PublicKey, data: Uint8Array): AccountInfo<Uint8Array> => ({
  owner,
  data,
  lamports: 1_000_000,
  executable: false,
  rentEpoch: 0,
});
const fake = (accounts: Accounts) =>
  ({
    getMultipleAccountsInfo: async (keys: PublicKey[]) => keys.map((x) => accounts.get(x.toBase58()) ?? null),
  }) as unknown as Connection;

/** Mint (82 bytes, supply 10^15), curve (complete or not), optionally the canonical pool. */
function world(p: { curve?: "open" | "complete"; pool?: Uint8Array; poolOwner?: PublicKey; cashbackCurve?: boolean }) {
  const m = Keypair.generate().publicKey;
  const accounts: Accounts = new Map();
  const mintData = new Uint8Array(82);
  mintData.set(u64(1_000_000_000_000_000n), 36);
  mintData[44] = 6;
  accounts.set(m.toBase58(), info(TOKEN_PROGRAM_ID, mintData));
  if (p.curve) {
    const curve = new Uint8Array(151);
    curve.set([23, 183, 248, 55, 96, 216, 172, 96]);
    curve.set(u64(1_000n), 8);
    curve.set(u64(1_000n), 16);
    curve[48] = p.curve === "complete" ? 1 : 0;
    curve[82] = p.cashbackCurve ? 1 : 0;
    accounts.set(bondingCurvePda(m).toBase58(), info(PUMP_PROGRAM_ID, curve));
  }
  if (p.pool) {
    const data = p.pool.slice();
    data.set(m.toBytes(), 43); // base_mint = this mint
    accounts.set(canonicalPoolPda(m).toBase58(), info(p.poolOwner ?? PUMP_SWAP_PROGRAM_ID, data));
  }
  return { m, accounts };
}

test("resolveVenue: open curve -> Curve; complete curve with a good canonical pool -> PumpSwap", async () => {
  const open = world({ curve: "open" });
  const r1 = await resolveVenue(fake(open.accounts), open.m);
  assert.equal(r1.ok && r1.venue, "Curve");

  const pooled = world({ curve: "complete", pool: poolBytes(5n) });
  const r2 = await resolveVenue(fake(pooled.accounts), pooled.m);
  assert.ok(r2.ok && r2.venue === "PumpSwap");
  if (r2.ok && r2.venue === "PumpSwap") {
    assert.ok(r2.poolAddress.equals(canonicalPoolPda(pooled.m)));
    assert.equal(r2.pool.virtualQuoteReserves, 5n);
  }
  // Mayhem pools trade through v2 (real_pumpswap.rs T6).
  const mayhem = world({ curve: "complete", pool: poolBytes(0n, { mayhem: true, cashback: false }) });
  const r3 = await resolveVenue(fake(mayhem.accounts), mayhem.m);
  assert.equal(r3.ok && r3.venue, "PumpSwap");
});

test("resolveVenue: the reasons it gives when no venue fits", async () => {
  const reason = async (w: ReturnType<typeof world>) => {
    const r = await resolveVenue(fake(w.accounts), w.m);
    assert.equal(r.ok, false);
    return r.ok ? "" : r.reason;
  };
  assert.equal(await reason(world({ curve: "complete" })), "curve complete, no canonical pool yet");
  assert.equal(await reason(world({ curve: "complete", pool: poolBytes(0n, { mayhem: false, cashback: true }) })), "cashback pool is not supported");
  assert.equal(await reason(world({})), "not a pump.fun token");
  assert.equal(await reason(world({ curve: "open", cashbackCurve: true })), "cashback coin is not supported");
  assert.equal(
    await reason(world({ curve: "complete", pool: poolBytes(0n), poolOwner: Keypair.generate().publicKey })),
    "canonical pool is not owned by PumpSwap",
  );
  const usdc = poolBytes(0n);
  usdc.set(k(9).toBytes(), 75); // quote_mint
  assert.equal(await reason(world({ curve: "complete", pool: usdc })), "pool is not paired with SOL");
  const missing = Keypair.generate().publicKey;
  const r = await resolveVenue(fake(new Map()), missing);
  assert.deepEqual(r, { ok: false, reason: "mint not found" });
});

test("findBuybackWsolAccounts keeps only existing WSOL accounts of the listed wallets", async () => {
  const [w1, w2, w3] = [Keypair.generate().publicKey, Keypair.generate().publicKey, Keypair.generate().publicKey];
  const tokenAccount = (mintKey: PublicKey, owner: PublicKey) => concat(mintKey.toBytes(), owner.toBytes(), u64(0n), new Uint8Array(93));
  const accounts: Accounts = new Map([
    [wsolAta(w1).toBase58(), info(TOKEN_PROGRAM_ID, tokenAccount(WSOL_MINT, w1))],
    // w2's ATA address holds something else: not usable.
    [wsolAta(w2).toBase58(), info(TOKEN_PROGRAM_ID, tokenAccount(k(9), w2))],
    // w3 has none (PumpSwap would fail with 6027).
  ]);
  const got = await findBuybackWsolAccounts(fake(accounts), [w1, w2, w3, PublicKey.default]);
  assert.deepEqual(got.map((x) => x.toBase58()), [wsolAta(w1).toBase58()]);
});

test("fetchPoolMarket reads reserves, fees and a usable buyback account", { skip: !existsSync(FIXTURE) }, async () => {
  const json = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const accounts: Accounts = new Map();
  for (const x of json.accounts) {
    if (x.exists) accounts.set(x.address, info(new PublicKey(x.owner), base64Decode(x.data)));
  }
  const fmint = new PublicKey(json.buy_accounts[3].address);
  // The fixture has no curve; mark it complete so resolveVenue goes to the pool.
  const curve = new Uint8Array(151);
  curve.set([23, 183, 248, 55, 96, 216, 172, 96]);
  curve[48] = 1;
  accounts.set(bondingCurvePda(fmint).toBase58(), info(PUMP_PROGRAM_ID, curve));
  const r = await resolveVenue(fake(accounts), fmint);
  assert.ok(r.ok && r.venue === "PumpSwap", r.ok ? r.venue : r.reason);
  if (!(r.ok && r.venue === "PumpSwap")) return;
  assert.ok(r.tokenProgram.equals(TOKEN_2022_PROGRAM_ID));
  const market = await fetchPoolMarket(fake(accounts), fmint, r);
  assert.equal(market.reserves.virtualTokenReserves, T5.base);
  assert.equal(market.reserves.virtualQuoteReserves, T5.effectiveQuote);
  assert.deepEqual(market.buybackWsolAccounts.map((x) => x.toBase58()), [json.buy_accounts[14].address]);
  const q = quotePoolOrder(T5.amount, market.reserves, market.feeConfig, market.supply);
  assert.equal(q.expectedTokensSeen, T5.actual);
});
