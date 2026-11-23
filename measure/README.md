# Measurement scripts

These scripts produce the numbers in the "Numbers → A. Our own measurement" part of the project README. They read
Solana mainnet blocks over public, keyless RPC endpoints (read-only: `getBlock`, `getTransaction`,
`getSignaturesForAddress`; nothing is signed or sent) and simulate a slippage ladder on real pump.fun buys.

> **Status:** the scripts were cleaned up from the measurement folder of 22 November 2026 (renamed, shared code
> merged, slot ranges and folder names moved to parameters, comments and table labels translated). They were
> **not re-run end to end after the cleanup; verified on a small slice** (30 slots of W1): the cleaned pipeline and the
> original scripts give the same block records, rows and report on that slice. The full results of the original run
> are in [`results/`](results/).

## What is measured

Three 3,600-slot windows (≈12.8 minutes each) were downloaded in full: W1 Sunday 22 Nov 2026 15:24 UTC, W2 Friday
20 Nov 19:00 UTC, W3 Saturday 21 Nov 08:00 UTC (slot ranges in [`windows.json`](windows.json)). Every successful
pump.fun bonding-curve and PumpSwap buy is an *anchor*: from the state right after it, a buy of the same size (or of
$100) is replayed as a ladder of up to three tries sent 4 slots apart, each landing 3 slots later (2 and 4 as
sensitivity), and filling if the price at landing is within that try's cap. Buys are grouped by situation: (a) curve
in its first 2 minutes, (b) pool in its first 5 minutes after migration, (c) established pool (traded before a
reference ~72 minutes earlier, top 10 excluded), (d) the 10 PumpSwap pools with the most SOL volume in the window.

Signers are classed by behaviour inside the window (bot-like: ≥10 pump/PumpSwap transactions, or ≥2 in one slot, or a
private program; manual-like: ≤3 transactions, one per slot, no private program; ambiguous otherwise), and buys going
through a shared router program or a popular fee account are flagged "router/terminal". The tolerance a buyer
declared is read from the buy instruction (`min_tokens_out` or `max_sol_cost`) against a quote assumed 3 slots before
the buy, and compared with the tolerance the buy actually needed. Buys that failed with a slippage error are priced
from their fees. The method, every definition and the limits are written up in Turkish in
[`docs/rapor-ikinci-olcum.md`](docs/rapor-ikinci-olcum.md) (three windows).

## Layout

| path | what |
|---|---|
| `windows.json` | W1/W2/W3: `a` first slot, `b` last slot (inclusive), `sol` SOL/USD used for "$" amounts, `dir` raw-block folder |
| `lib/config.mjs` | data folder, IDL folder, RPC endpoints, window lookup |
| `lib/rpc.mjs` | multi-endpoint, rate-limit-aware read-only RPC |
| `lib/parse.mjs` | block → compact pump/PumpSwap transaction record |
| `lib/load.mjs` | block records → per-venue trade lists |
| `idl/` | **not included**: put `pump.json` and `pump_amm.json` here (see below) |
| `data/` | everything downloaded or written (git-ignored) |
| `results/` | the 22 Nov 2026 outputs, unchanged |
| `docs/` | the two method reports, unchanged (Turkish) |

Old name → new name:

| handoff package | here |
|---|---|
| `blkfetch3.mjs` | `fetch-blocks.mjs` |
| `parse2.mjs`, `parse3.mjs` | `lib/parse.mjs` (merged) |
| `rpcm.mjs` | `lib/rpc.mjs` |
| `load3.mjs`, `load.mjs` | `lib/load.mjs` (`loadForRows`, `loadForModes`, `loadTransitionSample`) |
| `pool_age3.mjs` | `pool-age.mjs` |
| `build3.mjs` | `build-rows.mjs` |
| `report3.mjs` | `report.mjs` |
| `extra3.mjs` | `extra.mjs` |
| `tipcheck.mjs` | `tip-check.mjs` |
| `sigcheck.mjs` | `sig-check.mjs` |
| `rapor3_tablolar.md`, `rapor3.json` | `results/tables-2026-11-22.md`, `results/report-2026-11-22.json` |

## Before running

- Node 24 (no dependencies).
- **pump IDLs.** `fetch-blocks.mjs` names instructions by discriminator from `pump.json` and `pump_amm.json`
  ([pump-fun/pump-public-docs](https://github.com/pump-fun/pump-public-docs), `idl/`). Put them in `measure/idl/` or
  point `IDL_DIR` at them. The measurement used the copy of 22 Nov 2026; its SHA-256:
  `pump.json` 7616681ea557975f9f623ac211080f22a93060781eaf4765b0a488d980997207,
  `pump_amm.json` b7d8c57a4d9c4dd0109a9ab893052352333252d4eedced10ac091d4d66cab89b.
- **Load warning.** Raw data is not in the repository; the scripts download it again. A full window takes
  **20–25 minutes and thousands of requests to public RPC endpoints** (older blocks are slower: only some endpoints
  serve them). Do not re-run all windows unless you need to.

Environment variables: `MEASURE_DATA_DIR` (default `measure/data`), `IDL_DIR` (default `measure/idl`), `RPC_URLS`
(comma-separated; default: publicnode, solanavibestation, api.mainnet-beta, pocket, tatum), `WINDOWS_FILE`
(default `measure/windows.json`). Every script prints its usage with `--help`.

## Run order

```sh
cd measure
# 1. raw blocks (per window; resumable: present slots are skipped)
node fetch-blocks.mjs --window W1          # also W2, W3
# 2. pool age for situation (c)
node pool-age.mjs --window W1              # also W2, W3 (OLD=1 skips publicnode for older blocks)
# 3. buy rows per window -> data/rows_W1.json ...
node --max-old-space-size=10000 build-rows.mjs --window W1      # also W2, W3
# 4. all tables -> data/report-tables.md, data/report.json; extra cross-sections to stdout
node --max-old-space-size=8000 report.mjs --windows W1,W2,W3
node extra.mjs --windows W1,W2,W3
# 5. direct evidence (small samples)
node tip-check.mjs --rows rows_W2.json --count 30    # priority fee / Jito tip on failed transactions
node sig-check.mjs --window W2 --count 40            # account activity per signer class
```

`report.json` uses the same keys as `results/report-2026-11-22.json` (the original Turkish table labels), so a re-run
can be compared key by key; `report-tables.md` has the same tables with English labels.

## Numbers → script

Rows of README "Numbers → A". "Golden" = `results/tables-2026-11-22.md` (Turkish section names) and
`results/report-2026-11-22.json`.

| README number | script → output | in the golden results |
|---|---|---|
| Manual-like $5–500: median typed 20.0%, needed 1.10%; 67.7% typed > 5×; 4,955 buys | `report.mjs`, Part 3 "k = 3 (main), needed floor 0.5%", row "manual ∩ 5–500 $" (n, declared median, needed median, > 5×); JSON `J3["k = 3 (ana), gereken tabanı %0,5\|elle ∩ 5–500 $"]` `n`, `dmed`, `rmed`, `r5` | yes: "İş 3 · k = 3 (ana)" table, row "elle ∩ 5–500 $" |
| 26.8% of manual-like buys had no protection; 2,862 stable-price buys | `report.mjs`, Part 3 "Most frequent declared values", line "manual-like (n=2862)", bucket "100%" (declaration rounded to 100%; declarations above 100% are clipped to it) | yes: "En sık ilan değerleri", "elle-benzeri (n=2862): %100: 26.8%" (Markdown only, not in the JSON) |
| Established tokens: single 1% try fills 97.4%; 52,373 buys, 1,211 pools; manual-like $5–500: 95.1%, 5,399 | `report.mjs`, Part 2 "(c) established ≥70 min, own amount", rows "all" and "manual ∩ 5–500 $", column "single 1%"; pools: Part 1 "(c)" row "all", n (venues); JSON `J2["(c) sıradan ≥70 dk, kendi tutarıyla\|tümü"].row[3]`, `…\|elle ∩ 5–500 $"].row[3]`, `J1["c\|hepsi"].nv` | yes |
| Mode fill ranges; launch 27,403, established 52,373, most-traded 47,448, transition 6,306 buys; landing delay 2/4 | `report.mjs`, Part 1 tables per situation ("range (windows with n≥100)" rows, "all" n), combined CI table, landing-delay table; JSON `J1["<a\|b\|c\|d>\|<W>"]` | yes: "İş 1" tables |
| 14.9% of ≥20% buys filled > 5% above the seen price (average 30.5%); typical difference ≈ 0; 27,878 wide, 20,891 tight | `report.mjs`, Part 3 "Truncation check" line and the matched-comparison table (median difference); JSON `J3.trunc` (`tailShare`, `tailMean`, `nW`, `nN`) | yes: "Budama kontrolü" line |
| Buys through a trading app: 19.0% at exactly 20%, 30.1% unprotected; 9,602 stable-price buys | `report.mjs`, Part 3 stable-price distribution, row "router/terminal", column "±0.5pp @20%"; "Most frequent declared values", line "router/terminal", bucket "100%" | yes: rows "yönlendirici/terminal" (Markdown only) |
| Failed slippage try: median $0.00041; manual-like median $0.016, p90 $0.56; 135,217 failed (manual-like 362) | `report.mjs`, Part 4 "Fee of a failed (slippage) buy", rows "all" and "manual-like", column "total fee $ median / p90" | yes: "İş 4" fee table (Markdown only) |
| Priority fee is charged on a failed try, Jito tip is not; 35 transactions | `tip-check.mjs` output (`data/tip-check_<rows>.json`) | **no**: not in the golden tables; only described in `docs/rapor-ikinci-olcum.md` §5 |
| Team's own buys during event week | not produced by these scripts | – |

Table B (Bitquery, arXiv) and C (settings screens) are external sources, not produced here. `report.mjs` prints the
Bitquery bucket rates only as a fixed reference column next to its own sandwich counts.

## Limits

From the method reports (`docs/`), in short:

- Three 12.8-minute windows in one week (19–22 Nov 2026, SOL $67–70); no weekday-morning window.
- "Manual-like" is a behavioural class, not an identity; checked on 40 accounts per class (`sig-check.mjs`).
- Router/terminal names (Axiom, Photon, Bloom, …) could not be tied to programs or fee accounts; the flag is structural.
- The declared tolerance could be recovered for 30.7% of successful buys only (WSOL-based pools buy with `sell*`,
  which the parser does not record; transfer-fee / taxed tokens excluded); none for (b) and (d). It depends on the
  assumption that the quote was taken 3 slots before the buy, and "needed" is measured on successful buys only.
- The wide-vs-tight comparison carries a truncation effect; its sign depends on conditioning.
- The sandwich detector is a lower bound (same slot, same signer buy–sell only).
- Failed buys inside router/bot programs may share 6xxx error codes with other programs (upper bound); the failure
  rate depends strongly on the window (19.9–44.9%).
- The ladder simulation uses fixed timing, a constant-product price and fixed fees; the priority-fee race, bundles and
  newer PumpSwap fee tiers are not modelled.
- Two scripts of the original set are not published here: `onayar.mjs` and `onayar_tablo.mjs`, the ladder-preset
  measurement on the first window. They also printed a sandwich-cost model and dollar totals that this project does
  not use, and their input sample came from an earlier measurement whose fetch script is not part of this folder.
  The mode table in the main README comes from `report.mjs` (three windows).
- The original scripts read the pool ages of W1 from `pool_age.json` when `pool_age_w1.json` is absent, and that
  file probably came from the first measurement; `pool-age.mjs --window W1` builds `pool_age_w1.json` with the
  second-measurement rule, which may differ.
- `fetch-blocks.mjs` retries a slot until it gets an answer. A worker whose endpoint keeps failing (HTTP 5xx/429)
  retries the same slot up to 40 times with back-off before handing it back, so the last few slots can take minutes.
