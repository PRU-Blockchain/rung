// Every text on the page, in one file, so it can be checked word for word.
// Lines marked `// verbatim` are copied from section 10 of the hand-off
// prompt (devir-promptu-rung.md); `*x*` is the prompt's own italic markup and
// is rendered as <em>. Do not edit those lines; scripts/check-verbatim.mjs
// compares each one with the prompt character by character.
// Unmarked lines are connecting text written for this page; they add no new
// number or claim.

export const COPY = {
  // --- 1. First screen (README first screen) --------------------------------
  title: "Rung — stop guessing slippage. Stop feeding sandwich bots.", // verbatim
  intro:
    "On Solana, set slippage too wide and a sandwich bot takes the gap; set it too tight and your buy fails. Rung finds the lowest slippage that fills: it tries 1% first, climbs only to your cap, and buys once. One approval.", // verbatim
  bullets: [
    "2 out of 3 manual buys set more than 5× the slippage they needed (median typed 20%, needed 1.1%).", // verbatim
    "1 in 4 manual buys had no slippage protection at all.", // verbatim
    "On established tokens, 97% of buys fill on the first 1% try.", // verbatim
  ],
  statusHeading: "Status",

  // --- 2. Terms -------------------------------------------------------------
  termsHeading: "Two terms",
  terms: [
    "*Slippage* is the most you accept paying above the price you saw; if the price moves past it, the buy fails and only the fee is spent.", // verbatim
    "A *sandwich bot* buys right before you, pushes the price up to your slippage limit, and sells right after you: it can take at most your slippage.", // verbatim
  ],

  // --- 3. Four pluses -------------------------------------------------------
  plusesHeading: "What you get",
  pluses: [
    "(1) *No guessing.* Even if you don't know what to type, you buy at the right slippage: Rung starts tightest and climbs only as needed.", // verbatim
    "(2) *Sandwich protection.* An attacker can take at most your cap, and on Rung the first try starts at 1%; even for brand-new tokens, Launch mode starts at 10%, not 20–30%.", // verbatim
    "(3) *You don't overpay.* If the price jumped above your cap, Rung doesn't buy; if it buys, you pay at most your cap above the price you saw.", // verbatim
    "(4) *One approval, one buy.* Every try is covered by one wallet approval; the program allows at most one buy; if nothing fills, your SOL comes back.", // verbatim
  ],

  // --- 4. Modes ---------------------------------------------------------------
  modesHeading: "Modes",
  modeHeader: ["mode", "rungs", "for", "fills (3 windows)"], // verbatim
  modes: [
    ["Tight", "1% → 2% → 3%", "established tokens", "98.7–99.4%"], // verbatim
    ["Normal", "2% → 3% → 5%", "established tokens, everyday buys", "99.3–99.7%"], // verbatim
    ["Fast", "5% → 10% → 15%", "most-traded, fast-moving pools", "99.2–100%"], // verbatim
    ["Launch", "10% → 20% → 30%", "a token's first two minutes", "93.6–95.2%"], // verbatim
    ["Custom", "you choose 1–5 rungs and the cap", "", ""], // verbatim
  ],
  modesNote:
    "At launch, Tight fills 80–81% of buys; the rest are buys where the price ran above 3%. Rung shows them as *not bought, your SOL is back*. If you must get in at launch, pick Launch.", // verbatim

  // --- 5. Where the numbers come from ---------------------------------------
  numbersHeading: "Where the numbers come from",
  numbers: [
    "On a typical buy the price doesn't change; Rung makes the difference during attacks and spikes.", // verbatim
    "Sandwich numbers are Bitquery's; our measurement shows the gap between the slippage typed and the slippage needed.", // verbatim
    "Measured on three 13-minute windows from the week of Nov 19–22, 2026, 232,770 buys; 'manual buy' is a behaviour rule (at most three transactions in the window, one per block, no custom program).", // verbatim
  ],
  sourcesHeading: "Sources",
  sources: [
    "https://bitquery.io/investigations/solana-sandwich-attacks", // verbatim
    "https://cryptoslate.com/solana-sandwich-bots-took-29-7-million-before-costs-bitquery-estimates/", // verbatim
    "https://www.tokenpost.com/news/technology/24728", // verbatim
    "https://developers.jup.ag/docs/swap/advanced/slippage", // verbatim
    "https://web3.okx.com/help/okx-dex-faqs", // verbatim
    "https://github.com/pump-fun/pump-public-docs", // verbatim
    "https://pump.fun/docs/fees", // verbatim
  ],

  // --- 6. How to try ----------------------------------------------------------
  tryHeading: "How to try",
  apkNotYet: "Android APK: not yet.",
  apkReady: "Android APK:",
  trySource:
    "The source code is open. The repository README describes the setup (WSL, Anchor, Android emulator), the program tests, and how to repeat the devnet runs with the script:",
  trySections: [
    { label: "Setup", anchor: "setup" },
    { label: "Tests", anchor: "tests" },
    { label: "Devnet runs", anchor: "devnet-runs" },
  ],
  shotsIntro:
    "Screenshots from the app on an Android emulator, taken during real buys on devnet:",
  shots: [
    {
      src: "/shots/app-1-buy.png",
      alt: "Rung buy screen: token, price you saw, five modes with Tight selected, amount 0.01 SOL, max fee line and the Buy once button",
      caption:
        "Before a real buy on devnet: Tight mode, 0.01 SOL, and the most the tries can cost in fees, shown before the wallet approval.",
    },
    {
      src: "/shots/app-7-climb.png",
      alt: "Rung ladder: try 1% price was above this rung, try 2% bought 1.48% above the price you saw, try 3% not needed",
      caption:
        "A real buy on devnet: the 1% rung missed, the 2% rung bought. The price was moved on purpose by a buy from our own wallet right after the order opened; that push is a test aid, not part of the product.",
    },
    {
      src: "/shots/app-5-not-bought.png",
      alt: "Rung not-bought screen: Price went above your cap. Not bought. Your SOL is back. Fees and explorer links, Retry with Launch mode button",
      caption:
        "A real order on devnet that did not buy: the price was pushed on purpose above the 3% cap by a buy from our own wallet, all three rungs failed, and the SOL came back.",
    },
  ],

  // --- 7. Counter -------------------------------------------------------------
  counterHeading: "Counter",
  counterLoading: "Reading the program's transactions…",
  counterNote:
    "Computed from the program's on-chain events. These are the team's own test buys: small sample; tokens chosen by the team. They include test runs where we moved the price on purpose.",
  counterUnavailable: "counter unavailable right now",
  lastRead: "Last successful read:",
  neverRead: "no successful read yet on this server",
  readLine: (at: string, cap: number, read: number, withRung: number, failed: number) =>
    `Read at ${at}. Transactions read (newest first, at most ${cap}): ${read}; with a Rung instruction: ${withRung}, of which failed: ${failed}.`,
  skippedLine: (n: number) => `Not readable yet: ${n}.`,
  orphanLine: (n: number) => `Events of orders opened before the oldest transaction read, not counted: ${n}.`,
  labels: {
    opened: "orders opened",
    filled: "bought",
    notBought: "not bought (SOL refunded: expired or gave up)",
    cancelled: "cancelled by the user",
    open: "no outcome yet in this window",
    avgRung: "average rung used, bought orders",
    doubleBuys: "double buys",
    feesTotal: "fees paid by the program's transactions",
    feesOpen: "of which order approvals (open_order)",
    feesTries: "of which tries (try_rung)",
    feesOther: "of which refunds and cancels",
  },
  doubleBuyDefinition:
    "A double buy is an order with more than one OrderFilled event between its OrderOpened and the user's next OrderOpened. Counted from the events, not assumed.",
  rungDistHeading: "Which rung bought",
  rungDistHeader: ["rung", "slippage", "buys"],
  failedTriesLine: (slippage: number, orderFilled: number, other: number) =>
    `Failed tries: ${slippage} on slippage (pump error 6042), ${orderFilled} refused because the order had already bought (Rung error 6012), ${other} other.`,

  // --- 8. Recent buys -------------------------------------------------------
  recentHeading: "Recent buys",
  recentEmpty: "No bought or not-bought orders in the transactions read.",
  recentHeader: ["time (UTC)", "result", "transaction"],
  notBought: "not bought",
  boughtOn: (rung: number, slippage: string) => `bought on rung ${rung} (${slippage})`,
  explorer: "explorer",

  // --- 9. Footer ------------------------------------------------------------
  footerOpenSource: "Open source",
  footerLicense: "License:",
  footerRepo: "Repository",
  footerProgram: "Program",
} as const;
