# Numbers: every figure with its sample and its caveat

The short version is in the [README](../README.md#measured-on-real-trades).

## A. Our own measurement (scripts in this repository)

| number | sample | caveat |
|---|---|---|
| Manual-like buys of $5–500: median typed slippage 20.0%, needed 1.10%; 67.7% typed more than 5× | 4,955 successful buys, three windows | Quote assumed 3 slots before the buy; successful buys only; WSOL-based pools excluded |
| 26.8% of manual-like buys had no protection | 2,862 buys with stable price | Only buys whose instruction could be decoded and whose price stayed stable |
| On established tokens a single 1% try fills 97.4% | 52,373 buys, 1,211 pools (manual-like $5–500: 95.1%, 5,399) | Simulation; most buys are bots |
| Mode fill ranges (mode table) | three windows; launch 27,403, established 52,373, most-traded 47,448, transition 6,306 buys | Simulation (landing delay 3 slots; 2 and 4 slots as sensitivity); priority-fee race not modelled; 4–5 transition pools per window |
| 14.9% of buys with ≥20% slippage filled more than 5% above the seen price (average 30.5%); on a typical buy the difference ≈ 0 | 27,878 wide, 20,891 tight buys | Truncation effect; result depends on conditioning |
| Buys that appear to come through a trading app: 19.0% at exactly 20%, 30.1% unprotected | 9,602 buys with stable price | App names not verified on-chain; the signal is structural |
| Failed slippage try: median $0.00041 across all; manual-like median $0.016, p90 $0.56; priority fee is charged, Jito tip is not | 135,217 failed (manual-like 362); 35 transactions as direct evidence | Manual-like group small; depends on fee settings. The priority-fee / Jito-tip evidence (35 transactions) is in the method notes, not in the result tables |
| Team's own buys on mainnet, Nov 24–27, 2026: 23 orders, 20 bought, 3 not bought, no double buy. Filled at the 0.01% rung: 1, at 1%: 13, at 2%: 3, at 5%: 1, at 10%: 2 | 23 orders (counted Nov 27, 2026) | Small sample; tokens chosen by the team; every order is the team's own test buy |

*Our own buys, not part of this table:* the [web page](https://rungbot.xyz/) counts the program's mainnet transactions: a small sample of the team's own buys, on tokens the team chose. The devnet runs, where we also pushed the price on purpose, are listed under [Devnet runs](RUNS.md#devnet-runs).

The numbers about typed and needed slippage come from our own measurement of three 13-minute windows of mainnet blocks. The scripts are in [`measure/`](../measure/README.md), with the tables they produced on Nov 22, 2026 in [`measure/results/`](../measure/results/), and the method (in Turkish) in [`measure/docs/rapor-ikinci-olcum.md`](../measure/docs/rapor-ikinci-olcum.md). [`measure/README.md`](../measure/README.md#numbers--script) maps every row above to the script and output that produced it. They use public RPC endpoints only; the raw blocks are not in the repository and are downloaded again by the scripts (about 20 to 25 minutes per window). After being cleaned up for this repository the scripts were verified on a small slice against the original ones, not re-run end to end.

## Replay on real trades: one buy with a fixed slippage against the ladder

On Nov 24, 2026 we replayed 6,454 real mainnet buys. For each one: with the same SOL at the same moment, what would a single buy with a fixed slippage have done, and what would a Rung ladder have done?

- **Hyped launch:** the first 60 seconds of the day's 11 busiest launches, every trade (4,262 buys).
- **Volatile, not the launch:** the busiest five minutes later in the life of 12 curves (1,531 buys).
- **Calm:** 40 ten-minute windows on 4 established PumpSwap pools (661 buys).

*Fill* is the share of buys that would have bought. *Room* is the most a sandwich bot could take in the block where the buy fills, added up over all buys: a ceiling, not money that was taken. Fill and room are simulated on the real trades (price seen 3 slots before the order, Rung's first try 5 slots after it); what buyers typed and the sandwiches are read from the chain.

**What buyers type today.** Launches: median 13.3%, and 59% of buys had no limit at all (233 buys decoded). Volatile windows: median 24.9%; 73% typed 20% or more and 29.5% had no limit (1,498 buys).

| | fill | room |
|---|---|---|
| **Hyped launch** | | |
| one buy at 20% | 92.9% | 323 SOL |
| one buy at 25% | 94.8% | 390 SOL |
| Rung Launch 10 → 20 → 30% | 88.4% | 140 SOL |
| one buy at 5% | 72.5% | 120 SOL |
| Rung Fast 5 → 10 → 15% | 74.7% | 87 SOL |
| **Volatile, not the launch** | | |
| one buy at 20% | 94.3% | 125 SOL |
| one buy at 25% | 95.1% | 152 SOL |
| Rung Launch 10 → 20 → 30% | 93.0% | 43.5 SOL |
| one buy at 5% | 80.3% | 37.4 SOL |
| Rung Fast 5 → 10 → 15% | 84.0% | 21.8 SOL |
| **Calm** | | |
| one buy at 3% | 100% | 21.8 SOL |
| Rung Tight 1 → 2 → 3% | 100% | 4.7 SOL |

With Launch, 71.5% of the launch buys and 84.7% of the volatile buys filled on the 10% rung; in the calm pools 99.3% filled on the 1% rung. Tight is the calm-market mode: in a launch the price outruns a 1% rung, which is why the app suggests Launch on a young token.

**Sandwiches in the same windows.** 19 found by their pattern (13 / 5 / 1), with 30 victims. The largest: a 9 SOL buy that accepted almost any price (its limit was 400%) was pushed 131% and overpaid 4.80 SOL ([front-run](https://explorer.solana.com/tx/LJBrN4DJuzmpivdNPqDuw4k4bsFw4PdzoWJxS8nhZbrJFLTFWr9roR7WNBuUuGCdH7wapkZ7eFmhcoGyAAvKfWR), [victim](https://explorer.solana.com/tx/4xq195R48RW66BNwQUqrRPjHNGwoLLvFRCLEm7b1wdwpb7NohDmvtExJ3uVKxiU6sgLADy1JQsUbDChNBAg86M6w), [back-run](https://explorer.solana.com/tx/2u2UJLBpWQsfkqbnAYK2Ys6CiU1VgtT4oBhrKut2VJzpQaZfVzNTdUJy3TJ5hmbSNLgBuWKMh7j1pC19SMMEtgbB)). Replayed with Rung Tight, that order does not buy and the SOL comes back.

Each replayed buy is alone: it does not move the market, and bots act as they did. A bot that also moves the price before the order opens, with a second trade of its own, can take more than the rung, up to the ladder's cap; the report gives both readings. Every figure with its sample size, the method, the checks against the chain and the commands to reproduce are in [the report](../measure/replay/results/replay-2026-11-24.md); the scripts are in [`measure/replay/`](../measure/replay/).

## B. Other people's measurements

| number | source | caveat |
|---|---|---|
| 6,850,144 sandwiches, 2,154,994 wallets, $29.7M gross; 96% on pump.fun curves and PumpSwap (Oct 30, 2025 – Oct 7, 2026) | Bitquery, Oct 12, 2026 | Single source; gross; address ≠ person |
| Daily sandwiches ≈ 3,400 → ≈ 51,900 | Bitquery | Not normalised by volume |
| Victims in 10,000 Jupiter swaps: 8 at 1–3% slippage, 44 at 3–10%, 148 at 20–50% | Bitquery | Jupiter swaps only; not reproduced in our sample |
| Sandwiches over three years: Solana 28.0M, Ethereum 30,607, Base 1,889 | arXiv 2609.28115 (preprint) | Not peer-reviewed; same method as Bitquery |

## C. Settings screens

The buy slippage of Axiom and Photon comes set to 20% (our reading of Nov 22, 2026; Axiom's sell tab and Photon's S2/S3 and other tabs were not read).
