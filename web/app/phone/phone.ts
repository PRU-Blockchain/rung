// The phone on the first screen: the Rung app's five screens, replaying three
// real mainnet orders from Nov 24, 2026. Every signature, number and time comes
// from the README's "Mainnet runs" and from the chain; nothing is estimated.
// The phone is drawn with plain DOM so it behaves like the app (keypad, mode
// sheet, details, history) without a framework inside the frame.
// mountPhone(root) builds it inside `root` (the `.device` element).

const EXPLORER = "https://explorer.solana.com/tx/";

type ModeId = "tight" | "normal" | "fast" | "launch" | "custom";
type Venue = "curve" | "pool";
export type ScenarioKey = "app" | "climb" | "nobuy";
type Outcome = "receipt" | "nobuy" | null;
type Step =
  | ["send", string, string]
  | ["try", number, string]
  | ["res", number, RungState, number?]
  | ["rest"]
  | ["done", Outcome];
type RungState = "waiting" | "trying" | "slipped" | "filled" | "not-needed" | "not-tried";

interface Mode {
  id: ModeId;
  label: string;
  rungs: number[] | null;
  forText: string;
}

interface Scenario {
  key: ScenarioKey;
  fromApp: boolean;
  date: string;
  name: string;
  symbol: string;
  logo: string | null;
  mint: string;
  venue: Venue;
  seen: string | null;
  per001: number | null;
  usdPerSol: number;
  mode: ModeId;
  custom: string;
  rungs: number[];
  wallet: string | null;
  outcome: Outcome;
  run: Step[];
}

const MODES: Mode[] = [
  { id: "tight", label: "Tight 1% → 2% → 3%", rungs: [1, 2, 3], forText: "established tokens" },
  { id: "normal", label: "Normal 2-3-5%", rungs: [2, 3, 5], forText: "established tokens, everyday buys" },
  { id: "fast", label: "Fast 5-10-15%", rungs: [5, 10, 15], forText: "most-traded, fast-moving pools" },
  { id: "launch", label: "Launch 10-20-30%", rungs: [10, 20, 30], forText: "a token's first two minutes" },
  { id: "custom", label: "Custom", rungs: null, forText: "you choose 1–5 rungs and the cap" },
];

// Lamports. Rents from the Nov 24 receipt; try fees from the README's "Fees"
// formula (base 5,000 + unit limit × unit price; a pool has a higher limit),
// refund 5,250, sweep 5,000.
const RENT_SHARE = 2860040;
const ORDER_DEPOSIT = 1625600;
const MIN = 1000000;
const MAX = 500000000;
const TRY_FEE: Record<Venue, number> = { curve: 6000, pool: 6300 };
const REFUND_FEE = 5250;
const SWEEP_FEE = 5000;
const VENUE_TEXT: Record<Venue, string> = { curve: "On a pump.fun bonding curve", pool: "In a PumpSwap pool" };

export const SCENARIOS: Record<ScenarioKey, Scenario> = {
  app: {
    key: "app",
    fromApp: true,
    date: "Nov 24, 2026",
    // Name and symbol from the mint account (Token-2022); the logo from the app
    // screenshot docs/shots/app-20. Dollars: SOL/USD in the minute of the order
    // (Coinbase), on the SOL amount, as in the app.
    name: "Catecoin",
    symbol: "CATE",
    logo: "/site/token-cate.png",
    mint: "Ai66...pump",
    venue: "pool",
    seen: "0.0002451",
    per001: 40.795274,
    usdPerSol: 69.38,
    mode: "tight",
    custom: "1, 2, 3",
    rungs: [1, 2, 3],
    wallet: "BRoK...yaue",
    outcome: "receipt",
    run: [
      ["send", "approval", "5X1dpRNNF5zp4DhVW7WqmmvBLFV8YYQ6z3KH1jph94bkG8751KmTWbTVt2Z1JRGfbXK9ooYXk9LiJSEddfmT7L4e"],
      ["try", 0, "2hws1mQkKJsekvwNYgvRko3KGfukHqfukW5MJ5NeooSZNcW7123ANjpquQiKHiW8d3duBYQmR85D5qox1BYgqd64"],
      ["res", 0, "filled", 0],
      ["rest"],
      ["send", "unused fees back", "2ydWR4dKPf5wyNgERXXVQQAiPaRMLAakLu8BTvpi7ra3fAwGJPjNksoZP23shVEDK6pQLQuHUCgBf842ikD8gtRi"],
      ["done", "receipt"],
    ],
  },
  climb: {
    key: "climb",
    fromApp: false,
    date: "Nov 24, 2026",
    // HKuZ…pump, Nov 24 13:12 UTC, with the script: 1% missed (pump 6042),
    // 2% bought 2.28% above the price seen.
    name: "Big Chill House Coin",
    symbol: "BCHC",
    logo: null,
    mint: "HKuZ...pump",
    venue: "curve",
    seen: null,
    per001: null,
    usdPerSol: 69.77,
    mode: "custom",
    custom: "1, 2, 3, 5, 8",
    rungs: [1, 2, 3, 5, 8],
    wallet: null,
    outcome: null,
    run: [
      ["send", "approval", "3tLqPhyJTQoGNX3Kd1gyAsbcxQmtVZD1skM7nxT6mVRyErd3mUdbeGXfPLDudZKmaX4xwyxbptYNCkaEcQ1Qejp9"],
      ["try", 0, "3PS4vLxvcVo21CEDDmyhqns4TULJt6BhfoSi9g4jHbJ4UCDDAV8d2gXfT7ys3VVfWkZLb4e9FeFdCeL5rzncTNE2"],
      ["res", 0, "slipped"],
      ["try", 1, "5teKLKm1RNyA8GpqjSfbrXfiVJvE7oCQSerfJJAtM5sieXm8qfyoWLx6TvqufLeWZSGMpGYA684ExsFDHDKqB6eU"],
      ["res", 1, "filled", 2.28],
      ["rest"],
      ["done", null],
    ],
  },
  nobuy: {
    key: "nobuy",
    fromApp: false,
    date: "Nov 24, 2026",
    // 5Z7j…pump, Nov 24 12:40 UTC, with the script; SOL/USD 70.52.
    name: "The Black sheep",
    symbol: "Sheep",
    logo: null,
    mint: "5Z7j...pump",
    venue: "curve",
    seen: null,
    per001: null,
    usdPerSol: 70.52,
    mode: "tight",
    custom: "1, 2, 3",
    rungs: [1, 2, 3],
    wallet: null,
    outcome: "nobuy",
    run: [
      ["send", "approval", "4A7ztAKgT1y32ajVq3fciAdzTXE9hokaRNTPKaiw1SUXfCChFtyo9nfqLRNwc6LGDy9zN5gV2uGP7pK2HYmCWoAD"],
      ["try", 0, "3wB8z2aNWztZGCBeKb69nVrhzbsvYacFjKujyWYYm2YgwxYakNTSR3DmqFY3NuyCWvw4B8XG9MHys5TuFEGkaUpe"],
      ["res", 0, "slipped"],
      ["try", 1, "3HE377FqavBvnJgYmTqavo9UTvLQJS1B9oM2dWwBaFHNuGA4xtMDqTfNr5hRzzR2r5JG4eubgMHzpsf8desVfdbG"],
      ["res", 1, "slipped"],
      ["try", 2, "3c8tjAv76CGZKcYRBPAX8cjWtWsoscMmYCY8WgDc6pAELBeU4tXPtxg2gogwBthRjpGAovKhp43a1Erx7hhW3cEG"],
      ["res", 2, "slipped"],
      ["send", "refund", "4wQ8yDtGHnN79RfW1RopfpvPqqQxG3gnPrG33HzjgKBg7Lzcqt2bAmpAfH1TbSPHsj4Fwi5i8Y4TGsKnaaLeFprn"],
      ["send", "unused fees back", "2QqD5MyWp9zPDa9CchNuAQZiXQdQwgdCpCbAh6gQhJvDiqQn9KJV8rnvaePdh184Q9L2k7wxF3ef135dHL5tvknM"],
      ["done", "nobuy"],
    ],
  },
};

const HISTORY = [
  {
    ok: true,
    title: "Catecoin · CATE",
    sub: "Tight · 24.11.2026",
    res: "try 1%",
    rows: [
      ["Token", "Catecoin · CATE · Ai66...pump"],
      ["Venue", "PumpSwap pool"],
      ["Mode", "Tight (1%, 2%, 3%)"],
      ["Rung", "try 1%"],
      ["Price you saw", "0.0002451 SOL per token"],
      ["Price you paid", "0.0002451 SOL per token"],
      ["Fees", "0.0000913 SOL"],
    ],
  },
  {
    ok: true,
    title: "Big Chill House Coin · BCHC",
    sub: "Custom · 24.11.2026",
    res: "try 2%",
    rows: [
      ["Token", "Big Chill House Coin · BCHC · HKuZ...pump"],
      ["Venue", "pump.fun bonding curve"],
      ["Mode", "Custom (1%, 2%, 3%, 5%, 8%)"],
      ["Rung", "try 2%"],
      ["Fees", "0.000022 SOL"],
    ],
  },
  {
    ok: false,
    title: "The Black sheep · Sheep",
    sub: "Tight · 24.11.2026",
    res: "not bought",
    rows: [
      ["Token", "The Black sheep · Sheep · 5Z7j...pump"],
      ["Venue", "pump.fun bonding curve"],
      ["Mode", "Tight (1%, 2%, 3%)"],
      ["Rung", "not bought"],
      ["Fees", "0.00003325 SOL"],
    ],
  },
];

const MARK =
  '<svg class="mark" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2v16M15 2v16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M5 10h10M5 5.5h10" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M5 14.5h10" stroke="#FFC233" stroke-width="2.6" stroke-linecap="round"/></svg>';
const NET = '<span class="net"><i></i>mainnet</span>';
const BRAND = '<div class="brand">' + MARK + "Rung</div>" + NET;
const CHEV =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

function template(): string {
  let keys = "";
  for (const k of ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0"]) {
    keys += '<button type="button" class="key" data-k="' + k + '">' + k + "</button>";
  }
  keys +=
    '<button type="button" class="key" data-k="del" aria-label="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5.5h10a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H9L3.5 12Z"/><path d="m11.5 9.5 5 5m0-5-5 5"/></svg></button>';
  return (
    '<div class="app" data-r="app">' +
    '<div class="sbar" aria-hidden="true"><span>5:50</span><svg viewBox="0 0 46 12"><path d="M6 10.5 1 4.2a8 8 0 0 1 10 0Z" fill="currentColor"/><path d="M15 11V7h2v4Zm4 0V4h2v7Zm4 0V1h2v10Z" fill="currentColor"/><rect x="30" y="1.5" width="13" height="9" rx="2" fill="none" stroke="currentColor"/><rect x="31.5" y="3" width="9" height="6" rx="1" fill="currentColor"/><rect x="43.5" y="4.5" width="1.5" height="3" rx=".5" fill="currentColor"/></svg></div>' +
    '<div class="screens">' +
    // Buy
    '<section class="screen" data-screen="buy" aria-label="Buy">' +
    '<div class="topbar">' +
    BRAND +
    '<span class="grow"></span>' +
    '<button type="button" class="wallet" data-r="wallet" aria-haspopup="true" aria-expanded="false"></button>' +
    '<button type="button" class="icon-btn" data-r="to-history" aria-label="History"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg></button>' +
    '<div class="pop" data-r="pop" hidden><span data-r="wallet-full"></span><button type="button" data-r="disconnect">Disconnect</button></div>' +
    "</div>" +
    '<div class="scroll">' +
    '<button type="button" class="token-empty" data-r="token-empty" hidden><span class="te-k">Token address</span><span class="te-ph">pump.fun token address</span><span class="te-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4.5" width="12" height="16" rx="2.5"/><path d="M9.5 4.5V3.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3v.7"/><path d="M9.5 11h5M9.5 14.5h5"/></svg></span></button>' +
    '<div class="token" data-r="token-card"><div class="avatar" data-r="tk-av" aria-hidden="true"></div>' +
    '<div class="token-main"><span class="tname" data-r="tk-name"></span><span class="addr" data-r="tk-addr"></span></div>' +
    '<button type="button" class="icon-btn" data-r="tk-clear" aria-label="Clear"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg></button>' +
    "</div>" +
    '<div class="buy-rest" data-r="buy-rest">' +
    '<div class="mode"><button type="button" class="mode-chip" data-r="mode-chip" aria-haspopup="dialog"><span class="k">Mode</span><span data-r="mode-v"></span>' +
    CHEV +
    '</button><p class="cap-line err" data-r="cap-line" hidden></p></div>' +
    '<div class="amount"><div class="amount-num" aria-live="polite"><span data-r="amt"></span><i class="caret" aria-hidden="true"></i><span class="unit">SOL</span></div><span class="usd" data-r="usd" hidden></span><p class="amount-sub" data-r="amt-sub"></p></div>' +
    '<div class="presets" role="group" aria-label="Amount (SOL)"><button type="button" class="preset" data-amt="0.01">0.01</button><button type="button" class="preset" data-amt="0.05">0.05</button><button type="button" class="preset" data-amt="0.1">0.1</button><button type="button" class="preset" data-amt="0.5">0.5</button></div>' +
    '<div class="keypad" data-r="keypad">' +
    keys +
    "</div>" +
    "</div>" +
    "</div>" +
    '<div class="footer">' +
    '<div class="fee" data-r="fee"><span class="fee-main">Max fee <b data-r="fee-val"></b></span><button type="button" class="link-btn" data-r="open-details" aria-haspopup="dialog">Details</button></div>' +
    '<button type="button" class="primary" data-r="buy-btn"><span class="p1" data-r="p1">Buy once</span></button>' +
    '<p class="connect-line" data-r="connect-line" hidden>The button connects your wallet first.</p>' +
    "</div>" +
    "</section>" +
    // Ladder
    '<section class="screen" data-screen="ladder" aria-label="Ladder" hidden>' +
    '<div class="topbar">' +
    BRAND +
    "</div>" +
    '<div class="scroll">' +
    '<div class="lad-head"><div class="lad-token"><div class="avatar sm" data-r="lad-av" aria-hidden="true"></div><div class="token-main"><span class="tname" data-r="lad-name"></span><span class="addr" data-r="lad-addr"></span><span class="sub" data-r="lad-sub"></span></div></div></div>' +
    '<div class="ladder" data-r="ladder" aria-live="polite"></div>' +
    '<p class="lad-caption">Rung climbs for you, automatically</p>' +
    '<div class="links" data-r="lad-links"></div>' +
    "</div>" +
    "</section>" +
    // Receipt (Nov 24, the CATE buy from the app)
    '<section class="screen" data-screen="receipt" aria-label="Receipt" hidden>' +
    '<div class="topbar">' +
    BRAND +
    "</div>" +
    '<div class="scroll">' +
    '<div class="done"><span class="done-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span><div class="token-main"><h2>Bought Catecoin · CATE</h2><span class="addr small">Ai66...pump</span></div></div>' +
    '<div class="big"><span class="k">Tokens bought</span><span class="v">40.795274</span></div>' +
    '<div class="gap-card"><p class="gap-title">Most buyers type: 20% · This buy needed: 1%</p>' +
    '<div class="gap-viz" aria-hidden="true"><span class="gap-track"></span><span class="gap-need"></span><span class="gap-ticks"><span style="left:0">0</span><span style="left:5%">1%</span><span style="right:0">20%</span></span></div>' +
    '<p class="gap-sub">The gap is what a sandwich bot can take from you.</p></div>' +
    // Three rows on the receipt; prices, the fee breakdown and the deposits are
    // behind "Details" (Buğra, Nov 26: less text).
    '<dl class="rows"><div><dt>Rung that filled</dt><dd>try 1%</dd></div><div><dt>SOL spent on the buy</dt><dd>0.01 SOL</dd></div><div><dt>Fees</dt><dd>0.0000913 SOL</dd></div></dl>' +
    '<button type="button" class="link-btn" data-r="rc-details" aria-expanded="false">Details</button>' +
    '<dl class="rows" data-r="rc-deposits" hidden><div><dt>Price you saw</dt><dd>0.0002451 SOL per token</dd></div><div><dt>Price you paid</dt><dd>0.0002451 SOL per token</dd></div><div><dt>Difference</dt><dd>0%</dd></div><div><dt>Fees for the tries</dt><dd>0.0000113 SOL</dd></div><div><dt>approval fee (set by your wallet)</dt><dd>0.00008 SOL</dd></div><div><dt>your token account deposit</dt><dd>0.00151384 SOL</dd></div><div><dt>PumpSwap volume account (one time)</dt><dd>0.0013462 SOL</dd></div><div><dt>order record deposit (returns when the order closes)</dt><dd>0.0016256 SOL</dd></div></dl>' +
    '<div class="links" data-r="rc-links"></div>' +
    "</div>" +
    '<div class="footer"><button type="button" class="primary" data-act="new"><span class="p1">Go to home</span></button><button type="button" class="secondary" data-act="history">History</button></div>' +
    "</section>" +
    // Not bought (Nov 24, 5Z7j…pump, Tight)
    '<section class="screen" data-screen="nobuy" aria-label="Not bought" hidden>' +
    '<div class="topbar">' +
    BRAND +
    "</div>" +
    '<div class="scroll">' +
    // The app's screen since Nov 27 (no cap line here: the app draws it from the price it reads after the last
    // try, and for this order, sent with the script, that price was not recorded).
    '<div class="nb-head">' +
    '<div class="lad-token"><div class="avatar sm" aria-hidden="true">TH</div><div class="token-main"><span class="tname">The Black sheep · Sheep</span><span class="addr small">5Z7j...pump</span><span class="sub">0.01 SOL · Tight 1% → 2% → 3%</span></div></div>' +
    '<p class="nb-title"><span class="nb-a">Price went above your cap.</span> <span class="nb-b">Not bought. Your SOL is back.</span></p></div>' +
    '<div class="mini" aria-hidden="true"><div><i></i>try 1%</div><div><i></i>try 2%</div><div><i></i>try 3%</div></div>' +
    '<dl class="rows"><div><dt>Back in your wallet</dt><dd>0.01 SOL</dd></div><div><dt>Fees</dt><dd>0.00003325 SOL</dd></div></dl>' +
    '<button type="button" class="link-btn" data-r="nb-details">Details</button>' +
    "</div>" +
    '<div class="footer"><button type="button" class="primary" data-act="retry"><span class="p1">Retry</span></button><div class="row2"><button type="button" class="secondary" data-act="new">Go to home</button><button type="button" class="secondary" data-act="history">History</button></div></div>' +
    "</section>" +
    // History
    '<section class="screen" data-screen="history" aria-label="History" hidden>' +
    '<div class="topbar"><button type="button" class="icon-btn" data-act="back" aria-label="Back"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg></button><h2 class="tb-title">History</h2></div>' +
    '<div class="scroll"><ul class="hist" data-r="hist"></ul></div>' +
    '<div class="footer"><button type="button" class="secondary" data-act="back">Back</button></div>' +
    "</section>" +
    "</div>" +
    '<div class="scrim" data-r="scrim" hidden></div>' +
    '<section class="sheet" data-r="sheet-mode" role="dialog" aria-modal="true" aria-label="Mode" hidden><div class="grab"></div><h3>Mode</h3><div data-r="mode-list" role="radiogroup" aria-label="Mode"></div>' +
    '<div class="custom-box" data-r="custom-box" hidden><p>Rungs in percent, increasing; the last one is your cap (at most 30%).</p><input data-r="custom-input" type="text" inputmode="decimal" aria-label="Custom" autocomplete="off"><p class="err" data-r="custom-err" hidden></p></div></section>' +
    '<section class="sheet" data-r="sheet-details" role="dialog" aria-modal="true" aria-label="Details" hidden><div class="grab"></div><h3>Details</h3><ul class="dlist" data-r="dlist"></ul></section>' +
    '<section class="sheet" data-r="sheet-nb" role="dialog" aria-modal="true" aria-label="Details" hidden><div class="grab"></div><h3>Details</h3><div class="links" data-r="nb-links"></div></section>' +
    '<section class="sheet" data-r="sheet-retry" role="dialog" aria-modal="true" aria-label="Retry with" hidden><div class="grab"></div><h3>Retry with</h3><p class="retry-note">Same token, same amount: 0.01 SOL. Your wallet asks once.</p><div data-r="retry-list"></div></section>' +
    '<section class="sheet" data-r="sheet-wallet" role="dialog" aria-modal="true" aria-label="Waiting for your wallet…" hidden><div class="grab"></div><div class="wait"><span class="spinner" aria-hidden="true"></span><h3>Waiting for your wallet…</h3></div></section>' +
    '<div class="gbar" aria-hidden="true"><i></i></div>' +
    "</div>"
  );
}

function fmtSol(lam: number): string {
  return (lam / 1e9).toFixed(9).replace(/0+$/, "").replace(/\.$/, "") + " SOL";
}
function fmtPct(x: number): string {
  return String(Number(Number(x).toFixed(2)));
}
// Short token count on the buy screen, as on DEXes: 40.795274 → 40.8; thousands without decimals.
function fmtTokShort(x: number): string {
  const d = x >= 1000 ? 0 : x >= 1 ? 2 : 6;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: d }).format(x);
}
function lamports(s: string): number | null {
  if (!s || s === ".") return null;
  const n = Number(s);
  return isFinite(n) ? Math.round(n * 1e9) : null;
}
function parseCustom(text: string): { rungs: number[]; error?: undefined } | { error: string; rungs?: undefined } {
  if (/\d,\d/.test(text)) return { error: "Use a dot for decimals (1.5) and a comma and space between rungs (1, 2, 3)." };
  const parts = text.split(/[,\s]+/).filter(Boolean);
  if (parts.length < 1 || parts.length > 5) return { error: "Enter 1 to 5 rungs, in percent." };
  const r: number[] = [];
  for (const part of parts) {
    if (!/^\d+(\.\d{1,2})?$/.test(part)) return { error: "Rungs are percents like 1, 2.5, 4." };
    const bps = Math.round(Number(part) * 100);
    if (bps <= 0) return { error: "Each rung must be above 0%." };
    if (r.length && bps <= r[r.length - 1]) return { error: "Each rung must be higher than the one before." };
    r.push(bps);
  }
  if (r[r.length - 1] > 3000) return { error: "The last rung is the cap: at most 30%." };
  return { rungs: r.map((b) => b / 100) };
}
function arrows(rungs: number[]): string {
  return rungs.map((x) => fmtPct(x) + "%").join(" → ");
}
// "Catecoin · CATE"; the symbol is written once when it equals the name (the app's tokenTitle rule).
function nameOf(s: Scenario): string {
  if (!s.name && !s.symbol) return "";
  if (!s.name || !s.symbol) return s.name || s.symbol;
  return s.name.toLowerCase() === s.symbol.toLowerCase() ? s.name : s.name + " · " + s.symbol;
}
// Without a picture, or when it fails to load: the first two letters of the name (the app's tokenInitials rule).
function initialsOf(s: Scenario): string {
  return Array.from((s.name || s.symbol || s.mint).replace(/\s+/g, ""))
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
function paintAvatar(el: HTMLElement, s: Scenario): void {
  el.textContent = "";
  if (s.logo) {
    const img = document.createElement("img");
    img.src = s.logo;
    img.alt = "";
    img.onerror = () => {
      el.textContent = initialsOf(s);
    };
    el.appendChild(img);
  } else {
    el.textContent = initialsOf(s);
  }
}

// Short states (Nov 26): "missed" is the word the replay notes on the page use.
const STATE_TEXT: Record<RungState, string> = {
  waiting: "waiting",
  trying: "trying…",
  slipped: "missed",
  filled: "bought",
  "not-needed": "not needed",
  "not-tried": "not tried",
};

export interface RungEvent {
  i: number;
  state: RungState;
}

type Listener<T> = (data: T) => void;
interface Events {
  scenario: ScenarioKey;
  rung: RungEvent;
  screen: string;
  done: Outcome;
}

export interface PhoneApi {
  setScenario(key: ScenarioKey): void;
  scenario(): ScenarioKey;
  on<K extends keyof Events>(ev: K, f: Listener<Events[K]>): void;
  destroy(): void;
}

export function mountPhone(root: HTMLElement, opts: { scenario?: ScenarioKey } = {}): PhoneApi {
  root.innerHTML = template();
  const app = root.querySelector<HTMLElement>(".app")!;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function q<T extends HTMLElement = HTMLElement>(k: string): T {
    const el = app.querySelector<T>('[data-r="' + k + '"]');
    if (!el) throw new Error("phone: missing " + k);
    return el;
  }
  function qa(sel: string): HTMLElement[] {
    return Array.from(app.querySelectorAll<HTMLElement>(sel));
  }
  const listeners: { [K in keyof Events]: Listener<Events[K]>[] } = { scenario: [], rung: [], screen: [], done: [] };
  function emit<K extends keyof Events>(ev: K, data: Events[K]): void {
    listeners[ev].forEach((f) => f(data));
  }

  const st = {
    scen: "app" as ScenarioKey,
    screen: "buy",
    prev: "buy",
    loaded: true,
    amt: "0.01",
    mode: "tight" as ModeId,
    custom: "1, 2, 3",
    connected: true,
    run: 0,
    invited: true,
    destroyed: false,
  };
  let lastTrigger: HTMLElement | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  function later(f: () => void, ms: number): void {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!st.destroyed) f();
    }, ms);
    timers.add(t);
  }

  function sc(): Scenario {
    return SCENARIOS[st.scen];
  }
  function modeOf(id: ModeId): Mode {
    return MODES.find((m) => m.id === id)!;
  }
  function currentRungs(): ReturnType<typeof parseCustom> {
    if (st.mode === "custom") return parseCustom(st.custom);
    return { rungs: modeOf(st.mode).rungs! };
  }
  function maxFee(n: number): number {
    return n * TRY_FEE[sc().venue] + REFUND_FEE + SWEEP_FEE;
  }
  // The logo or the first two letters of the name, "Name · SYMBOL" and under it
  // the shortened address (the word "Token" was dropped, Nov 26).
  function tokenTitle(nameEl: HTMLElement, addrEl: HTMLElement, avEl: HTMLElement): void {
    const s = sc();
    const title = nameOf(s);
    nameEl.hidden = !title;
    nameEl.textContent = title;
    addrEl.textContent = s.mint;
    addrEl.classList.toggle("small", !!title);
    paintAvatar(avEl, s);
  }

  function renderBuy(): void {
    const s = sc();
    q("token-empty").hidden = st.loaded;
    q("token-card").hidden = !st.loaded;
    q("buy-rest").inert = !st.loaded;
    tokenTitle(q("tk-name"), q("tk-addr"), q("tk-av"));

    q("mode-v").textContent = modeOf(st.mode).label;
    const r = currentRungs();
    // The cap sentence moved into "Details" (Buğra, Nov 26: less text on the
    // screen); under the chip only a custom-mode error shows.
    const cap = q("cap-line");
    cap.hidden = !r.error;
    cap.textContent = r.error ?? "";

    const amt = q("amt");
    amt.textContent = st.amt === "" ? "0" : st.amt;
    amt.classList.toggle("ph", st.amt === "");
    const lam = lamports(st.amt);
    let amtErr: string | null = null;
    if (lam === null) amtErr = "Enter an amount in SOL.";
    else if (lam < MIN || lam > MAX) amtErr = "Amount must be between 0.001 and 0.5 SOL.";
    const sub = q("amt-sub");
    sub.classList.toggle("err", !!amtErr);
    sub.textContent =
      amtErr ?? (s.per001 && lam !== null ? "≈ " + fmtTokShort((s.per001 * lam) / 1e7) + " " + (s.symbol || "tokens") : "");
    const usd = q("usd");
    usd.hidden = !!amtErr || !s.usdPerSol;
    usd.textContent = s.usdPerSol && !amtErr && lam !== null ? "≈ $" + ((lam / 1e9) * s.usdPerSol).toFixed(2) : "";
    qa(".preset").forEach((b) => b.setAttribute("aria-pressed", String(lam !== null && lamports(b.dataset.amt ?? "") === lam)));

    q("fee").hidden = !st.loaded;
    q("fee-val").textContent = r.rungs ? fmtSol(maxFee(r.rungs.length)) : "–";
    const btn = q<HTMLButtonElement>("buy-btn");
    if (!st.loaded) {
      q("p1").textContent = "Paste";
      btn.disabled = false;
    } else {
      q("p1").textContent = "Buy once";
      btn.disabled = !!(amtErr || r.error);
    }
    btn.classList.toggle("invite", st.invited && st.loaded && !btn.disabled);
    const hasWallet = st.connected && !!s.wallet;
    q("wallet").hidden = !hasWallet;
    q("wallet").textContent = s.wallet ?? "";
    q("wallet-full").textContent = "Wallet " + (s.wallet ?? "");
    q("connect-line").hidden = st.connected;
    if (!hasWallet) closePop();
  }

  function show(name: string): void {
    if (name !== "ladder") st.run++;
    closeSheets(false);
    closePop();
    if (name === "history" && st.screen !== "history") st.prev = st.screen === "ladder" ? "buy" : st.screen;
    st.screen = name;
    qa(".screen").forEach((s) => {
      s.hidden = s.dataset.screen !== name;
    });
    if (name === "buy") renderBuy();
    const scroller = app.querySelector<HTMLElement>('.screen[data-screen="' + name + '"] .scroll');
    if (scroller) scroller.scrollTop = 0;
    emit("screen", name);
  }

  function focusQuietly(el: HTMLElement): void {
    try {
      el.focus({ preventScroll: true });
    } catch {
      el.focus();
    }
  }
  function openSheet(key: string, trigger: HTMLElement | null): void {
    closeSheets(false);
    closePop();
    lastTrigger = trigger;
    q("scrim").hidden = false;
    const sh = q(key);
    sh.hidden = false;
    const h = sh.querySelector<HTMLElement>("h3");
    if (h) {
      h.setAttribute("tabindex", "-1");
      focusQuietly(h);
    }
  }
  function closeSheets(restore?: boolean): void {
    q("scrim").hidden = true;
    qa(".sheet").forEach((s) => {
      s.hidden = true;
    });
    if (restore !== false && lastTrigger) focusQuietly(lastTrigger);
    lastTrigger = null;
  }
  function closePop(): void {
    q("pop").hidden = true;
    q("wallet").setAttribute("aria-expanded", "false");
  }

  function renderModeList(): void {
    const box = q("mode-list");
    box.innerHTML = "";
    for (const m of MODES) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mode-row";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(m.id === st.mode));
      b.dataset.mode = m.id;
      b.innerHTML = '<span class="mr-label"></span><span class="mr-for"></span><i class="radio" aria-hidden="true"></i>';
      b.querySelector(".mr-label")!.textContent = m.label;
      b.querySelector(".mr-for")!.textContent = m.forText;
      box.appendChild(b);
    }
    q("custom-box").hidden = st.mode !== "custom";
    q<HTMLInputElement>("custom-input").value = st.custom;
    renderCustomErr();
  }
  function renderCustomErr(): void {
    const err = q("custom-err");
    const r = parseCustom(st.custom);
    err.classList.toggle("err", !r.rungs);
    if (!r.rungs) {
      err.textContent = r.error;
      err.hidden = false;
    } else if (r.rungs[0] >= 20) {
      err.textContent = "First rung is wide. Launch mode starts tighter, at 10%.";
      err.hidden = false;
    } else err.hidden = true;
  }

  function fillDetails(): void {
    const s = sc();
    const lam = lamports(st.amt) ?? 0;
    const r = currentRungs();
    const fee = r.rungs ? maxFee(r.rungs.length) : 0;
    const items: string[] = [];
    // Sentences moved here from the buy screen (Buğra, Nov 26: less text on the screen).
    if (r.rungs) items.push("Price jumped above your " + fmtPct(r.rungs[r.rungs.length - 1]) + "% cap? Rung doesn't buy. Your SOL comes back.");
    items.push("If no rung fills, max fee: " + fmtSol(fee) + " + approval fee set by your wallet");
    items.push("One wallet approval covers every try.");
    items.push(VENUE_TEXT[s.venue] + (s.seen ? " · Price you saw: " + s.seen + " SOL per token" : ""));
    items.push(
      "Leaves your wallet when the order opens: " + fmtSol(lam + RENT_SHARE + fee + ORDER_DEPOSIT) + " + approval fee",
      "buy: " + fmtSol(lam),
      "rent share for the accounts a buy creates: " + fmtSol(RENT_SHARE) + " (unused part comes back)",
      "fee share for the tries: " + fmtSol(fee) + " (unused part comes back)",
      "order record deposit: " + fmtSol(ORDER_DEPOSIT),
      "rungs: " + (r.rungs ? arrows(r.rungs) : "–"),
    );
    const ul = q("dlist");
    ul.innerHTML = "";
    for (const t of items) {
      const li = document.createElement("li");
      li.textContent = t;
      ul.appendChild(li);
    }
  }

  function press(k: string): void {
    let a = st.amt;
    if (k === "del") a = a.slice(0, -1);
    else if (k === ".") {
      if (a.indexOf(".") === -1) a = (a === "" ? "0" : a) + ".";
    } else {
      const dec = a.split(".")[1];
      if (dec !== undefined && dec.length >= 9) return;
      if (a.replace(".", "").length >= 10) return;
      a = a === "0" ? k : a + k;
    }
    st.amt = a;
    renderBuy();
  }

  function buildLadder(rungs: number[]): void {
    const box = q("ladder");
    box.innerHTML = "";
    box.classList.toggle("many", rungs.length > 3);
    for (let i = rungs.length - 1; i >= 0; i--) {
      const row = document.createElement("div");
      row.className = "rung";
      row.dataset.i = String(i);
      row.dataset.state = "waiting";
      row.innerHTML = '<span class="bar" aria-hidden="true"></span><div class="rung-txt"><b></b><span class="st">waiting</span></div>';
      row.querySelector("b")!.textContent = "try " + fmtPct(rungs[i]) + "%";
      box.appendChild(row);
    }
  }
  function setRung(i: number, state: RungState, above?: number): void {
    const row = q("ladder").querySelector<HTMLElement>('.rung[data-i="' + i + '"]');
    if (!row) return;
    row.dataset.state = state;
    let t = STATE_TEXT[state];
    if (state === "filled") t = !above ? "bought" : "bought · " + (above > 0 ? "+" : "−") + fmtPct(Math.abs(above)) + "%";
    row.querySelector(".st")!.textContent = t;
    emit("rung", { i, state });
  }
  function renderLinks(el: HTMLElement, list: [string, string, string?][]): void {
    el.innerHTML = "";
    for (const l of list) {
      const a = document.createElement("a");
      a.href = EXPLORER + l[1];
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.appendChild(document.createTextNode(l[0] + ": " + l[1].slice(0, 8) + "… "));
      const u = document.createElement("u");
      u.textContent = "(explorer)";
      a.appendChild(u);
      if (l[2]) a.appendChild(document.createTextNode(" · " + l[2]));
      el.appendChild(a);
    }
  }

  function play(): void {
    const s = sc();
    const my = ++st.run;
    show("ladder");
    tokenTitle(q("lad-name"), q("lad-addr"), q("lad-av"));
    q("lad-sub").textContent = "0.01 SOL · " + (s.mode === "custom" ? "Custom " + arrows(s.rungs) : modeOf(s.mode).label);
    buildLadder(s.rungs);
    const links: [string, string, string?][] = [];
    const linkEl = q("lad-links");
    renderLinks(linkEl, links);
    const D = reduced ? { send: 150, tr: 450, res: 250, done: 1000 } : { send: 600, tr: 1250, res: 600, done: 2400 };
    const steps = s.run.slice();
    function next(): void {
      if (my !== st.run) return;
      const step = steps.shift();
      if (!step) return;
      switch (step[0]) {
        case "send":
          links.push([step[1], step[2]]);
          renderLinks(linkEl, links);
          later(next, D.send);
          break;
        case "try":
          setRung(step[1], "trying");
          links.push(["try " + fmtPct(s.rungs[step[1]]) + "%", step[2]]);
          renderLinks(linkEl, links);
          later(next, D.tr);
          break;
        case "res":
          setRung(step[1], step[2], step[3]);
          later(next, D.res);
          break;
        case "rest":
          q("ladder")
            .querySelectorAll<HTMLElement>(".rung")
            .forEach((row) => {
              if (row.dataset.state === "waiting") setRung(Number(row.dataset.i), "not-needed");
            });
          later(next, D.res);
          break;
        case "done": {
          const outcome = step[1];
          emit("done", outcome);
          if (outcome)
            later(() => {
              if (my === st.run) show(outcome);
            }, D.done);
          break;
        }
      }
    }
    later(next, reduced ? 150 : 500);
  }

  function setScenario(key: ScenarioKey): void {
    const s = SCENARIOS[key];
    st.scen = key;
    st.loaded = true;
    st.amt = "0.01";
    st.mode = s.mode;
    st.custom = s.custom;
    st.connected = true;
    show("buy");
    emit("scenario", key);
  }
  function newBuy(): void {
    st.loaded = false;
    st.amt = "0.01";
    st.mode = sc().mode;
    st.custom = sc().custom;
    show("buy");
  }

  function renderHistory(): void {
    const ul = q("hist");
    ul.innerHTML = "";
    for (const h of HISTORY) {
      const li = document.createElement("li");
      li.className = "hi";
      const b = document.createElement("button");
      b.type = "button";
      b.className = "hi-row";
      b.setAttribute("aria-expanded", "false");
      b.innerHTML =
        '<span class="dot ' +
        (h.ok ? "good" : "bad") +
        '" aria-hidden="true"></span><span><span class="hi-addr"></span><span class="hi-sub"></span></span><span class="hi-res"></span>' +
        CHEV;
      b.querySelector(".hi-addr")!.textContent = h.title;
      b.querySelector(".hi-sub")!.textContent = h.sub;
      b.querySelector(".hi-res")!.textContent = h.res;
      const dl = document.createElement("dl");
      dl.className = "rows";
      dl.hidden = true;
      for (const r of h.rows) {
        const d = document.createElement("div");
        const dt = document.createElement("dt");
        dt.textContent = r[0];
        const dd = document.createElement("dd");
        dd.textContent = r[1];
        d.appendChild(dt);
        d.appendChild(dd);
        dl.appendChild(d);
      }
      b.addEventListener("click", () => {
        const open = b.getAttribute("aria-expanded") === "true";
        b.setAttribute("aria-expanded", String(!open));
        dl.hidden = open;
      });
      li.appendChild(b);
      li.appendChild(dl);
      ul.appendChild(li);
    }
  }

  function approve(): void {
    closeSheets(false);
    st.connected = true;
    play();
  }

  /* Events */
  app.addEventListener(
    "click",
    () => {
      if (st.invited) {
        st.invited = false;
        q("buy-btn").classList.remove("invite");
      }
    },
    true,
  );
  q("buy-btn").addEventListener("click", (e) => {
    if (!st.loaded) {
      st.loaded = true;
      renderBuy();
      return;
    }
    openSheet("sheet-wallet", e.currentTarget as HTMLElement);
    // The page cannot open a wallet: the recorded approval stands in for it.
    const my = st.run;
    later(
      () => {
        if (my === st.run && !q("sheet-wallet").hidden) approve();
      },
      reduced ? 400 : 1400,
    );
  });
  q("token-empty").addEventListener("click", () => q("buy-btn").click());
  q("tk-clear").addEventListener("click", () => {
    st.loaded = false;
    renderBuy();
  });
  q("mode-chip").addEventListener("click", (e) => {
    renderModeList();
    openSheet("sheet-mode", e.currentTarget as HTMLElement);
  });
  q("mode-list").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>(".mode-row");
    if (!b) return;
    st.mode = b.dataset.mode as ModeId;
    renderBuy();
    if (st.mode === "custom") {
      renderModeList();
      q("custom-input").focus();
    } else closeSheets();
  });
  q<HTMLInputElement>("custom-input").addEventListener("input", (e) => {
    st.custom = (e.target as HTMLInputElement).value;
    renderCustomErr();
    renderBuy();
  });
  q("open-details").addEventListener("click", (e) => {
    fillDetails();
    openSheet("sheet-details", e.currentTarget as HTMLElement);
  });
  q("scrim").addEventListener("click", () => closeSheets());
  qa(".preset").forEach((b) =>
    b.addEventListener("click", () => {
      st.amt = b.dataset.amt ?? "";
      renderBuy();
    }),
  );
  q("keypad").addEventListener("click", (e) => {
    const k = (e.target as HTMLElement).closest<HTMLElement>(".key");
    if (k) press(k.dataset.k ?? "");
  });
  q("to-history").addEventListener("click", () => show("history"));
  q("wallet").addEventListener("click", (e) => {
    e.stopPropagation();
    const pop = q("pop");
    pop.hidden = !pop.hidden;
    q("wallet").setAttribute("aria-expanded", String(!pop.hidden));
  });
  q("disconnect").addEventListener("click", () => {
    st.connected = false;
    renderBuy();
  });
  function onDocumentClick(e: MouseEvent): void {
    const t = e.target as Element | null;
    if (!t || !t.closest || (!t.closest('[data-r="pop"]') && !t.closest('[data-r="wallet"]'))) closePop();
  }
  document.addEventListener("click", onDocumentClick);
  q("nb-details").addEventListener("click", (e) => openSheet("sheet-nb", e.currentTarget as HTMLElement));
  q("retry-list").addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".mode-row");
    if (!row) return;
    // No recorded retry: the buy screen with the picked mode; the real app opens the wallet here.
    closeSheets(false);
    st.loaded = true;
    st.mode = row.dataset.mode as ModeId;
    show("buy");
  });
  q("rc-details").addEventListener("click", (e) => {
    const d = q("rc-deposits");
    d.hidden = !d.hidden;
    (e.currentTarget as HTMLElement).setAttribute("aria-expanded", String(!d.hidden));
  });
  qa("[data-act]").forEach((b) => {
    b.addEventListener("click", () => {
      const a = b.dataset.act;
      if (a === "new") newBuy();
      else if (a === "history") show("history");
      else if (a === "back") show(st.prev || "buy");
      else if (a === "retry") {
        // As in the app: Retry asks for a mode. The four ladders; the one just tried says so.
        const box = q("retry-list");
        box.innerHTML = "";
        for (const m of MODES) {
          if (m.id === "custom") continue;
          const row = document.createElement("button");
          row.type = "button";
          row.className = "mode-row";
          row.dataset.mode = m.id;
          row.innerHTML = '<span class="mr-label"></span><span class="mr-for"></span><span class="mr-tried"></span>';
          row.querySelector(".mr-label")!.textContent = m.label;
          row.querySelector(".mr-for")!.textContent = m.forText;
          if (m.id === SCENARIOS.nobuy.mode) row.querySelector(".mr-tried")!.textContent = "just tried";
          box.appendChild(row);
        }
        openSheet("sheet-retry", b);
      }
    });
  });
  app.addEventListener("keydown", (e) => {
    const t = e.target as Element | null;
    if (t && t.closest && t.closest("input, textarea")) {
      if (e.key === "Escape") closeSheets();
      return;
    }
    if (e.key === "Escape") {
      if (!q("scrim").hidden) {
        closeSheets();
        e.preventDefault();
      }
      closePop();
      return;
    }
    if (st.screen !== "buy" || !st.loaded || !q("scrim").hidden) return;
    if (/^[0-9]$/.test(e.key)) {
      press(e.key);
      e.preventDefault();
    } else if (e.key === "." || e.key === ",") {
      press(".");
      e.preventDefault();
    } else if (e.key === "Backspace") {
      press("del");
      e.preventDefault();
    }
  });

  const appRun = SCENARIOS.app.run;
  renderLinks(
    q("rc-links"),
    appRun.flatMap((s): [string, string][] => (s[0] === "send" ? [[s[1], s[2]]] : s[0] === "try" ? [["try 1%", s[2]]] : [])),
  );
  const nb = SCENARIOS.nobuy.run;
  const sig = (i: number): string => {
    const s = nb[i];
    return s[0] === "send" || s[0] === "try" ? s[2] : "";
  };
  renderLinks(q("nb-links"), [
    ["approval", sig(0)],
    ["try 1%", sig(1), "missed"],
    ["try 2%", sig(3), "missed"],
    ["try 3%", sig(5), "missed"],
    ["refund", sig(7)],
    ["unused fees back", sig(8)],
  ]);
  renderHistory();
  setScenario(opts.scenario ?? "app");

  return {
    setScenario,
    scenario: () => st.scen,
    on(ev, f) {
      listeners[ev].push(f);
    },
    destroy() {
      st.destroyed = true;
      st.run++;
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      document.removeEventListener("click", onDocumentClick);
      root.innerHTML = "";
    },
  };
}
