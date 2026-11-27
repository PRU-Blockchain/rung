# Technical reference

Fees, wallets, the security table, addresses, the toolchain and the tests. How an order works is in the [README](../README.md#how-it-works).

## Fees

Before you approve, the app shows **"If no rung fills, max fee: X SOL"** and **"+ approval fee set by your wallet"**.

```
X = rungs × (base fee + compute-unit limit × compute-unit price ÷ 1,000,000)     (lamports; price in micro-lamports per unit)
```

With the values of the devnet runs (limit 200,000 units, price 5,000 micro-lamports, base fee 5,000 lamports) each try costs 6,000 lamports, so three rungs cost at most 18,000 lamports. The app also budgets the session key's own `refund` transaction (5,250 lamports) and the transfer that returns its unused fees (5,000 lamports), which is why the buy screen shows 0.00002825 SOL for Tight mode on a bonding curve, and 0.00002915 SOL on a PumpSwap pool, where a try costs 6,300 lamports. These compute values are temporary; they will be chosen from a measurement on mainnet, which has not been done yet. The program caps the fee budget an order can hand to the session key at 0.002 SOL.

The approval itself is a separate fee: the wallet, not Rung, sets the compute budget of the `open_order` transaction.

## Wallets

The wallet signs one transaction per buy, the order. Every try after that is signed by the one-time session key. Observed on an Android 15 emulator on devnet, Nov 23, 2026:

| wallet | sheets per buy | what the wallet added to the order | order fee |
|---|---|---|---|
| Solflare | one (after the first connect) | `SetComputeUnitLimit(200000)`, `SetComputeUnitPrice(100000)` | 25,000 lamports |
| Phantom | two: its Connect sheet, then Confirm (one since the app's identity is verified, see below) | `SetComputeUnitPrice(375000)`, `SetComputeUnitLimit(200000)` | 80,000 lamports |
| Solana Mobile mock wallet | one | nothing | 5,000 lamports |

Neither wallet added any other instruction, and the added ones did not break the order. The fee of the order transaction is set by the wallet, which is why the app shows it as a separate line; the fees of the tries are set by the app.

Phantom asked to connect again before every buy as long as it could not verify the app: it declines the saved authorization of an app whose identity it has not verified. Since Nov 24, 2026 the site the app names vouches for it: [`/.well-known/assetlinks.json`](https://rungbot.xyz/.well-known/assetlinks.json) lists the app's package and signing certificate and is served as exactly `application/json` (the wallets' verifier rejects `application/json; charset=utf-8`). A buy in Phantom is now one Confirm sheet, seen on mainnet. Since Nov 27, 2026 that file lists the certificate of the signed release, the one the published APK carries; the development build's certificate is no longer in it. On mainnet Phantom also put four instructions of its own guard program (`L2TEx…`) around the order, and the order still worked. The app asks the wallet to sign and sends the signed order itself: with the wallet sending, Phantom's transaction never reached devnet and Solflare kept the app in the background while the order's time ran out. An approval that takes longer than about a minute fails with "Approval took too long" and nothing is sent.

## What the app reads from the chain

**Token name, picture and dollar value in the app.** Next to the address, the app shows the token's name, symbol and picture. Name and symbol are read from the chain: from the mint itself for pump.fun's Token-2022 mints, from the Metaplex account for older ones. The picture's address comes from the metadata file the token's maker published; only `https` addresses are asked, and IPFS content goes through public gateways. All three are whatever the maker wrote, so the address stays on the screen. The dollar value under the amount comes from Pyth's SOL/USD price account on the chain, on mainnet only (devnet SOL has no price); a price written more than about five minutes ago is not shown. None of this is needed for a buy: when a read fails, the screen shows the address and SOL amounts as before.

## Security and limits

**unaudited, use small amounts.** The program was reviewed twice by independent read-only passes (a separate agent that could only read the code: access control, PDAs and account ownership, overflow, every way SOL can leave the vault; the second pass after the PumpSwap path was added). Those are reviews, not an audit. Neither reported a critical or high finding. Fixed after it, each with a test written first: an upper limit on the SOL a buy may take from the vault, a consistency band between the two quotes the client supplies, a rent-exemption check on the fee budget, and the highest cap lowered to 30%. Deferred on purpose: reclaiming the rent of pump's volume account, rejecting at `open_order` curves that cannot fill (non-SOL pairs, cashback coins), and pinning the remaining pump accounts in the program.

| what happens | what follows |
|---|---|
| The phone turns off, the app crashes, the session key is lost | Once the order expires, `refund` returns the SOL to you. Anyone may call it; the app calls it when it opens again. SOL and the order's rent can only go to your wallet |
| The session key is stolen | The thief can only call `try_rung` for this order, only when a rung is due and only up to your cap. Tokens still go to you; the key cannot withdraw from the vault and cannot loosen the rules. It can, however, trigger the buy at a bad price up to your cap, for example by pushing the price and then trying the top rung. It can spend at most the fee budget on the key |
| You change your mind | `cancel` with your own wallet (a second approval); the SOL comes back at once |
| The wallet changes the approval transaction | It is one transaction; the wallets we tried only added compute-budget instructions, which made the approval more expensive (see Wallets). The wallet cannot touch the fees of the tries |
| A bug in the program | The SOL in the vault is at risk. Limits: at most 0.5 SOL per order, one open order per user, tests, a small program |
| Upgrade authority | Held by the team (the wallet that deployed the program). On devnet it is a test key |
| Fee budget on the session key | What is left goes back to you when the order ends. If the phone dies first it can be lost; the program limits it to 0.002 SOL per order |
| pump's volume account | On the first buy that fills, pump opens a volume account for the vault (≈ 0.00135 SOL rent, once per user, paid from the order's rent reserve). Rung does not reclaim it yet |
| Your token account | Created from the order's rent reserve if you do not have one. It belongs to you, so its deposit stays with you |

**Limits.**

- unaudited, use small amounts.
- At most 0.5 SOL per order (`MAX_ORDER_LAMPORTS` in [`constants.rs`](../programs/rung/src/constants.rs)); at least 0.001 SOL. The highest cap any order can set is 30%. Raising the per-order limit is a team decision.
- Adverse selection: Rung does not buy when the price runs away, and the buys it misses are often the tokens that rise most.
- Tried on one Android phone (Android 16) and on the Android emulator; not tested on Seeker.
- On mainnet (counted Nov 27, 2026; the page's counter is live): twenty buys and three not-bought runs so far. Thirteen buys through the script, seven through the app.
- Buys on pump.fun bonding curves and on a token's own (canonical) PumpSwap pool paired with SOL. Other pools and cashback pools: no.

## Architecture and program addresses

| | address |
|---|---|
| Rung program (**devnet**) | [`Ej2bWTwgPULuni3RVS7Krg1cNYrm5Em5WqfMcUVJUhio`](https://explorer.solana.com/address/Ej2bWTwgPULuni3RVS7Krg1cNYrm5Em5WqfMcUVJUhio?cluster=devnet) |
| Rung program (**mainnet**) | [`Ej2bWTwgPULuni3RVS7Krg1cNYrm5Em5WqfMcUVJUhio`](https://explorer.solana.com/address/Ej2bWTwgPULuni3RVS7Krg1cNYrm5Em5WqfMcUVJUhio), deployed Nov 24, 2026 in slot 473332524 ([transaction](https://explorer.solana.com/tx/2ijAe9BY54L7mTBn6PMXa9srqSLwFYwSqG1GPkP7YSNzyZW5Mqt96Wc2hRkoZEEnUTiqJ4DeMipLLMU16SFDQiLP)). Read back from mainnet and compared: byte for byte the build with sha256 `f29024e97072e82642f5bf0fc5b197b6fb0fd2e03f4c91b473b5827d35738acc`, the same build as on devnet. Upgrade authority: the team's deploy wallet `9yWQH6bDLpwWNmD6UeQvWshfrRmufv8EHf6zWety9dCL` |
| pump.fun program it calls | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` (fixed in the program; any other buy program is rejected) |
| PumpSwap program it calls | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` (fixed in the program, same rule) |

**Instructions.** `open_order` (your wallet: writes the order, funds the vault, funds the session key), `try_rung(rung_index)` (session key only: one rung, at most one buy per order), `refund` (session key at any time, anyone after expiry: everything back to the user, order closed), `cancel` (user only: ends an open order).

**Events.** `OrderOpened`, `OrderFilled` (rung, tokens bought, SOL spent and both reference quotes, so the price paid against the price seen can be computed from the event alone), `OrderRefunded` (reason: expired, gave up or cancelled; SOL returned). The web counter is computed from these events.

**The pump.fun call.** The program buys with pump's `buy_exact_quote_in_v3`: spend a fixed amount of SOL, receive at least a minimum number of tokens. It takes 17 accounts and needs no fee-recipient account; it does not support cashback coins (pump error 6094). The comparison with the other buy instructions is in [`docs/pump-arayuz.md`](pump-arayuz.md) (Turkish notes, English quotes from pump's public docs).

| path | what |
|---|---|
| `programs/rung/` | The order program: `open_order`, `try_rung`, `refund`, `cancel` |
| `programs/rung/tests/` | Scenario and security tests (Rust, LiteSVM) |
| `test-programs/mock-pump/` | Test double that imitates the interface of pump's `buy_exact_quote_in_v3`. Not pump's code, never deployed |
| `test-programs/mock-pump-amm/` | Test double that imitates the interface of PumpSwap's `buy_exact_quote_in_v2`, with switches that make it cheat. Not PumpSwap's code, never deployed |
| `client/` | TypeScript client (web3.js v1 only): addresses, instruction builders, quote, fee budget, the sender that tries the rungs. Checked byte for byte against the Rust program |
| `app/` | Android app (React Native + Expo custom development build); see [`app/README.md`](../app/README.md) |
| `web/` | Next.js web page with the public counter, deployed on Vercel |
| `measure/` | The scripts behind the measured numbers (public RPC only, raw data not in the repository), their results of Nov 22, 2026 and the method notes |
| `scripts/` | Helper scripts: `ladder.ts` (the ladder from the command line) with `network.ts` (which network it may talk to), `fetch-pump-fixtures.mjs` and `fetch-pumpswap-fixtures.mjs` (read-only mainnet snapshots for tests), `set-rpc-url.sh` (stores the RPC URL in the git-ignored `.env.local`) |
| `docs/pump-arayuz.md` | Extract of pump's public IDL and docs that the buy call is written from (Turkish notes, English quotes) |
| `docs/shots/` | Screenshots of real devnet buys from the emulator |
| `kaynak/` | Sources of the site's pictures: the Seeker clip behind the phone (generated with Google's Gemini and Flow from the Solana Mobile press-kit photo; log in `docs/gorsel-istekleri.md`) and the script that draws the icon |
| `docs/is-listesi.md` | Work list (Turkish), kept in step with the code |

## Setup

The program is developed inside WSL2 (Ubuntu 24.04) with the repository on the WSL file system, not under `/mnt/c`. The toolchain was installed with the steps of the official installer described at https://solana.com/docs/intro/installation.

| tool | version |
|---|---|
| Rust | 1.89.0 (pinned in `rust-toolchain.toml`) |
| Solana CLI (Agave) | 3.1.10 (pinned in `Anchor.toml`) |
| Anchor CLI and `anchor-lang` | 1.1.2 (pinned in `Anchor.toml` and `Cargo.lock`) |
| Solana platform-tools | v1.52 |
| Surfpool | 1.7.0 |
| Node.js | 24.10.0 |
| Yarn | 1.22.22 |
| Next.js (`web/`) | 16.4.6 |
| Expo SDK (`app/`) | 52 (React Native 0.76.9, web3.js 1.99.0); details in [`app/README.md`](../app/README.md#stack) |

The Android side runs on Windows, not in WSL: the Android SDK, the emulator and `adb` live there. Expo and Gradle run from a second clone of this repository on the Windows file system, at a path that contains only ASCII characters; the program is built from the WSL clone. Building the app needs JDK 17; the build steps and the Windows path workarounds are in [`app/README.md`](../app/README.md).

| Android tool | version |
|---|---|
| Android Emulator | 37.2.12 |
| Emulator system image | Android 15 (API 35), Google Play, x86_64 |
| JDK | 21 (SDK tools); 17 (app build) |

Emulator, created once with `avdmanager` and started without Android Studio:

```
avdmanager create avd -n rung-play35 -k "system-images;android-35;google_apis_playstore;x86_64" -d pixel_7
emulator -avd rung-play35
```

`avdmanager` leaves `PlayStore.enabled=no` in the AVD's `config.ini`; set it to `yes` by hand. If the Windows user name contains non-ASCII characters, point `TEMP`, `ANDROID_AVD_HOME` and `ANDROID_EMULATOR_HOME` at ASCII-only folders first, otherwise the Java-based SDK tools fail with "Unable to establish loopback connection".

Environment variables (names only; no values are in the repository): `RPC_URL` (local scripts, read from the git-ignored `.env.local` written by `scripts/set-rpc-url.sh`; on Vercel a server-side variable of the web page). The app uses a public endpoint of the network it was built for (devnet, or mainnet with `EXPO_PUBLIC_CLUSTER=mainnet-beta`) and holds no keys.

## Tests

```bash
anchor test        # builds the program and the test double, then runs `cargo test`
```

The tests load the built program into LiteSVM and load two test doubles, one at pump's address and one at PumpSwap's. 226 Rust tests: unit tests of the rung arithmetic, the ladder scenarios on both venues (a tight rung fails and a later one fills, at most one buy, timing, cap, expiry, refund, cancel), input limits, the two references, events, the fixes after the two reviews, and security tests (wrong signer, substituted accounts, a pool that is not the token's own, a fake buy program, a buy program that delivers too few tokens, takes too much SOL or misuses the vault's signature, pre-funded accounts, a try that runs out of compute units, replayed and late calls). Rejections are checked by exact error code, and balances are checked to the lamport.

```bash
cd client && npm install && npm test     # 240 client tests, including byte-for-byte vectors from the Rust program
```

### Against the real pump program

```bash
node scripts/fetch-pump-fixtures.mjs     # read-only: dumps pump's program and one live curve's accounts from mainnet
cargo test -p rung --test real_pump -- --nocapture
```

The script picks a recent `buy_exact_quote_in_v3` transaction, saves the accounts it used and writes which transaction and slot it took to `programs/rung/tests/fixtures/pump/SOURCE.md`. The fixtures are git-ignored; without them these seven tests print "fixtures missing" and pass without running. With them, the real program is loaded at pump's address in LiteSVM and:

- the program's vault (a program-derived address) buys through `try_rung`, and the tokens arrive in the user's token account (a Token-2022 mint in the snapshot of Nov 23, 2026);
- a rung that is too tight fails with pump's own error 6042 `BuySlippageBelowMinTokensOut`, and the order stays open;
- a `try_rung` that buys used about 129,000 compute units, one that fails on slippage about 103,000;
- the quote formula in pump's IDL matched the tokens received exactly, with the fees read from pump's fee config in that snapshot (95 + 30 basis points).

What this does not show: behaviour on mainnet itself. LiteSVM runs with its own copies of the token programs and with every feature enabled; only a real transaction settles it.

### Against the real PumpSwap program

```bash
node scripts/fetch-pumpswap-fixtures.mjs # read-only: dumps PumpSwap's program and one live pool's accounts from mainnet
cargo test -p rung --test real_pumpswap -- --nocapture
```

Same arrangement: the fixtures go to `programs/rung/tests/fixtures/pumpswap/` (git-ignored, source written to `SOURCE.md` there), and without them these ten tests pass without running. With them, the real program is loaded at PumpSwap's address in LiteSVM and:

- the program's vault buys from the token's own pool through `try_rung` (`buy_exact_quote_in_v2`), wrapping the order's SOL for the buy and unwrapping what is left;
- a rung that is too tight fails with PumpSwap's own error 6040, and the order stays open;
- a `try_rung` that buys used 194,000 to 219,000 compute units there (154,000 to 171,000 in the devnet runs above);
- the fees charged matched the tier read from PumpSwap's fee config in the snapshot of Nov 23, 2026 (20 + 5 + 95 basis points);
- a pool marked cashback fails PumpSwap's v2 buy with its error 6079, which is why `open_order` refuses such pools.
- the snapshot's mint is a Token-2022 mint; the same buy also went through for an SPL Token mint, on a pool constructed in the test from the snapshot pool (not one read from mainnet).

The same limit applies: this is not mainnet.

### Against a local fork of mainnet

```bash
surfpool start --network mainnet --no-tui --no-deploy       # a local validator that fetches mainnet accounts as they are read
solana program deploy -u http://127.0.0.1:8899 -k <throwaway keypair> --program-id target/deploy/rung-keypair.json target/deploy/rung.so
npx tsx scripts/ladder.ts --local-fork --rpc http://127.0.0.1:8899 --keypair <throwaway keypair> --mint <MINT> --amount 0.01 --mode tight
```

`--local-fork` is accepted only when the RPC is on the same machine, so nothing can reach a real network; the wallet is a throwaway key funded by the fork's own airdrop. On Nov 24, 2026 the same client code and the same program build, run this way against mainnet's pump and PumpSwap programs and three live tokens:

- a buy from a live PumpSwap pool filled on the 1% rung (174,577 compute units for the try);
- a buy from a live bonding curve filled on the 1% rung (136,166 compute units);
- on another live curve, with the price pushed 1.5% by a second buy right after the order opened (a test aid), the 1% rung failed with pump's error 6042 and the 2% rung filled, 1.49% above the price seen;
- on the same pool, with the price pushed 4.5% right after the order opened (above the 3% cap), all three rungs failed with PumpSwap's error 6040, the order was refunded, and the fees came to 0.00003415 SOL, the "max fee" the plan had printed before the order;
- deploying the program in the fork took 1.556 SOL from the wallet, nearly all of it the rent deposit of the program's accounts at mainnet's rent rate.

What this does not show: mainnet itself. A fork has no other traders, no validators and no landing delay; the transactions exist only on the machine that ran them.

### Deploy rehearsal

```bash
bash scripts/deploy-program.test.sh      # 17 refusals that must stop before the first RPC request
bash scripts/deploy-program.sh --network local-fork --wallet <throwaway keypair> --sha256 <sha256 of target/deploy/rung.so> --check
```

[`scripts/deploy-program.sh`](../scripts/deploy-program.sh) deploys only the build whose sha256 it is given, only to the network it is told (it checks the genesis hash, and a fork on this machine is not accepted as mainnet), and only after `--confirm <program id>`. `--check` prints the deposit, the fees and the wallet's balance and sends nothing. The buffer key is a file, so an interrupted deploy resumes with the same command.

On Nov 24, 2026, against a local fork of mainnet (no real SOL):

- a first deploy was interrupted after six seconds; the deposit was then in the buffer account (1.55332684 SOL), and the same command finished the deploy from there;
- the program read back from the fork was byte for byte the build with sha256 `f29024e97072e82642f5bf0fc5b197b6fb0fd2e03f4c91b473b5827d35738acc`, which is also the build running on devnet (read back from devnet and compared the same way);
- the deploy took 1.55569 fork SOL in total: a deposit of 1.55416 SOL, which comes back only if the program is closed (a closed program address cannot be used again), and the rest in fees;
- a buy through the freshly deployed program then filled from a live PumpSwap pool on the 1% rung (185,204 compute units for the try).

**On mainnet.** With the team's approval the same script then deployed the program to mainnet on Nov 24, 2026: the build above, to the address above, verified byte for byte after the deploy. It took 1.555817994 SOL from the deploy wallet: 1.55415996 SOL of deposit and the rest in fees.

### Web page

```bash
cd web
npm install
npm run build
```

### Measurement scripts

Re-running them is described in [`measure/README.md`](../measure/README.md#run-order). A full window takes 20–25 minutes and thousands of requests to public RPC endpoints; do not re-run all windows unless you need to.

The replay has its own scripts in [`measure/replay/`](../measure/replay/); the commands are at the end of [its report](../measure/replay/results/replay-2026-11-24.md). The downloaded trades are not in the repository: a rerun from scratch makes about 20,000 read-only RPC requests.
