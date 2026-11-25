// Sender for Rung: open an order, try the rungs in turn, print a receipt.
// Runs on devnet unless told otherwise.
//
//   npx tsx scripts/ladder.ts --mint <MINT> --amount 0.01 --mode tight
//       [--venue auto|curve|pool] (auto: the curve while it is open, then the canonical PumpSwap pool)
//       [--rungs 100,300] [--cu-price 5000] [--cu-limit <venue default>] [--window 4] [--lifetime 150]
//       [--keypair ~/.config/solana/rung-devnet.json] [--rpc <url>] [--dry-run]
//       [--jito [--jito-tip <lamports>]]   mainnet only: each try goes to Jito's block engine as a
//         bundle of one transaction, so a try that would not fill never lands and costs nothing
//       [--push-after-open <SOL> | --push-pct <PERCENT>]   TEST AID: the wallet buys on the venue
//         right after open_order, so the price the rungs meet is higher than the one quoted
//   npx tsx scripts/ladder.ts --push-only --mint <MINT> --push-pct 4.5 [--wait-order <USER>] [--venue ...]
//       TEST AID: only the push buy, e.g. while the app runs its own order; with --wait-order
//       it fires as soon as that user's next order opens
//   npx tsx scripts/ladder.ts --find-mint [--limit 25]
//   npx tsx scripts/ladder.ts --find-pool [--limit 25]   canonical SOL pools from recent PumpSwap transactions
//   npx tsx scripts/ladder.ts --status | --refund | --cancel
//       [--mint busy [--busy-min-trades 30]]   instead of a mint: the busiest open curve among recent pump buys
//         whose price is not falling (rule in scripts/pick.ts). For test buys on a token that is moving.
//       [--no-early-try]   send the first try only after the order is confirmed (the old way). By default
//         the first try is sent together with the order and lands right behind it. Off with the push test aids.
//       [--then-sell-all]   after a buy that filled: sell it back at once (as --sell-all does; a sell the venue
//         refuses is tried again up to twice, each time with a fresh simulation and twice the allowance), wait for the
//         order's lifetime to end and close the order account. For test buys whose SOL should come back.
//   npx tsx scripts/ladder.ts --sell-all --mint <MINT> [--slippage-bps 100] [--keypair ...]
//       sells the wallet's whole balance of the token where it trades (curve or PumpSwap pool) and closes the emptied
//       token account, so the SOL of a test buy and that account's rent come back. Rung itself never sells.
//   npx tsx scripts/ladder.ts --mint <MINT> --amount 0.01 --simulate-buy --payer <PUBKEY> [--venue ...]
//   ... --local-fork --rpc http://127.0.0.1:8899 ...   TEST AID: a local fork of mainnet (e.g. `surfpool start`)
//       instead of devnet. Accepted only when the RPC host is this machine; nothing reaches a real network.
//   ... --mainnet --keypair <FILE> [--rpc <url>] ... --yes-real-sol   MAINNET: real SOL.
//       The RPC is --rpc or the environment variable RPC_URL; only its host is ever printed.
//       --keypair has no default. An order is at most 0.01 SOL. The test aids are refused.
//       Without --yes-real-sol the script prints the plan and sends nothing.
//       The rules are in scripts/network.ts and tested in client/test/network.test.ts.
//
// The keypair file is read, never printed. The session key lives only in memory.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

import {
  BondingCurve,
  Connection,
  EarlyTry,
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
  poolSellEstimate,
  pumpBuyExactQuoteInV3Ix,
  pumpFeeConfigPda,
  pumpGlobalPda,
  pumpSwapBuyExactQuoteInV2Ix,
  pumpCloseVolumeAccumulatorIx,
  pumpSellV3Ix,
  pumpSwapCloseVolumeAccumulatorIx,
  pumpSwapSellV2Ix,
  quoteOrder,
  quotePoolOrder,
  rawQuote,
  refundIx,
  rentReserve,
  resolveVenue,
  runLadder,
  sendAndConfirm,
  sendFirstTryEarly,
  startsWith,
  tokenAccountAmount,
  txFeeLamports,
  userVolumeAccumulatorPda,
  vaultPda,
  wrapSolIxs,
  wsolAta,
} from "../client/src/index";
import {
  JITO_HOSTS,
  JITO_MIN_TIP_LAMPORTS,
  type JitoOptions,
  chooseJitoTip,
  fetchJitoTipAccounts,
  fetchJitoTipFloor,
  runtimeFetch,
} from "../client/src/jito";
import { type CurveActivity, pickBusyCurve } from "./pick";
import { type Network, checkMainnetRun, chooseNetwork, explorerTx, hideRpc, mayOpenOrder, rpcHost, sellSlippageSteps } from "./network";

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
let network: Network = "devnet";
const networkName = () => network;
const explorer = (sig: string) => explorerTx(network, sig);
/** On mainnet: refuse the run unless it keeps the rules of scripts/network.ts. */
function guardMainnet(flags: Flags, amountLamports?: bigint) {
  if (network === "mainnet") checkMainnetRun({ flags, amountLamports });
}
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
  /** Set with --jito: how the tries are sent. */
  jito?: JitoOptions;
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

/** The script's own ceiling for --jito-tip: the tip is a cost to the user. */
const JITO_TIP_FLAG_MAX = 100_000n;

/**
 * --jito: one of Jito's tip accounts and the tip to pay. Both are read from
 * Jito; nothing is sent. The tip accounts are asked from the last host of the
 * list, so the first send (to the first host) is not held up by the limit of
 * one request per second per region.
 */
async function chooseJito(flags: Flags): Promise<JitoOptions | undefined> {
  if (flags.jito === undefined) return undefined;
  if (network !== "mainnet") throw new Error("--jito works on mainnet only: Jito's block engine does not serve this network");
  const fetchFn = runtimeFetch();
  const accounts = await fetchJitoTipAccounts(fetchFn, JITO_HOSTS[JITO_HOSTS.length - 1]);
  const tipAccount = accounts[Math.floor(Math.random() * accounts.length)];
  const asked = str(flags, "jito-tip");
  let tipLamports: bigint;
  if (asked !== undefined) {
    tipLamports = int(flags, "jito-tip", 0n);
    if (tipLamports < JITO_MIN_TIP_LAMPORTS || tipLamports > JITO_TIP_FLAG_MAX) {
      throw new Error(`--jito-tip must be between ${JITO_MIN_TIP_LAMPORTS} and ${JITO_TIP_FLAG_MAX} lamports`);
    }
  } else {
    const floor = await fetchJitoTipFloor(fetchFn).catch((e: Error) => {
      console.log(`(Jito's tip levels could not be read: ${e.message}; using the minimum tip)`);
      return undefined;
    });
    tipLamports = chooseJitoTip(floor);
  }
  return { tipAccount, tipLamports };
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
  const jito = await chooseJito(flags);
  const budget = feeBudget({
    rungCount: rungs.length,
    rentExemptMinimum: await rentFor(0),
    cuLimit,
    cuPrice,
    tipLamports: jito?.tipLamports,
  });
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
    jito,
  };
}

const maxFeeIfNoFill = (p: Plan) => p.budget.tries + p.budget.refund + p.budget.sweep + p.openFee;

function printPlan(p: Plan, user?: PublicKey, userBalance?: bigint, orderExists?: boolean) {
  const { market: m, quote: q } = p;
  console.log(`Plan (${networkName()})`);
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
  if (p.jito) {
    console.log(`  Jito            each try is a bundle of one transaction: a try that would not fill does not land and pays no fee`);
    console.log(`    tip           ${p.jito.tipLamports} lamports to ${p.jito.tipAccount.toBase58()}, paid only by the try that buys`);
    console.log(`    the max fee above is what the tries cost if Jito cannot be reached and they go the ordinary road`);
  }
  console.log(`  fee budget      ${sol(p.budget.total)} to the session key (includes ${sol(p.budget.rentExemptMinimum)} rent-exempt minimum${p.jito ? " and one Jito tip" : ""}); unspent comes back`);
  console.log(`  order account   ${orderExists ? "exists, reused" : `${sol(p.orderRent)} rent, returned when the order account is closed`}`);
  const leaving = p.amount + p.reserve.total + p.budget.total + (orderExists ? 0n : p.orderRent) + p.openFee;
  console.log(`  leaves wallet   ${sol(leaving)} when the order opens`);
  if (user) {
    console.log(`  wallet          ${user.toBase58()}: ${userBalance !== undefined ? sol(userBalance) : "?"}`);
    if (userBalance !== undefined && userBalance < leaving) console.log("  NOTE            the wallet holds less than this; open_order would fail");
  }
}

// --- run --------------------------------------------------------------------------

/** What `run` did, for `--then-sell-all`. Nothing when no order was opened. */
interface RunOutcome {
  filled: boolean;
  lastSlot: bigint;
}

async function run(connection: Connection, flags: Flags, mint: PublicKey): Promise<RunOutcome | undefined> {
  const keypairPath = str(flags, "keypair") ?? DEFAULT_KEYPAIR;
  const dryRun = flags["dry-run"] !== undefined;
  if (!dryRun) guardMainnet(flags);
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
  guardMainnet(flags, plan.amount);
  if (!mayOpenOrder(network, flags)) {
    console.log("MAINNET, real SOL: nothing sent. Add --yes-real-sol to open this order.");
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
  // The first try goes out together with the order, not after its confirmation: it
  // lands in the first block after the order exists. The push test aids need the old
  // order of events (order, push, then the first try), so they switch this off.
  const pushing = str(flags, "push-after-open") !== undefined || str(flags, "push-pct") !== undefined;
  const earlyWanted = flags["no-early-try"] === undefined && !pushing;
  const earlyBlockhash = earlyWanted ? await connection.getLatestBlockhash("confirmed") : undefined;
  let earlyTry: Promise<EarlyTry | undefined> = Promise.resolve(undefined);
  const opened = await sendAndConfirm(connection, [open], user, () => {
    if (!earlyBlockhash) return;
    earlyTry = sendFirstTryEarly({
      connection,
      user: u,
      mint,
      tokenProgram: m.tokenProgram,
      buybackRecipient: m.buybackRecipient,
      venue: m.venue,
      pool: m.venue === "PumpSwap" ? m.pm.poolAccounts : undefined,
      sessionKeypair: session,
      blockhash: earlyBlockhash.blockhash,
      lastValidBlockHeight: earlyBlockhash.lastValidBlockHeight,
      cuLimit: plan.cuLimit,
      cuPrice: plan.cuPrice,
      jito: plan.jito,
    }).catch(() => undefined);
  });
  const firstTry = await earlyTry;
  if (firstTry && (!opened.landed || opened.err)) firstTry.stop();
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
    firstTry,
    cuLimit: plan.cuLimit,
    cuPrice: plan.cuPrice,
    jito: plan.jito,
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
  return { filled: !!result.filled, lastSlot: order.lastSlot };
}

/**
 * `--then-sell-all`: the rest of a test round trip. Sells what the order
 * bought, then closes the order account once the order's lifetime is over,
 * so its rent comes back too. An order that did not buy was already refunded
 * and closed by the ladder.
 */
async function sellAndClose(connection: Connection, flags: Flags, mint: PublicKey, done: RunOutcome) {
  if (!done.filled) {
    console.log("\n--then-sell-all: nothing was bought, so there is nothing to sell or close.");
    return;
  }
  console.log("\n--then-sell-all: selling what the order bought.");
  let sellError: unknown;
  // A sell with a fixed allowance fails when the price moves; simulate again and widen it.
  const steps = sellSlippageSteps(int(flags, "slippage-bps", 100n));
  for (let i = 0; i < steps.length; i++) {
    try {
      await sellAll(connection, flags, mint, steps[i]);
      sellError = undefined;
      break;
    } catch (e) {
      sellError = e;
      console.log(`  the sell did not go through: ${e instanceof Error ? e.message : String(e)}`);
      if (!(e instanceof SellRefused) || i === steps.length - 1) break;
      console.log(`  trying again with a fresh simulation and ${steps[i + 1]} bps`);
    }
  }
  if (sellError) console.log("  the tokens are still in the wallet; run --sell-all again.");
  console.log(`\nwaiting for the order's lifetime to end (slot ${done.lastSlot}) to close the order account`);
  for (;;) {
    const slot = BigInt(await connection.getSlot("confirmed"));
    if (slot > done.lastSlot) break;
    await pause(Number((done.lastSlot - slot) * 400n) + 800);
  }
  const user = loadKeypair(str(flags, "keypair") ?? DEFAULT_KEYPAIR);
  await refundOrCancel(connection, user, "refund");
  const balance = BigInt(await connection.getBalance(user.publicKey, "confirmed"));
  console.log(`wallet now ${sol(balance)}`);
  if (sellError) throw new Error("the order account is closed, but the sell did not go through (see above).");
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
  guardMainnet(flags);
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
        `  price now       ${(Number(above) / 10_000).toFixed(4)}% above the price seen (price read at slot ${r.priceNow.slot}; last try landed in slot ${lastTry?.slot ?? "?"})`,
      );
    }
  } else {
    console.log("  Not bought, and the refund did not go through: run --status, then --refund after expiry or --cancel.");
  }

  console.log("  transactions");
  type Row = { what: string; signature: string; slot?: number; fee?: bigint; cu?: number; outcome: string; landed?: boolean };
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
      outcome:
        (a.failure ? `${a.outcome}: ${describeFailure(a.failure)}` : a.outcome) +
        (a.via === "jito" ? ` (Jito${a.tip ? `, tip ${a.tip}` : ""})` : "") +
        (a.outcome === "dropped" ? ": never landed, no fee" : ""),
      landed: a.outcome !== "dropped",
    })),
  );
  for (const row of rows) {
    console.log(
      `    ${row.what.padEnd(24)} slot ${String(row.slot ?? "-").padEnd(10)} fee ${String(row.fee ?? "-").padEnd(7)} CU ${String(row.cu ?? "-").padEnd(7)} ${row.outcome}`,
    );
    if (row.signature && row.landed !== false) console.log(`      ${explorer(row.signature)}`);
  }
  const totalFees = r.opened.fee + result.totalFees;
  console.log(`  total fees      ${sol(totalFees)}`);
  if (plan.jito) console.log(`  Jito tip        ${sol(result.totalTips)}`);
  console.log(`  session key     ${result.sessionBalanceAfter === 0n ? "emptied (0 lamports)" : `still holds ${result.sessionBalanceAfter} lamports`}`);

  const delta = r.balanceAfter - r.balanceBefore;
  const rents = r.rents.order + r.rents.userTokenAccount + r.rents.accumulator;
  console.log(`  wallet SOL      before ${sol(r.balanceBefore)}, after ${sol(r.balanceAfter)}, change ${sol(delta)}`);
  console.log(`    buy           ${sol(-spent)}`);
  console.log(`    fees          ${sol(-totalFees)}`);
  if (result.totalTips) console.log(`    Jito tip      ${sol(-result.totalTips)}`);
  if (r.rents.userTokenAccount) console.log(`    rent kept     ${sol(-r.rents.userTokenAccount)} your new token account`);
  if (r.rents.accumulator) {
    const owner = plan.market.venue === "Curve" ? "pump" : "PumpSwap";
    console.log(`    rent kept     ${sol(-r.rents.accumulator)} ${owner} volume account of the vault`);
  }
  if (r.rents.order) console.log(`    rent kept     ${sol(-r.rents.order)} order account (back with --refund after slot ${r.order.lastSlot})`);
  const pushCost = r.push?.walletCost ?? 0n;
  if (r.push) console.log(`    TEST AID push ${sol(-pushCost)} (direct buy on the venue, its fee and any rent it paid; not part of the order)`);
  if (r.rents.orderReturned) {
    console.log(`    rent back     ${sol(r.rents.orderReturned)} order account of an earlier order, closed by this refund`);
  }
  const rest = delta + spent + totalFees + result.totalTips + rents + pushCost - r.rents.orderReturned;
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

// --- sell what a test buy bought ---------------------------------------------------------

/**
 * `--sell-all`: one transaction from the wallet that wraps nothing, sells its
 * whole balance of the token on the PumpSwap pool, unwraps the SOL received,
 * closes the emptied token account and closes the volume account PumpSwap
 * opened for the sell. The minimum it accepts is what a
 * simulation of the same sell returned just before, less `--slippage-bps`.
 */
/** A sell that landed and was refused by the venue (the price moved below the minimum). */
class SellRefused extends Error {}

/**
 * The curve half of `--sell-all`: pump's `sell_v3` pays SOL straight to the
 * wallet, so the simulation is read from the wallet's own balance.
 */
async function sellAllOnCurve(connection: Connection, flags: Flags, user: Keypair, m: CurveMarket, slippageBps: bigint) {
  const u = user.publicKey;
  const mint = m.mint;
  const ata = associatedTokenAddress(u, mint, m.tokenProgram);
  const accumulator = userVolumeAccumulatorPda(u);
  const [ataInfo, accBefore, walletInfo] = await connection.getMultipleAccountsInfo([ata, accumulator, u], "confirmed");
  const tokens = ataInfo ? tokenAccountAmount(ataInfo.data) : 0n;
  if (tokens === 0n || !walletInfo) throw new Error("this wallet holds none of this token; nothing was sent.");

  const sell = (minLamportsOut: bigint) =>
    pumpSellV3Ix({ seller: u, mint, tokenProgram: m.tokenProgram, buybackRecipient: m.buybackRecipient, tokensIn: tokens, minLamportsOut });
  // pump opens a volume account for a seller that has none; close it again so its rent comes back.
  const closeVolume = accBefore ? [] : [pumpCloseVolumeAccumulatorIx(u)];

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const probe = new VersionedTransaction(
    new TransactionMessage({ payerKey: u, recentBlockhash: blockhash, instructions: [computeUnitLimitIx(250_000), sell(1n), ...closeVolume] }).compileToV0Message(),
  );
  const sim = (
    await connection.simulateTransaction(probe, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
      accounts: { encoding: "base64", addresses: [u.toBase58()] },
    })
  ).value;
  if (sim.err) {
    for (const line of (sim.logs ?? []).filter((l) => /failed|Error/.test(l)).slice(-6)) console.log(`    | ${line}`);
    throw new Error(`the sell does not go through in simulation (${JSON.stringify(sim.err)}); nothing was sent.`);
  }
  const post = sim.accounts?.[0];
  if (!post) throw new Error("the simulation did not return the wallet; nothing was sent.");
  // The wallet's change in the simulation; if the simulation charged the fee, this is 5,000 lamports low, which only makes the minimum safer.
  const simulated = BigInt(post.lamports) - BigInt(walletInfo.lamports);
  if (simulated <= 0n) throw new Error("the sell would pay nothing in simulation; nothing was sent.");
  const minLamportsOut = (simulated * (10_000n - slippageBps)) / 10_000n;

  const q = quoteMarket(m, MIN_ORDER_LAMPORTS);
  console.log(`Sell (${networkName()})`);
  console.log(`  mint            ${mint.toBase58()} (${tokenProgramName(m.tokenProgram)})`);
  console.log(`  venue           pump.fun bonding curve; fees ${q.feeText}`);
  console.log(`  tokens to sell  ${units(tokens, m.decimals)} (the wallet's whole balance)`);
  console.log(`  pays now        ${sol(simulated)} in simulation`);
  console.log(`  minimum         ${sol(minLamportsOut)} (${slippageBps} bps below the simulation); below that the sell fails and nothing is sold`);
  console.log(`  also back       ${sol(BigInt(ataInfo!.lamports))} rent of the token account, closed after the sell`);
  console.log(`  wallet          ${u.toBase58()}`);
  if (flags["dry-run"] !== undefined) {
    console.log("--dry-run: nothing sent.");
    return;
  }
  if (!mayOpenOrder(network, flags)) {
    console.log("MAINNET, real SOL: nothing sent. Add --yes-real-sol to sell.");
    return;
  }

  const balanceBefore = BigInt(walletInfo.lamports);
  const ixs = [
    computeUnitLimitIx(250_000),
    sell(minLamportsOut),
    closeTokenAccountIx({ account: ata, destination: u, owner: u, tokenProgram: m.tokenProgram }),
    ...closeVolume,
  ];
  const landed = await sendAndConfirm(connection, ixs, user);
  if (!landed.landed) throw new Error("the sell did not land (blockhash expired); nothing was sold");
  console.log(`\nsell ${landed.signature} slot ${landed.slot ?? "?"} fee ${landed.fee ?? "?"} CU ${landed.computeUnits ?? "?"}\n  ${explorer(landed.signature)}`);
  if (landed.err) {
    throw new SellRefused(`the sell failed and nothing was sold: ${describeFailure(classifyFailure(landed.err, landed.logs, ixs.map((i) => i.programId)))}`);
  }
  const balanceAfter = BigInt(await connection.getBalance(u, "confirmed"));
  const accAfter = await connection.getAccountInfo(accumulator, "confirmed");
  console.log(`  wallet SOL      before ${sol(balanceBefore)}, after ${sol(balanceAfter)}, change ${sol(balanceAfter - balanceBefore)}`);
  if (!accBefore && accAfter) {
    console.log(`  note            pump's volume account of this wallet is still open (${sol(BigInt(accAfter.lamports))} rent)`);
  }
}

async function sellAll(connection: Connection, flags: Flags, mint: PublicKey, slippageOverride?: bigint) {
  guardMainnet(flags);
  const slippageBps = slippageOverride ?? int(flags, "slippage-bps", 100n);
  if (slippageBps < 1n || slippageBps > 1_000n) throw new Error("--slippage-bps must be between 1 and 1000; nothing was sent.");
  const user = loadKeypair(str(flags, "keypair") ?? DEFAULT_KEYPAIR);
  const u = user.publicKey;
  const m = await loadMarket(connection, mint, str(flags, "venue"));
  if (m.venue === "Curve") return sellAllOnCurve(connection, flags, user, m, slippageBps);

  const ata = associatedTokenAddress(u, mint, m.tokenProgram);
  const wsol = wsolAta(u);
  const accumulator = ammUserVolumeAccumulatorPda(u);
  const [ataInfo, accBefore] = await connection.getMultipleAccountsInfo([ata, accumulator], "confirmed");
  const tokens = ataInfo ? tokenAccountAmount(ataInfo.data) : 0n;
  if (tokens === 0n) throw new Error("this wallet holds none of this token; nothing was sent.");

  const q = quotePoolOrder(MIN_ORDER_LAMPORTS, m.pm.reserves, m.pm.feeConfig, m.supply);
  const estimate = poolSellEstimate(tokens, m.pm.reserves, q);
  const sell = (minLamportsOut: bigint) =>
    pumpSwapSellV2Ix({
      seller: u,
      mint,
      tokenProgram: m.tokenProgram,
      pool: m.pm.poolAccounts,
      buybackWsolAccount: m.buybackRecipient,
      tokensIn: tokens,
      minLamportsOut,
    });
  const openWsol = createAtaIdempotentIx({ payer: u, owner: u, mint: WSOL_MINT, tokenProgram: TOKEN_PROGRAM_ID });
  // PumpSwap opens a volume account for a seller that has none. Close it again in the same
  // transaction so its rent comes back; one that was there before is left alone.
  const closeVolume = accBefore ? [] : [pumpSwapCloseVolumeAccumulatorIx(u)];

  // What the sell pays right now: simulate it and read the wrapped-SOL account.
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const probe = new VersionedTransaction(
    new TransactionMessage({ payerKey: u, recentBlockhash: blockhash, instructions: [computeUnitLimitIx(250_000), openWsol, sell(1n), ...closeVolume] }).compileToV0Message(),
  );
  const sim = (
    await connection.simulateTransaction(probe, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
      accounts: { encoding: "base64", addresses: [wsol.toBase58()] },
    })
  ).value;
  if (sim.err) {
    for (const line of (sim.logs ?? []).filter((l) => /failed|Error/.test(l)).slice(-6)) console.log(`    | ${line}`);
    throw new Error(`the sell does not go through in simulation (${JSON.stringify(sim.err)}); nothing was sent.`);
  }
  const post = sim.accounts?.[0];
  if (!post) throw new Error("the simulation did not return the wrapped-SOL account; nothing was sent.");
  const simulated = tokenAccountAmount(base64Decode((post.data as unknown as [string, string])[0]));
  const minLamportsOut = (simulated * (10_000n - slippageBps)) / 10_000n;

  console.log(`Sell (${networkName()})`);
  console.log(`  mint            ${mint.toBase58()} (${tokenProgramName(m.tokenProgram)})`);
  console.log(`  pool            ${m.pm.poolAccounts.address.toBase58()}; fees lp ${q.lpFeeBps} + protocol ${q.protocolFeeBps} + creator ${q.creatorFeeBps} bps`);
  console.log(`  tokens to sell  ${units(tokens, m.decimals)} (the wallet's whole balance)`);
  console.log(`  pays now        ${sol(simulated)} in simulation (estimate from the reserves ${sol(estimate)})`);
  console.log(`  minimum         ${sol(minLamportsOut)} (${slippageBps} bps below the simulation); below that the sell fails and nothing is sold`);
  console.log(`  also back       ${sol(BigInt(ataInfo!.lamports))} rent of the token account, closed after the sell`);
  console.log(`  wallet          ${u.toBase58()}`);
  if (flags["dry-run"] !== undefined) {
    console.log("--dry-run: nothing sent.");
    return;
  }
  if (!mayOpenOrder(network, flags)) {
    console.log("MAINNET, real SOL: nothing sent. Add --yes-real-sol to sell.");
    return;
  }

  const balanceBefore = BigInt(await connection.getBalance(u, "confirmed"));
  const ixs = [
    computeUnitLimitIx(250_000),
    openWsol,
    sell(minLamportsOut),
    closeTokenAccountIx({ account: wsol, destination: u, owner: u, tokenProgram: TOKEN_PROGRAM_ID }),
    closeTokenAccountIx({ account: ata, destination: u, owner: u, tokenProgram: m.tokenProgram }),
    ...closeVolume,
  ];
  const landed = await sendAndConfirm(connection, ixs, user);
  if (!landed.landed) throw new Error("the sell did not land (blockhash expired); nothing was sold");
  console.log(`\nsell ${landed.signature} slot ${landed.slot ?? "?"} fee ${landed.fee ?? "?"} CU ${landed.computeUnits ?? "?"}\n  ${explorer(landed.signature)}`);
  if (landed.err) {
    throw new SellRefused(`the sell failed and nothing was sold: ${describeFailure(classifyFailure(landed.err, landed.logs, ixs.map((i) => i.programId)))}`);
  }
  const balanceAfter = BigInt(await connection.getBalance(u, "confirmed"));
  const accAfter = await connection.getAccountInfo(accumulator, "confirmed");
  console.log(`  wallet SOL      before ${sol(balanceBefore)}, after ${sol(balanceAfter)}, change ${sol(balanceAfter - balanceBefore)}`);
  if (!accBefore && accAfter) {
    console.log(`  note            PumpSwap's volume account of this wallet is still open (${sol(BigInt(accAfter.lamports))} rent)`);
  }
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

/** Mints bought in the most recent successful pump transactions, with the instruction that bought them. */
async function recentBuys(connection: Connection, limit: number, atOnce = 1) {
  const sigs = (await connection.getSignaturesForAddress(PUMP_PROGRAM_ID, { limit })).filter((s) => !s.err);
  const counts = new Map<string, number>();
  const mints = new Map<string, string>();
  const v3Buyers = new Set<string>();
  // One at a time on the public devnet RPC (rate limit); a keyed RPC can take a few at once.
  const txs: Awaited<ReturnType<typeof getTx>>[] = [];
  for (let i = 0; i < sigs.length; i += atOnce) {
    txs.push(...(await Promise.all(sigs.slice(i, i + atOnce).map((s) => getTx(connection, s.signature).catch(() => null)))));
    // Stay under about 8 requests a second: a keyed RPC's free plan allows about 10.
    await pause(atOnce > 1 ? 600 : 250);
  }
  for (const tx of txs) {
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
  return { scanned: sigs.length, counts, mints, v3Buyers };
}

/**
 * `--mint busy`: among the mints of recent pump buys, the busiest open curve
 * whose price is not falling. Reads only; the rule is `pickBusyCurve`.
 */
async function pickBusy(connection: Connection, flags: Flags, round = 1): Promise<PublicKey> {
  const minTrades = Number(int(flags, "busy-min-trades", 30n));
  const { scanned, mints } = await recentBuys(connection, Number(int(flags, "limit", 120n)), network === "devnet" ? 1 : 3);
  const list = [...mints.keys()].slice(0, 16).map((m) => new PublicKey(m));
  const curves = list.map(bondingCurvePda);
  const read = async () =>
    (await connection.getMultipleAccountsInfo(curves, "confirmed")).map((info) => (info ? decodeBondingCurve(info.data) : undefined));
  const price = (c: BondingCurve) => (c.virtualQuoteReserves * 1_000_000_000_000n) / (c.virtualTokenReserves || 1n);
  const before = await read();
  const watchedFrom = Date.now();
  const trades: number[] = [];
  for (let i = 0; i < list.length; i++) {
    const c = before[i];
    if (!c || c.complete) {
      trades.push(0);
      continue;
    }
    const sigs = await connection.getSignaturesForAddress(curves[i], { limit: 300 });
    await pause(250);
    const now = Math.floor(Date.now() / 1000);
    trades.push(sigs.filter((s) => !s.err && s.blockTime && now - s.blockTime <= 60).length);
  }
  // Watch for at least five seconds, so the price change means something.
  const left = 5_000 - (Date.now() - watchedFrom);
  if (left > 0) await pause(left);
  const after = await read();
  const seconds = ((Date.now() - watchedFrom) / 1000).toFixed(0);
  const reasons: string[] = [];
  const activity: CurveActivity[] = list.map((mint, i) => {
    const b = before[i];
    const a = after[i];
    const why = !a
      ? "no curve"
      : a.complete
        ? "curve complete"
        : !a.quoteMint.equals(PublicKey.default)
          ? "not paired with SOL"
          : a.isCashbackCoin
            ? "cashback coin"
            : a.isMayhemMode
              ? "mayhem mode"
              : "";
    reasons.push(why);
    const priceMoveBps = a && b ? Number(((price(a) - price(b)) * 10_000n) / (price(b) || 1n)) : 0;
    return { mint: mint.toBase58(), usable: why === "", tradesLastMinute: trades[i], priceMoveBps };
  });
  console.log(`--mint busy: ${scanned} recent pump transactions scanned, ${list.length} mints watched for ${seconds} s`);
  for (const [i, c] of activity.entries()) {
    console.log(`  ${c.mint}  ${(c.usable ? "usable" : reasons[i]).padEnd(19)}  ${String(c.tradesLastMinute).padStart(3)} trades in the last minute  price ${c.priceMoveBps >= 0 ? "+" : ""}${(c.priceMoveBps / 100).toFixed(2)}% in ${seconds} s`);
  }
  let picked: CurveActivity;
  try {
    picked = pickBusyCurve(activity, minTrades);
  } catch (e) {
    // Launch tokens come and go within minutes: look again a few times before giving up.
    if (round >= 4) throw e;
    console.log(`--mint busy: none of these fits; looking again (${round + 1} of 4)`);
    await pause(3_000);
    return pickBusy(connection, flags, round + 1);
  }
  console.log(`--mint busy: picked ${picked.mint}\n`);
  // Let the RPC's rate limit recover, so no request of the order itself is slowed down.
  await pause(1_500);
  return new PublicKey(picked.mint);
}

async function findMints(connection: Connection, limit: number) {
  const { scanned, counts, mints, v3Buyers } = await recentBuys(connection, limit);
  console.log(`scanned ${scanned} recent successful pump transactions on ${networkName()}`);
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
  console.log(`scanned ${sigs.length} recent successful PumpSwap transactions on ${networkName()}: ${pools.length} pools`);

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
  if (!payerText) throw new Error("--simulate-buy needs --payer <PUBKEY> (any account with SOL)");
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

/** The RPC URL of this run, kept only to keep it out of error messages. */
let rpcInUse = "";

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const localFork = flags["local-fork"] !== undefined;
  const mainnet = flags.mainnet !== undefined;
  const rpc = str(flags, "rpc") ?? (mainnet ? process.env.RPC_URL : DEFAULT_RPC);
  if (!rpc) throw new Error("--mainnet needs --rpc <url> or RPC_URL in the environment; nothing was sent.");
  rpcInUse = rpc;
  // Checked before the first request, so a wrong pair of flags reaches no network at all.
  if (localFork) network = chooseNetwork({ genesisHash: "", rpc, localFork, mainnet });
  const connection = new Connection(rpc, "confirmed");
  if (!localFork) network = chooseNetwork({ genesisHash: await connection.getGenesisHash(), rpc, localFork, mainnet });
  if (network === "local fork") console.log("LOCAL FORK: a copy of a network running on this machine. Nothing here is a real buy.");
  if (network === "mainnet") console.log(`MAINNET through ${rpcHost(rpc)}: real SOL.`);

  if (flags["find-pool"]) {
    await findPools(connection, Number(int(flags, "limit", 25n)));
    return;
  }
  if (flags["find-mint"] || (!flags.mint && !flags.status && !flags.refund && !flags.cancel)) {
    await findMints(connection, Number(int(flags, "limit", 25n)));
    return;
  }
  if (flags.status || flags.refund || flags.cancel) {
    guardMainnet(flags);
    const user = loadKeypair(str(flags, "keypair") ?? DEFAULT_KEYPAIR);
    if (flags.status) await status(connection, user.publicKey);
    else await refundOrCancel(connection, user, flags.refund ? "refund" : "cancel");
    return;
  }
  const mintText = str(flags, "mint");
  if (!mintText) throw new Error("--mint <MINT> is required");
  const mint = mintText === "busy" ? await pickBusy(connection, flags) : new PublicKey(mintText);
  if (flags["sell-all"]) await sellAll(connection, flags, mint);
  else if (flags["push-only"]) await pushOnly(connection, flags, mint);
  else if (flags["simulate-buy"]) await simulateBuy(connection, flags, mint);
  else {
    const done = await run(connection, flags, mint);
    if (done && flags["then-sell-all"] !== undefined) await sellAndClose(connection, flags, mint, done);
  }
}

// Exit explicitly: the RPC connection keeps a websocket open after
// confirming transactions, which would keep the process alive.
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`Error: ${hideRpc(e instanceof Error ? e.message : String(e), rpcInUse)}`);
    process.exit(1);
  });
