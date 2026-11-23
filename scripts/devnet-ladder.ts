// Devnet-only sender for Rung: open an order, try the rungs in turn, print a receipt.
//
//   npx tsx scripts/devnet-ladder.ts --mint <MINT> --amount 0.01 --mode tight
//       [--venue auto|curve|pool] (auto: the curve while it is open, then the canonical PumpSwap pool)
//       [--rungs 100,300] [--cu-price 5000] [--cu-limit <venue default>] [--window 4] [--lifetime 150]
//       [--keypair ~/.config/solana/rung-devnet.json] [--rpc <url>] [--dry-run]
//       [--push-after-open <SOL> | --push-pct <PERCENT>]   TEST AID: the wallet buys on the venue
//         right after open_order, so the price the rungs meet is higher than the one quoted
//   npx tsx scripts/devnet-ladder.ts --push-only --mint <MINT> --push-pct 4.5 [--wait-order <USER>] [--venue ...]
//       TEST AID: only the push buy, e.g. while the app runs its own order; with --wait-order
//       it fires as soon as that user's next order opens
//   npx tsx scripts/devnet-ladder.ts --find-mint [--limit 25]
//   npx tsx scripts/devnet-ladder.ts --find-pool [--limit 25]   canonical SOL pools from recent PumpSwap transactions
//   npx tsx scripts/devnet-ladder.ts --status | --refund | --cancel
//   npx tsx scripts/devnet-ladder.ts --mint <MINT> --amount 0.01 --simulate-buy --payer <PUBKEY> [--venue ...]
//
// The keypair file is read, never printed. The session key lives only in memory.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

import {
  BondingCurve,
  Connection,
  FeeConfig,
  Keypair,
  LadderResult,
  MAX_CAP_BPS,
  MAX_LIFETIME_SLOTS,
  MAX_ORDER_LAMPORTS,
  MAX_RUNGS,
  MAX_WINDOW_SLOTS,
  MIN_ORDER_LAMPORTS,
  MIN_WINDOW_SLOTS,
  MODES,
  Mode,
  ORDER_ACCOUNT_LEN,
  Order,
  POOL_DISCRIMINATOR,
  PUMP_IX,
  PUMP_PROGRAM_ID,
  PUMP_SWAP_PROGRAM_ID,
  PoolMarket,
  PublicKey,
  PumpGlobal,
  Reserves,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TransactionMessage,
  VersionedTransaction,
  WSOL_MINT,
  ammUserVolumeAccumulatorPda,
  associatedTokenAddress,
  base58Decode,
  base64Decode,
  bondingCurvePda,
  canonicalPoolPda,
  cancelIx,
  classifyFailure,
  closeTokenAccountIx,
  computeUnitLimitIx,
  createAtaIdempotentIx,
  cuLimitFor,
  decodeBondingCurve,
  decodeFeeConfig,
  decodeMint,
  decodeOrder,
  decodePool,
  decodePumpGlobal,
  describeFailure,
  feeBudget,
  fetchOrder,
  fetchPoolMarket,
  minTokensForRung,
  openOrderIx,
  orderPda,
  poolReserves,
  pumpBuyExactQuoteInV3Ix,
  pumpFeeConfigPda,
  pumpGlobalPda,
  pumpSwapBuyExactQuoteInV2Ix,
  quoteOrder,
  quotePoolOrder,
  rawQuote,
  refundIx,
  rentReserve,
  resolveVenue,
  runLadder,
  sendAndConfirm,
  startsWith,
  tokenAccountAmount,
  txFeeLamports,
  userVolumeAccumulatorPda,
  vaultPda,
  wrapSolIxs,
  wsolAta,
} from "../client/src/index";

// `solana genesis-hash -u devnet` / `-u mainnet-beta`, checked 2026-11-23.
const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const DEFAULT_RPC = "https://api.devnet.solana.com";
const DEFAULT_KEYPAIR = "~/.config/solana/rung-devnet.json";

const NO_FILL_TEXT = "Price went above your cap. Not bought. Your SOL is back.";

// --- small helpers -------------------------------------------------------------

type Flags = Record<string, string | true>;

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument: ${a}`);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[a.slice(2)] = next;
      i++;
    } else flags[a.slice(2)] = true;
  }
  return flags;
}

const str = (f: Flags, k: string) => (typeof f[k] === "string" ? (f[k] as string) : undefined);

function int(f: Flags, k: string, fallback: bigint): bigint {
  const s = str(f, k);
  if (s === undefined) return fallback;
  if (!/^\d+$/.test(s)) throw new Error(`--${k} must be a whole number`);
  return BigInt(s);
}

/** "0.01" -> 10_000_000 lamports, exactly. */
function parseSol(text: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,9}))?$/.exec(text);
  if (!m) throw new Error(`not a SOL amount with at most 9 decimals: ${text}`);
  return BigInt(m[1]) * 1_000_000_000n + BigInt((m[2] ?? "").padEnd(9, "0"));
}

function sol(lamports: bigint): string {
  const neg = lamports < 0n;
  const v = neg ? -lamports : lamports;
  const frac = (v % 1_000_000_000n).toString().padStart(9, "0");
  return `${neg ? "-" : ""}${v / 1_000_000_000n}.${frac} SOL`;
}

function units(amount: bigint, decimals: number): string {
  const s = amount.toString().padStart(decimals + 1, "0");
  return decimals === 0 ? s : `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}

/** Lamports per whole token, with 6 decimals. */
function pricePerToken(lamports: bigint, tokens: bigint, decimals: number): string {
  const scaled = (lamports * 10n ** BigInt(decimals) * 1_000_000n) / tokens;
  return `${scaled / 1_000_000n}.${(scaled % 1_000_000n).toString().padStart(6, "0")} lamports/token`;
}

const pct = (bps: number | bigint) => `${(Number(bps) / 100).toFixed(2)}%`;
const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const tokenProgramName = (p: PublicKey) =>
  p.equals(TOKEN_2022_PROGRAM_ID) ? "Token-2022" : p.equals(TOKEN_PROGRAM_ID) ? "SPL Token" : p.toBase58();

function loadKeypair(path: string): Keypair {
  const full = path.startsWith("~/") ? homedir() + path.slice(1) : path;
  if (!existsSync(full)) throw new Error(`keypair file not found: ${path}`);
  let bytes: number[];
  try {
    bytes = JSON.parse(readFileSync(full, "utf8"));
  } catch {
    // The parser's message can quote the file; never show it.
    throw new Error(`keypair file is not a JSON byte array: ${path}`);
  }
  try {
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  } catch {
    throw new Error(`keypair file does not hold a valid secret key: ${path}`);
  }
}

async function assertDevnet(connection: Connection) {
  const hash = await connection.getGenesisHash();
  if (hash === MAINNET_GENESIS_HASH) throw new Error("this RPC is MAINNET. This script runs on devnet only; nothing was sent.");
  if (hash !== DEVNET_GENESIS_HASH) throw new Error(`this RPC is not devnet (genesis ${hash}); nothing was sent.`);
}

// --- market --------------------------------------------------------------------

interface CurveMarket {
  venue: "Curve";
  mint: PublicKey;
  tokenProgram: PublicKey;
  decimals: number;
  supply: bigint;
  curve: BondingCurve;
  feeConfig: FeeConfig;
  global: PumpGlobal;
  /** One of pump's buyback wallets. */
  buybackRecipient: PublicKey;
}

interface PoolMarketPlan {
  venue: "PumpSwap";
  mint: PublicKey;
  tokenProgram: PublicKey;
  decimals: number;
  supply: bigint;
  pm: PoolMarket;
  /** A listed buyback wallet's wrapped-SOL account that exists. */
  buybackRecipient: PublicKey;
}

type Market = CurveMarket | PoolMarketPlan;

/** What the venue quotes for `amount`, in one shape for both venues. */
interface Quote {
  expectedTokensSeen: bigint;
  rawTokensSeen: bigint;
  marketCapLamports: bigint;
  /** Sum of the fee rates, for the push estimate. */
  feeBps: bigint;
  feeText: string;
}

const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];

/** `--venue auto|curve|pool`: auto asks `resolveVenue`. */
async function loadMarket(connection: Connection, mint: PublicKey, venueFlag = "auto"): Promise<Market> {
  if (!["auto", "curve", "pool"].includes(venueFlag)) throw new Error("--venue must be auto, curve or pool");
  if (venueFlag === "curve") return loadCurveMarket(connection, mint);
  const r = await resolveVenue(connection, mint);
  if (!r.ok) throw new Error(`no venue for this mint: ${r.reason}`);
  if (r.venue === "Curve") {
    if (venueFlag === "pool") throw new Error("the bonding curve is still open: this token has no canonical pool yet");
    return loadCurveMarket(connection, mint);
  }
  const pm = await fetchPoolMarket(connection, mint, r);
  return {
    venue: "PumpSwap",
    mint,
    tokenProgram: pm.tokenProgram,
    decimals: pm.decimals,
    supply: pm.supply,
    pm,
    buybackRecipient: pick(pm.buybackWsolAccounts),
  };
}

function quoteMarket(m: Market, amount: bigint): Quote {
  if (m.venue === "Curve") {
    const q = quoteOrder(amount, m.curve, m.feeConfig, m.supply);
    return {
      ...q,
      feeBps: q.protocolFeeBps + q.creatorFeeBps,
      feeText: `protocol ${q.protocolFeeBps} bps + creator ${q.creatorFeeBps} bps`,
    };
  }
  const q = quotePoolOrder(amount, m.pm.reserves, m.pm.feeConfig, m.supply);
  return {
    ...q,
    feeBps: q.lpFeeBps + q.protocolFeeBps + q.creatorFeeBps,
    feeText: `lp ${q.lpFeeBps} + protocol ${q.protocolFeeBps} + creator ${q.creatorFeeBps} bps (AMM fee_config tier)`,
  };
}

/** The reserves the price comes from now: the curve's, or the pool's effective ones. */
async function reservesNow(connection: Connection, m: Market): Promise<{ slot: number; reserves: Reserves }> {
  if (m.venue === "Curve") {
    const info = await connection.getAccountInfoAndContext(bondingCurvePda(m.mint), "confirmed");
    if (!info.value) throw new Error("curve vanished");
    return { slot: info.context.slot, reserves: decodeBondingCurve(info.value.data) };
  }
  const a = m.pm.poolAccounts;
  const got = await connection.getMultipleAccountsInfoAndContext([a.address, a.baseTokenAccount, a.quoteTokenAccount], "confirmed");
  const [pool, base, quote] = got.value;
  if (!pool || !base || !quote) throw new Error("pool vanished");
  return {
    slot: got.context.slot,
    reserves: poolReserves(decodePool(pool.data), tokenAccountAmount(base.data), tokenAccountAmount(quote.data)),
  };
}

async function loadCurveMarket(connection: Connection, mint: PublicKey): Promise<CurveMarket> {
  const [mintInfo, curveInfo, feeInfo, globalInfo] = await connection.getMultipleAccountsInfo([
    mint,
    bondingCurvePda(mint),
    pumpFeeConfigPda(),
    pumpGlobalPda(),
  ]);
  if (!mintInfo) throw new Error(`mint ${mint.toBase58()} not found`);
  const tokenProgram = mintInfo.owner;
  if (!tokenProgram.equals(TOKEN_PROGRAM_ID) && !tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error(`mint is owned by ${tokenProgram.toBase58()}, not a token program`);
  }
  if (!curveInfo) throw new Error("this mint has no pump bonding curve");
  if (!curveInfo.owner.equals(PUMP_PROGRAM_ID)) throw new Error("bonding curve account is not owned by pump");
  const curve = decodeBondingCurve(curveInfo.data);
  if (curve.complete) throw new Error("the bonding curve is complete: the token trades in a pool now");
  if (!curve.quoteMint.equals(PublicKey.default)) throw new Error(`curve is paired with ${curve.quoteMint.toBase58()}, not SOL`);
  if (curve.isCashbackCoin) throw new Error("cashback coin: pump's v3 buy does not support it (6094)");
  if (!feeInfo) throw new Error("pump fee_config not found on this cluster");
  if (!globalInfo) throw new Error("pump global not found on this cluster");
  const global = decodePumpGlobal(globalInfo.data);
  const recipients = global.buybackFeeRecipients.filter((k) => !k.equals(PublicKey.default));
  if (recipients.length === 0) throw new Error("pump global lists no buyback fee recipients");
  const { supply, decimals } = decodeMint(mintInfo.data);
  return {
    venue: "Curve",
    mint,
    tokenProgram,
    decimals,
    supply,
    curve,
    feeConfig: decodeFeeConfig(feeInfo.data),
    global,
    buybackRecipient: pick(recipients),
  };
}

// --- plan ------------------------------------------------------------------------

interface Plan {
  market: Market;
  mode: Mode;
  rungs: number[];
  amount: bigint;
  windowSlots: bigint;
  lifetimeSlots: bigint;
  cuLimit: number;
  cuPrice: bigint;
  quote: Quote;
  reserve: Awaited<ReturnType<typeof rentReserve>>;
  budget: ReturnType<typeof feeBudget>;
  openFee: bigint;
  orderRent: bigint;
}

function chooseRungs(flags: Flags): { mode: Mode; rungs: number[] } {
  const list = str(flags, "rungs");
  if (list) {
    const rungs = list.split(",").map((s) => Number(s.trim()));
    return { mode: "custom", rungs };
  }
  const mode = (str(flags, "mode") ?? "tight").toLowerCase();
  if (!(mode in MODES)) throw new Error(`unknown mode ${mode}: use tight, normal, fast, launch or --rungs`);
  return { mode: mode as Mode, rungs: [...MODES[mode as keyof typeof MODES]] };
}

function checkRungs(rungs: number[]) {
  if (rungs.length < 1 || rungs.length > MAX_RUNGS) throw new Error(`an order needs 1 to ${MAX_RUNGS} rungs`);
  let previous = 0;
  for (const r of rungs) {
    if (!Number.isInteger(r) || r <= previous) throw new Error("rungs must be whole basis points, above zero and increasing");
    previous = r;
  }
  if (previous > MAX_CAP_BPS) throw new Error(`the cap (last rung) may be at most ${MAX_CAP_BPS} bps`);
}

async function makePlan(connection: Connection, flags: Flags, mint: PublicKey): Promise<Plan> {
  const { mode, rungs } = chooseRungs(flags);
  checkRungs(rungs);
  const amountText = str(flags, "amount");
  if (!amountText) throw new Error("--amount <SOL> is required");
  const amount = parseSol(amountText);
  if (amount < MIN_ORDER_LAMPORTS || amount > MAX_ORDER_LAMPORTS) {
    throw new Error(`amount must be between ${sol(MIN_ORDER_LAMPORTS)} and ${sol(MAX_ORDER_LAMPORTS)}`);
  }
  const windowSlots = int(flags, "window", 4n);
  const lifetimeSlots = int(flags, "lifetime", 150n);
  if (windowSlots < MIN_WINDOW_SLOTS || windowSlots > MAX_WINDOW_SLOTS) throw new Error("--window out of range (1..16)");
  if (lifetimeSlots <= BigInt(rungs.length - 1) * windowSlots || lifetimeSlots > MAX_LIFETIME_SLOTS) {
    throw new Error("--lifetime must outlast the last rung and be at most 300 slots");
  }
  const cuPrice = int(flags, "cu-price", 5_000n);

  const market = await loadMarket(connection, mint, str(flags, "venue"));
  const cuLimit = Number(int(flags, "cu-limit", BigInt(cuLimitFor(market.venue))));
  const quote = quoteMarket(market, amount);
  const rentCache = new Map<number, bigint>();
  const rentFor = async (len: number) => {
    if (!rentCache.has(len)) rentCache.set(len, BigInt(await connection.getMinimumBalanceForRentExemption(len)));
    return rentCache.get(len)!;
  };
  const reserve = await rentReserve(rentFor, market.tokenProgram, undefined, market.venue);
  const budget = feeBudget({ rungCount: rungs.length, rentExemptMinimum: await rentFor(0), cuLimit, cuPrice });
  return {
    market,
    mode,
    rungs,
    amount,
    windowSlots,
    lifetimeSlots,
    cuLimit,
    cuPrice,
    quote,
    reserve,
    budget,
    openFee: txFeeLamports(),
    orderRent: await rentFor(ORDER_ACCOUNT_LEN),
  };
}

const maxFeeIfNoFill = (p: Plan) => p.budget.tries + p.budget.refund + p.budget.sweep + p.openFee;

function printPlan(p: Plan, user?: PublicKey, userBalance?: bigint, orderExists?: boolean) {
  const { market: m, quote: q } = p;
  console.log("Plan (devnet)");
  console.log(`  mint            ${m.mint.toBase58()} (${tokenProgramName(m.tokenProgram)}, ${m.decimals} decimals)`);
  if (m.venue === "Curve") {
    console.log("  venue           Curve (pump bonding curve)");
    console.log(`  curve           virtual token ${m.curve.virtualTokenReserves}, virtual SOL ${m.curve.virtualQuoteReserves} lamports, real token ${m.curve.realTokenReserves}`);
  } else {
    const pm = m.pm;
    console.log("  venue           PumpSwap (canonical pool)");
    console.log(`  pool            ${pm.poolAccounts.address.toBase58()} (${pm.pool.dataLength} bytes${pm.pool.isMayhemMode ? ", mayhem" : ""})`);
    console.log(`  reserves        base ${pm.baseBalance}; quote ${pm.quoteBalance} lamports + virtual ${pm.pool.virtualQuoteReserves} = ${pm.reserves.virtualQuoteReserves} effective`);
    console.log(`  buyback account ${m.buybackRecipient.toBase58()} (${pm.buybackWsolAccounts.length}/8 listed wallets have one)`);
  }
  console.log(`  market cap      ${sol(q.marketCapLamports)}; fee tier: ${q.feeText}`);
  console.log(`  amount          ${sol(p.amount)}`);
  console.log(`  quote           ${units(q.expectedTokensSeen, m.decimals)} tokens (fee-free ${units(q.rawTokensSeen, m.decimals)})`);
  console.log(`  price seen      ${pricePerToken(p.amount, q.expectedTokensSeen, m.decimals)}`);
  console.log(`  mode            ${p.mode}; window ${p.windowSlots} slots; lifetime ${p.lifetimeSlots} slots`);
  const cap = p.rungs[p.rungs.length - 1];
  p.rungs.forEach((bps, i) => {
    const min = minTokensForRung(q.expectedTokensSeen, q.expectedTokensSeen, bps, cap);
    console.log(`  rung ${i}          +${pct(bps)} (${bps} bps), due at start + ${BigInt(i) * p.windowSlots} slots, at least ${units(min, m.decimals)} tokens if the price has not moved`);
  });
  console.log(`  cap             +${pct(cap)} above the price seen`);
  console.log(`  If no rung fills, max fee: ${sol(maxFeeIfNoFill(p)).replace(" SOL", "")} SOL`);
  console.log(`    = ${p.rungs.length} tries x ${sol(p.budget.tries / BigInt(p.rungs.length))} (CU limit ${p.cuLimit}, CU price ${p.cuPrice} micro-lamports)`);
  console.log(`      + refund ${sol(p.budget.refund)} + sweep ${sol(p.budget.sweep)} + open_order ${sol(p.openFee)}`);
  const wsolPart = p.reserve.vaultWsolAccount ? `, vault wrapped-SOL account ${sol(p.reserve.vaultWsolAccount)}` : "";
  const accName = m.venue === "Curve" ? "pump" : "PumpSwap";
  console.log(`  rent reserve    ${sol(p.reserve.total)} (your token account ${sol(p.reserve.userTokenAccount)}, vault token account ${sol(p.reserve.vaultTokenAccount)}${wsolPart}, ${accName} volume account ${sol(p.reserve.accumulator)}, margin ${sol(p.reserve.margin)}); unspent comes back`);
  console.log(`  fee budget      ${sol(p.budget.total)} to the session key (includes ${sol(p.budget.rentExemptMinimum)} rent-exempt minimum); unspent comes back`);
  console.log(`  order account   ${orderExists ? "exists, reused" : `${sol(p.orderRent)} rent, returned when the order account is closed`}`);
  const leaving = p.amount + p.reserve.total + p.budget.total + (orderExists ? 0n : p.orderRent) + p.openFee;
  console.log(`  leaves wallet   ${sol(leaving)} when the order opens`);
  if (user) {
    console.log(`  wallet          ${user.toBase58()}: ${userBalance !== undefined ? sol(userBalance) : "?"}`);
    if (userBalance !== undefined && userBalance < leaving) console.log("  NOTE            the wallet holds less than this; open_order would fail");
  }
}

// --- run --------------------------------------------------------------------------

async function run(connection: Connection, flags: Flags, mint: PublicKey) {
  const keypairPath = str(flags, "keypair") ?? DEFAULT_KEYPAIR;
  const dryRun = flags["dry-run"] === true;
  let user: Keypair | undefined;
  try {
    user = loadKeypair(keypairPath);
  } catch (e) {
    if (!dryRun) throw e;
    console.log(`(no wallet: ${(e as Error).message})`);
  }
  const plan = await makePlan(connection, flags, mint);
  const m = plan.market;
  const u = user?.publicKey;
  const vault = u ? vaultPda(u) : undefined;
  const accumulatorOf = (owner: PublicKey) =>
    m.venue === "Curve" ? userVolumeAccumulatorPda(owner) : ammUserVolumeAccumulatorPda(owner);
  const before = u
    ? await connection.getMultipleAccountsInfo([
        u,
        orderPda(u),
        associatedTokenAddress(u, mint, m.tokenProgram),
        accumulatorOf(vault!),
      ])
    : [];
  const [userInfo, orderInfo, ataInfo, accInfo] = before;
  printPlan(plan, u, userInfo ? BigInt(userInfo.lamports) : u ? 0n : undefined, !!orderInfo);
  if (dryRun) {
    console.log("--dry-run: nothing sent.");
    return;
  }
  if (!user || !u) throw new Error("no wallet");
  if (orderInfo && decodeOrder(orderInfo.data).status === "Open") {
    throw new Error("this wallet already has an open order: see --status, --refund or --cancel");
  }

  const balanceBefore = BigInt(await connection.getBalance(u, "confirmed"));
  const session = Keypair.generate();
  console.log(`\nsession key ${session.publicKey.toBase58()} (in memory only)`);

  const open = openOrderIx({
    user: u,
    sessionKey: session.publicKey,
    mint,
    pool: m.venue === "PumpSwap" ? m.pm.poolAccounts : undefined,
    args: {
      venue: m.venue,
      rungsBps: plan.rungs,
      amount: plan.amount,
      rentReserve: plan.reserve.total,
      feeBudget: plan.budget.total,
      expectedTokensSeen: plan.quote.expectedTokensSeen,
      rawTokensSeen: plan.quote.rawTokensSeen,
      windowSlots: plan.windowSlots,
      lifetimeSlots: plan.lifetimeSlots,
    },
  });
  const opened = await sendAndConfirm(connection, [open], user);
  console.log(`open_order ${opened.signature} slot ${opened.slot ?? "?"} fee ${opened.fee ?? "?"}`);
  if (!opened.landed) throw new Error("open_order did not land (blockhash expired); nothing was opened");
  if (opened.err) throw new Error(`open_order failed: ${describeFailure(classifyFailure(opened.err, opened.logs, [open.programId]))}`);

  const order = await fetchOrder(connection, u);
  if (!order) throw new Error("order account not readable after open_order");
  console.log(`order open: start slot ${order.startSlot}, last slot ${order.lastSlot}, start quote ${order.expectedTokensStart}`);

  const push = await pushPrice(connection, flags, user, plan);

  const result = await runLadder({
    connection,
    user: u,
    mint,
    tokenProgram: m.tokenProgram,
    buybackRecipient: m.buybackRecipient,
    pool: m.venue === "PumpSwap" ? m.pm.poolAccounts : undefined,
    sessionKeypair: session,
    order,
    cuLimit: plan.cuLimit,
    cuPrice: plan.cuPrice,
    onEvent: (e) => {
      if (e.type === "sent") console.log(`  sent ${e.kind}${e.rungIndex !== undefined ? ` ${e.rungIndex}` : ""}: ${e.signature}`);
      if (e.type === "result") console.log(`  ${e.text}`);
    },
  });

  const balanceAfter = BigInt(await connection.getBalance(u, "confirmed"));
  const after = await connection.getMultipleAccountsInfo([
    orderPda(u),
    associatedTokenAddress(u, mint, m.tokenProgram),
    accumulatorOf(vault!),
  ]);
  // Where the price stands after the last try (fee-free quote for the order amount).
  const now = await reservesNow(connection, m).catch(() => undefined);
  const rawNow = now ? rawQuote(order.amount, now.reserves) : undefined;
  printReceipt({
    plan,
    order,
    opened: { signature: opened.signature, slot: opened.slot, fee: opened.fee ?? 0n, computeUnits: opened.computeUnits },
    result,
    balanceBefore,
    balanceAfter,
    push,
    priceNow: rawNow && now ? { slot: now.slot, rawTokens: rawNow } : undefined,
    rents: {
      order: !orderInfo && after[0] ? BigInt(after[0].lamports) : 0n,
      // An earlier order's account, reused and now closed by refund: its rent comes back.
      orderReturned: orderInfo && !after[0] ? BigInt(orderInfo.lamports) : 0n,
      // A push buy creates the token account first; its rent is in the push cost.
      userTokenAccount: !ataInfo && !push && after[1] ? BigInt(after[1].lamports) : 0n,
      accumulator: !accInfo && after[2] ? BigInt(after[2].lamports) : 0n,
    },
  });
}

// --- TEST AID: move the price after the order opened -----------------------------------
// Not part of the app. The same wallet buys directly on pump right after
// open_order, so the rungs see a higher price than the one quoted.

/**
 * A plain wallet's buy on the venue (the base token account must exist).
 * PumpSwap is paid in wrapped SOL: wrap `spendable`, buy, then close the
 * wrapped-SOL account so what is left and its rent come back as SOL.
 */
function directBuyIxs(m: Market, buyer: PublicKey, spendable: bigint, minTokensOut: bigint) {
  if (m.venue === "Curve") {
    return [
      pumpBuyExactQuoteInV3Ix({ buyer, mint: m.mint, tokenProgram: m.tokenProgram, buybackRecipient: m.buybackRecipient, spendable, minTokensOut }),
    ];
  }
  return [
    ...wrapSolIxs(buyer, spendable),
    pumpSwapBuyExactQuoteInV2Ix({
      buyer,
      mint: m.mint,
      tokenProgram: m.tokenProgram,
      pool: m.pm.poolAccounts,
      buybackWsolAccount: m.buybackRecipient,
      spendable,
      minTokensOut,
    }),
    closeTokenAccountIx({ account: wsolAta(buyer), destination: buyer, owner: buyer, tokenProgram: TOKEN_PROGRAM_ID }),
  ];
}

interface Push {
  signature: string;
  slot?: number;
  fee?: bigint;
  computeUnits?: number;
  ok: boolean;
  /** Wallet balance change of the push transaction (buy, fee, rents). */
  walletCost: bigint;
}

async function pushPrice(connection: Connection, flags: Flags, user: Keypair, plan: Plan): Promise<Push | undefined> {
  const solText = str(flags, "push-after-open");
  const pctText = str(flags, "push-pct");
  if (!solText && !pctText) return undefined;
  const m = plan.market;
  const mint = m.mint;
  const before = await reservesNow(connection, m);
  const vq = before.reserves.virtualQuoteReserves;
  let spendable: bigint;
  if (pctText) {
    // Price ~ quote / tokens; a net buy of dq multiplies it by (1 + dq / quote)^2.
    const target = Number(pctText) / 100;
    if (!(target > 0 && target < 1)) throw new Error("--push-pct must be between 0 and 100");
    const net = BigInt(Math.ceil(Number(vq) * (Math.sqrt(1 + target) - 1)));
    spendable = (net * (10_000n + plan.quote.feeBps)) / 10_000n + 2n; // + 1 lamport the formula keeps back
  } else spendable = parseSol(solText!);

  const where = m.venue === "Curve" ? "pump buy" : "PumpSwap buy (wraps SOL first)";
  console.log(`\nTEST AID: pushing the price with a direct ${where} of ${sol(spendable)}${pctText ? ` (target +${pctText}%)` : ""}`);
  const balanceBefore = BigInt(await connection.getBalance(user.publicKey, "confirmed"));
  const ixs = [
    computeUnitLimitIx(200_000),
    createAtaIdempotentIx({ payer: user.publicKey, owner: user.publicKey, mint, tokenProgram: m.tokenProgram }),
    ...directBuyIxs(m, user.publicKey, spendable, 1n),
  ];
  const landed = await sendAndConfirm(connection, ixs, user);
  // A rate-limited balance read must not hide that the push landed.
  const balanceAfter = BigInt(await connection.getBalance(user.publicKey, "confirmed").catch(() => Number(balanceBefore)));
  const ok = landed.landed && !landed.err;
  console.log(`TEST AID: push buy ${landed.signature} slot ${landed.slot ?? "?"} fee ${landed.fee ?? "?"} CU ${landed.computeUnits ?? "?"} ${ok ? "ok" : `FAILED ${JSON.stringify(landed.err ?? "not landed")}`}`);
  const after = await reservesNow(connection, m);
  const price = (c: Reserves) => Number(c.virtualQuoteReserves) / Number(c.virtualTokenReserves);
  const change = (price(after.reserves) / price(before.reserves) - 1) * 100;
  const quoteChange = Number((rawQuote(plan.amount, before.reserves) * 1_000_000n) / rawQuote(plan.amount, after.reserves) - 1_000_000n) / 10_000;
  console.log(`TEST AID: reserves before (slot ${before.slot}) tokens ${before.reserves.virtualTokenReserves} quote ${before.reserves.virtualQuoteReserves}`);
  console.log(`TEST AID: reserves after  (slot ${after.slot}) tokens ${after.reserves.virtualTokenReserves} quote ${after.reserves.virtualQuoteReserves}`);
  console.log(`TEST AID: spot price +${change.toFixed(4)}%; price for ${sol(plan.amount)} +${quoteChange.toFixed(4)}%`);
  return {
    signature: landed.signature,
    slot: landed.slot,
    fee: landed.fee,
    computeUnits: landed.computeUnits,
    ok,
    walletCost: balanceBefore - balanceAfter,
  };
}

/**
 * TEST AID: only pushes the price, for testing another wallet's order (the app).
 * With `--wait-order <USER>` it first waits until that user's order opens
 * (polled at `processed`), then buys at once, so the push lands between
 * `open_order` and the rungs. Without it, it pushes now.
 */
async function pushOnly(connection: Connection, flags: Flags, mint: PublicKey) {
  if (!str(flags, "push-pct") && !str(flags, "push-after-open")) throw new Error("--push-only needs --push-pct or --push-after-open");
  const user = loadKeypair(str(flags, "keypair") ?? DEFAULT_KEYPAIR);
  const amount = parseSol(str(flags, "amount") ?? "0.01");
  const market = await loadMarket(connection, mint, str(flags, "venue"));
  console.log(`TEST AID: venue ${market.venue}${market.venue === "PumpSwap" ? `, pool ${market.pm.poolAccounts.address.toBase58()}` : ""}`);
  const plan = { market, amount, quote: quoteMarket(market, amount) } as Plan;
  const waitFor = str(flags, "wait-order");
  if (waitFor) {
    const owner = new PublicKey(waitFor);
    const pda = orderPda(owner);
    const startOf = async () => {
      const info = await connection.getAccountInfo(pda, "processed");
      if (!info) return undefined;
      const o = decodeOrder(info.data);
      return o.status === "Open" ? o.startSlot : undefined;
    };
    const known = await startOf();
    const timeoutMs = Number(int(flags, "wait-seconds", 180n)) * 1000;
    console.log(`TEST AID: waiting up to ${timeoutMs / 1000}s for a new open order of ${owner.toBase58()}${known !== undefined ? ` (an open order from slot ${known} is ignored)` : ""}`);
    // One websocket subscription instead of polling: the public devnet RPC
    // limits requests per IP, and the app under test shares that IP.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        void connection.removeAccountChangeListener(id);
        reject(new Error("no new order opened in time; nothing pushed"));
      }, timeoutMs);
      const id = connection.onAccountChange(
        pda,
        (info) => {
          let o: Order;
          try {
            o = decodeOrder(info.data);
          } catch {
            return; // closed (refunded): no order to push against
          }
          if (o.status === "Open" && o.startSlot !== known) {
            console.log(`TEST AID: order opened at slot ${o.startSlot}; pushing now`);
            clearTimeout(timer);
            void connection.removeAccountChangeListener(id);
            resolve();
          }
        },
        "processed",
      );
    });
  }
  await pushPrice(connection, flags, user, plan);
}

function printReceipt(r: {
  plan: Plan;
  order: Order;
  opened: { signature: string; slot?: number; fee: bigint; computeUnits?: number };
  result: LadderResult;
  balanceBefore: bigint;
  balanceAfter: bigint;
  push?: Push;
  priceNow?: { slot: number; rawTokens: bigint };
  rents: { order: bigint; orderReturned: bigint; userTokenAccount: bigint; accumulator: bigint };
}) {
  const { plan, result } = r;
  const d = plan.market.decimals;
  console.log("\nReceipt");
  const filled = result.filled;
  let spent = 0n;
  if (filled) {
    spent = filled.lamportsSpent;
    console.log(`  Filled at rung ${filled.rungIndex} (+${pct(filled.rungBps)}).`);
    console.log(`  tokens bought   ${units(filled.tokensBought, d)}`);
    const seen = pricePerToken(r.order.amount, r.order.expectedTokensSeen, d);
    const paid = pricePerToken(filled.lamportsSpent, filled.tokensBought, d);
    // paid / seen - 1, in basis points with two decimals.
    const diff =
      (filled.lamportsSpent * r.order.expectedTokensSeen * 1_000_000n) / (r.order.amount * filled.tokensBought) - 1_000_000n;
    console.log(`  price seen      ${seen}`);
    console.log(`  price paid      ${paid} (${diff >= 0n ? "+" : ""}${(Number(diff) / 10_000).toFixed(4)}% vs seen)`);
  } else if (result.attempts.some((a) => a.outcome === "order-filled")) {
    console.log("  The order had already bought (OrderFilled).");
  } else if (result.refunded) {
    console.log(`  ${NO_FILL_TEXT}`);
    const lastTry = [...result.attempts].reverse().find((a) => a.kind === "try");
    if (r.priceNow) {
      // Fee-free quotes for the same amount: price ratio = raw seen / raw now.
      const above = (plan.quote.rawTokensSeen * 1_000_000n) / r.priceNow.rawTokens - 1_000_000n;
      console.log(
        `  price now       ${(Number(above) / 10_000).toFixed(4)}% above the price seen (curve read at slot ${r.priceNow.slot}; last try landed in slot ${lastTry?.slot ?? "?"})`,
      );
    }
  } else {
    console.log("  Not bought, and the refund did not go through: run --status, then --refund after expiry or --cancel.");
  }

  console.log("  transactions");
  type Row = { what: string; signature: string; slot?: number; fee?: bigint; cu?: number; outcome: string };
  const rows: Row[] = [
    { what: "open_order (wallet)", signature: r.opened.signature, slot: r.opened.slot, fee: r.opened.fee, cu: r.opened.computeUnits, outcome: "ok" },
  ];
  if (r.push) {
    const p = r.push;
    rows.push({ what: "TEST AID push buy", signature: p.signature, slot: p.slot, fee: p.fee, cu: p.computeUnits, outcome: p.ok ? "ok" : "failed" });
  }
  rows.push(
    ...result.attempts.map((a) => ({
      what: a.kind === "try" ? `try_rung ${a.rungIndex} (${a.rungBps} bps)` : a.kind,
      signature: a.signature,
      slot: a.slot,
      fee: a.fee,
      cu: a.computeUnits,
      outcome: a.failure ? `${a.outcome}: ${describeFailure(a.failure)}` : a.outcome,
    })),
  );
  for (const row of rows) {
    console.log(
      `    ${row.what.padEnd(24)} slot ${String(row.slot ?? "-").padEnd(10)} fee ${String(row.fee ?? "-").padEnd(7)} CU ${String(row.cu ?? "-").padEnd(7)} ${row.outcome}`,
    );
    if (row.signature) console.log(`      ${explorer(row.signature)}`);
  }
  const totalFees = r.opened.fee + result.totalFees;
  console.log(`  total fees      ${sol(totalFees)}`);
  console.log(`  session key     ${result.sessionBalanceAfter === 0n ? "emptied (0 lamports)" : `still holds ${result.sessionBalanceAfter} lamports`}`);

  const delta = r.balanceAfter - r.balanceBefore;
  const rents = r.rents.order + r.rents.userTokenAccount + r.rents.accumulator;
  console.log(`  wallet SOL      before ${sol(r.balanceBefore)}, after ${sol(r.balanceAfter)}, change ${sol(delta)}`);
  console.log(`    buy           ${sol(-spent)}`);
  console.log(`    fees          ${sol(-totalFees)}`);
  if (r.rents.userTokenAccount) console.log(`    rent kept     ${sol(-r.rents.userTokenAccount)} your new token account`);
  if (r.rents.accumulator) {
    const owner = plan.market.venue === "Curve" ? "pump" : "PumpSwap";
    console.log(`    rent kept     ${sol(-r.rents.accumulator)} ${owner} volume account of the vault`);
  }
  if (r.rents.order) console.log(`    rent kept     ${sol(-r.rents.order)} order account (back with --refund after slot ${r.order.lastSlot})`);
  const pushCost = r.push?.walletCost ?? 0n;
  if (r.push) console.log(`    TEST AID push ${sol(-pushCost)} (direct pump buy, its fee and any rent it paid; not part of the order)`);
  if (r.rents.orderReturned) {
    console.log(`    rent back     ${sol(r.rents.orderReturned)} order account of an earlier order, closed by this refund`);
  }
  const rest = delta + spent + totalFees + rents + pushCost - r.rents.orderReturned;
  if (rest !== 0n) console.log(`    unexplained   ${sol(rest)}`);
}

// --- status / refund / cancel ----------------------------------------------------------

async function status(connection: Connection, user: PublicKey) {
  const [orderInfo, vaultInfo] = await connection.getMultipleAccountsInfo([orderPda(user), vaultPda(user)]);
  const slot = BigInt(await connection.getSlot("confirmed"));
  console.log(`wallet ${user.toBase58()}`);
  console.log(`vault  ${vaultPda(user).toBase58()}: ${sol(BigInt(vaultInfo?.lamports ?? 0))}`);
  if (!orderInfo) {
    console.log("no order account");
    return;
  }
  const o = decodeOrder(orderInfo.data);
  console.log(`order  ${orderPda(user).toBase58()}: ${o.status}, mint ${o.mint.toBase58()}`);
  console.log(`  rungs ${o.rungsBps.join(", ")} bps; amount ${sol(o.amount)}; rent reserve ${sol(o.rentReserve)}`);
  console.log(`  quotes seen ${o.expectedTokensSeen}, start ${o.expectedTokensStart}`);
  console.log(`  slots start ${o.startSlot}, window ${o.windowSlots}, last ${o.lastSlot}; now ${slot} (${slot >= o.lastSlot ? "expired" : "open"})`);
  console.log(`  session key ${o.sessionKey.toBase58()}`);
  if (o.status === "Filled") console.log(`  filled at rung ${o.filledRung}: ${o.tokensBought} tokens for ${sol(o.lamportsSpent)}`);
}

async function refundOrCancel(connection: Connection, user: Keypair, kind: "refund" | "cancel") {
  const info = await connection.getAccountInfo(orderPda(user.publicKey), "confirmed");
  if (!info) throw new Error("no order account");
  const o = decodeOrder(info.data);
  const slot = BigInt(await connection.getSlot("confirmed"));
  if (kind === "refund" && slot < o.lastSlot) {
    throw new Error(`order expires at slot ${o.lastSlot} (now ${slot}); ${o.status === "Open" ? "use --cancel to end it now" : "try again then"}`);
  }
  if (kind === "cancel" && o.status !== "Open") throw new Error(`order is ${o.status}; only an open order can be cancelled`);
  const ix = kind === "refund" ? refundIx({ caller: user.publicKey, user: user.publicKey }) : cancelIx({ user: user.publicKey });
  const landed = await sendAndConfirm(connection, [ix], user);
  if (!landed.landed) throw new Error(`${kind} did not land`);
  if (landed.err) throw new Error(`${kind} failed: ${describeFailure(classifyFailure(landed.err, landed.logs, [ix.programId]))}`);
  console.log(`${kind} ${landed.signature} fee ${landed.fee}\n  ${explorer(landed.signature)}`);
}

// --- find a mint ------------------------------------------------------------------------

const BUY_KINDS: [string, readonly number[], number][] = [
  // name, discriminator, index of the mint among the instruction's accounts
  ["buy_exact_quote_in_v3", PUMP_IX.buyExactQuoteInV3, 1],
  ["buy_v3", PUMP_IX.buyV3, 1],
  ["buy_exact_quote_in_v2", PUMP_IX.buyExactQuoteInV2, 1],
  ["buy_v2", PUMP_IX.buyV2, 1],
  ["buy_exact_sol_in", PUMP_IX.buyExactSolIn, 2],
  ["buy", PUMP_IX.buy, 2],
];

/** Other pump discriminators seen on devnet (sha256("global:<name>")[..8]). */
const OTHER_NAMES: Record<string, string> = {
  "228,69,165,46,81,203,154,29": "(emit_cpi event)",
  "51,230,133,164,1,127,131,173": "sell",
  "28,146,222,119,38,196,105,213": "sell_v3",
  "214,144,76,236,95,139,49,180": "create_v2",
  "234,102,194,203,150,72,62,229": "extend_account",
  "32,246,191,52,8,201,73,186": "sweep_creator_fee",
  "165,114,103,0,121,206,247,81": "distribute_creator_fees",
};

async function getTx(connection: Connection, signature: string) {
  try {
    return await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 1 });
  } catch {
    return await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function findMints(connection: Connection, limit: number) {
  const sigs = (await connection.getSignaturesForAddress(PUMP_PROGRAM_ID, { limit })).filter((s) => !s.err);
  const counts = new Map<string, number>();
  const mints = new Map<string, string>();
  const v3Buyers = new Set<string>();
  for (const s of sigs) {
    const tx = await getTx(connection, s.signature);
    await pause(250); // public devnet RPC rate limit
    if (!tx?.meta) continue;
    const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
    const ixs: { program: PublicKey; accounts: number[]; data: Uint8Array }[] = [
      ...tx.transaction.message.compiledInstructions.map((c) => ({
        program: keys.get(c.programIdIndex)!,
        accounts: c.accountKeyIndexes,
        data: c.data,
      })),
      ...(tx.meta.innerInstructions ?? []).flatMap((g) =>
        g.instructions.map((c) => ({ program: keys.get(c.programIdIndex)!, accounts: c.accounts, data: base58Decode(c.data) })),
      ),
    ];
    for (const ix of ixs) {
      if (!ix.program.equals(PUMP_PROGRAM_ID)) continue;
      const kind = BUY_KINDS.find(([, disc]) => startsWith(ix.data, disc));
      const disc = Array.from(ix.data.slice(0, 8)).join(",");
      const name = kind?.[0] ?? OTHER_NAMES[disc] ?? `unknown [${disc}]`;
      counts.set(name, (counts.get(name) ?? 0) + 1);
      if (!kind) continue;
      const mint = keys.get(ix.accounts[kind[2]]);
      if (mint && !mints.has(mint.toBase58())) mints.set(mint.toBase58(), name);
      if (name === "buy_exact_quote_in_v3" || name === "buy_v3") v3Buyers.add(keys.get(ix.accounts[8])!.toBase58());
    }
  }
  console.log(`scanned ${sigs.length} recent successful pump transactions on devnet`);
  console.log("pump instructions seen:");
  for (const [name, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${name}`);
  if (v3Buyers.size) console.log(`recent v3 buyers (for --simulate-buy --payer): ${[...v3Buyers].slice(0, 3).join(", ")}`);

  const [feeInfo, globalInfo] = await connection.getMultipleAccountsInfo([pumpFeeConfigPda(), pumpGlobalPda()]);
  if (feeInfo) {
    const f = decodeFeeConfig(feeInfo.data);
    console.log(`fee_config ${pumpFeeConfigPda().toBase58()} (${feeInfo.data.length} bytes): flat ${fmtFees(f.flatFees)}; ${f.feeTiers.length} tiers`);
    for (const t of f.feeTiers) console.log(`  tier >= ${sol(t.marketCapLamportsThreshold)}: ${fmtFees(t.fees)}`);
  } else console.log("fee_config: not found");
  if (globalInfo) {
    const g = decodePumpGlobal(globalInfo.data);
    const set = g.buybackFeeRecipients.filter((k) => !k.equals(PublicKey.default)).length;
    console.log(`global (${globalInfo.data.length} bytes): fee ${g.feeBasisPoints} bps, creator ${g.creatorFeeBasisPoints} bps, buyback ${g.buybackBasisPoints} bps, ${set}/8 buyback recipients set`);
  } else console.log("global: not found");

  const list = [...mints.keys()].slice(0, 12).map((m) => new PublicKey(m));
  const infos = await connection.getMultipleAccountsInfo([...list.map(bondingCurvePda), ...list]);
  console.log("\nmints from recent buys (open, SOL-paired curves marked *):");
  list.forEach((mint, i) => {
    const curveInfo = infos[i];
    const mintInfo = infos[list.length + i];
    if (!curveInfo || !mintInfo) return console.log(`  ${mint.toBase58()}  no curve`);
    const c = decodeBondingCurve(curveInfo.data);
    const usable = !c.complete && c.quoteMint.equals(PublicKey.default) && !c.isCashbackCoin;
    const { supply, decimals } = decodeMint(mintInfo.data);
    console.log(
      `${usable ? "*" : " "} ${mint.toBase58()}  ${tokenProgramName(mintInfo.owner)}  vt ${c.virtualTokenReserves} vq ${c.virtualQuoteReserves} real_t ${c.realTokenReserves}` +
        `  mcap ${sol((c.virtualQuoteReserves * supply) / (c.virtualTokenReserves || 1n))}  ${c.complete ? "complete " : ""}${c.isCashbackCoin ? "cashback " : ""}${c.isMayhemMode ? "mayhem " : ""}` +
        `${c.quoteMint.equals(PublicKey.default) ? "" : `quote ${c.quoteMint.toBase58()} `}curve ${c.dataLength} bytes, ${decimals} dec (via ${mints.get(mint.toBase58())})`,
    );
  });
}

/**
 * Pools from PumpSwap's recent devnet transactions (the first account of each
 * PumpSwap instruction, kept when it is a `Pool`), and which of them Rung can
 * buy from: canonical (pump's migration pool), paired with SOL, not cashback.
 */
async function findPools(connection: Connection, limit: number) {
  const sigs = (await connection.getSignaturesForAddress(PUMP_SWAP_PROGRAM_ID, { limit })).filter((s) => !s.err);
  const candidates = new Set<string>();
  for (const s of sigs) {
    const tx = await getTx(connection, s.signature);
    await pause(1_000); // the public devnet RPC allows about 10 getTransaction calls per 10 s
    if (!tx?.meta) continue;
    const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
    const ixs = [
      ...tx.transaction.message.compiledInstructions.map((c) => ({ program: keys.get(c.programIdIndex)!, first: c.accountKeyIndexes[0] })),
      ...(tx.meta.innerInstructions ?? []).flatMap((g) => g.instructions.map((c) => ({ program: keys.get(c.programIdIndex)!, first: c.accounts[0] }))),
    ];
    for (const ix of ixs) {
      if (ix.program.equals(PUMP_SWAP_PROGRAM_ID) && ix.first !== undefined) candidates.add(keys.get(ix.first)!.toBase58());
    }
  }
  const list = [...candidates].slice(0, 100).map((k) => new PublicKey(k));
  const infos = list.length ? await connection.getMultipleAccountsInfo(list) : [];
  const pools = list
    .map((address, i) => ({ address, info: infos[i] }))
    .filter((x) => x.info?.owner.equals(PUMP_SWAP_PROGRAM_ID) && startsWith(x.info.data, POOL_DISCRIMINATOR))
    .map((x) => ({ address: x.address, pool: decodePool(x.info!.data) }));
  console.log(`scanned ${sigs.length} recent successful PumpSwap transactions on devnet: ${pools.length} pools`);

  const usable = pools.filter(
    (p) => p.address.equals(canonicalPoolPda(p.pool.baseMint)) && p.pool.quoteMint.equals(WSOL_MINT) && !p.pool.isCashbackCoin,
  );
  for (const p of pools.filter((x) => !usable.includes(x))) {
    const why = !p.address.equals(canonicalPoolPda(p.pool.baseMint))
      ? "not canonical"
      : !p.pool.quoteMint.equals(WSOL_MINT)
        ? `quote ${p.pool.quoteMint.toBase58()}`
        : "cashback";
    console.log(`    ${p.address.toBase58()}  mint ${p.pool.baseMint.toBase58()}  skipped: ${why}`);
  }
  if (usable.length === 0) return console.log("no canonical, SOL-paired, non-cashback pool in these transactions");
  const balances = await connection.getMultipleAccountsInfo(usable.flatMap((p) => [p.pool.poolBaseTokenAccount, p.pool.poolQuoteTokenAccount]));
  console.log("canonical SOL pools (usable with --venue pool):");
  usable.forEach((p, i) => {
    const [b, q] = [balances[2 * i], balances[2 * i + 1]];
    const base = b ? tokenAccountAmount(b.data) : 0n;
    const quote = q ? tokenAccountAmount(q.data) : 0n;
    console.log(
      `  * mint ${p.pool.baseMint.toBase58()}  pool ${p.address.toBase58()}  base ${base}  quote ${quote} + virtual ${p.pool.virtualQuoteReserves}` +
        `${p.pool.isMayhemMode ? "  mayhem" : ""}  (${p.pool.dataLength} bytes)`,
    );
  });
}

const fmtFees = (f: { lpFeeBps: bigint; protocolFeeBps: bigint; creatorFeeBps: bigint }) =>
  `lp ${f.lpFeeBps} / protocol ${f.protocolFeeBps} / creator ${f.creatorFeeBps} bps`;

// --- simulate a direct pump buy ---------------------------------------------------------------

async function simulateBuy(connection: Connection, flags: Flags, mint: PublicKey) {
  const payerText = str(flags, "payer");
  if (!payerText) throw new Error("--simulate-buy needs --payer <PUBKEY> (any devnet account with SOL)");
  const payer = new PublicKey(payerText);
  const amountText = str(flags, "amount");
  if (!amountText) throw new Error("--amount <SOL> is required");
  const amount = parseSol(amountText);
  const m = await loadMarket(connection, mint, str(flags, "venue"));
  const q = quoteMarket(m, amount);
  const ata = associatedTokenAddress(payer, mint, m.tokenProgram);
  const [payerInfo, ataInfo] = await connection.getMultipleAccountsInfo([payer, ata]);
  const before = ataInfo ? tokenAccountAmount(ataInfo.data) : 0n;
  const what = m.venue === "Curve" ? "pump buy_exact_quote_in_v3" : `PumpSwap wrap + buy_exact_quote_in_v2 on pool ${m.pm.poolAccounts.address.toBase58()}`;
  console.log(`simulated ${what} by ${payer.toBase58()} (${sol(BigInt(payerInfo?.lamports ?? 0))}), ${sol(amount)} of ${mint.toBase58()} (${tokenProgramName(m.tokenProgram)})`);
  console.log(`  quote ${q.expectedTokensSeen} (fee tier ${q.feeText}; fee-free ${q.rawTokensSeen})`);

  const simulate = async (minTokensOut: bigint) => {
    const instructions = [
      computeUnitLimitIx(400_000),
      createAtaIdempotentIx({ payer, owner: payer, mint, tokenProgram: m.tokenProgram }),
      ...directBuyIxs(m, payer, amount, minTokensOut),
    ];
    const message = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: PublicKey.default.toBase58(), // replaced by the RPC
      instructions,
    }).compileToV0Message();
    const v = (
      await connection.simulateTransaction(new VersionedTransaction(message), {
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment: "confirmed",
        accounts: { encoding: "base64", addresses: [ata.toBase58()] },
      })
    ).value;
    console.log(`  min_tokens_out ${minTokensOut}: ${v.err ? JSON.stringify(v.err) : "ok"}; compute units ${v.unitsConsumed ?? "?"}`);
    const post = v.accounts?.[0];
    if (post && !v.err) {
      const got = tokenAccountAmount(base64Decode((post.data as unknown as [string, string])[0])) - before;
      console.log(`    tokens received ${got} (quote ${q.expectedTokensSeen}, difference ${got - q.expectedTokensSeen})`);
    }
    if (v.err) console.log(`    ${describeFailure(classifyFailure(v.err, v.logs ?? [], instructions.map((i) => i.programId)))}`);
    for (const line of (v.logs ?? []).filter((l) => /invoke \[1\]|failed|Error|consumed .* of/.test(l)).slice(-12)) console.log(`    | ${line}`);
    return v.err;
  };
  // With the quote as the minimum, then (if that fails) with 1 to see what the venue gives.
  if (await simulate(q.expectedTokensSeen)) await simulate(1n);
}

// --- main ----------------------------------------------------------------------------------

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const connection = new Connection(str(flags, "rpc") ?? DEFAULT_RPC, "confirmed");
  await assertDevnet(connection);

  if (flags["find-pool"]) {
    await findPools(connection, Number(int(flags, "limit", 25n)));
    return;
  }
  if (flags["find-mint"] || (!flags.mint && !flags.status && !flags.refund && !flags.cancel)) {
    await findMints(connection, Number(int(flags, "limit", 25n)));
    return;
  }
  if (flags.status || flags.refund || flags.cancel) {
    const user = loadKeypair(str(flags, "keypair") ?? DEFAULT_KEYPAIR);
    if (flags.status) await status(connection, user.publicKey);
    else await refundOrCancel(connection, user, flags.refund ? "refund" : "cancel");
    return;
  }
  const mintText = str(flags, "mint");
  if (!mintText) throw new Error("--mint <MINT> is required");
  const mint = new PublicKey(mintText);
  if (flags["push-only"]) await pushOnly(connection, flags, mint);
  else if (flags["simulate-buy"]) await simulateBuy(connection, flags, mint);
  else await run(connection, flags, mint);
}

// Exit explicitly: the RPC connection keeps a websocket open after
// confirming transactions, which would keep the process alive.
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
