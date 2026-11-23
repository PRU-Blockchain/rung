# Rung

Work in progress for the Dev3pack Global Hackathon (Solana). Nothing in this repository is usable yet.

## Status

| part | state |
|---|---|
| On-chain order program (Anchor) | written and tested locally, bonding curve only: against a test double of pump's buy instruction and against the real pump program dumped from mainnet, both inside LiteSVM. Deployed on **devnet** at [`Ej2bWTwgPULuni3RVS7Krg1cNYrm5Em5WqfMcUVJUhio`](https://explorer.solana.com/address/Ej2bWTwgPULuni3RVS7Krg1cNYrm5Em5WqfMcUVJUhio?cluster=devnet). Not on mainnet. Reviewed once by an independent read-only pass, not audited. PumpSwap pools: not yet |
| Android app (React Native + Expo, `app/`) | skeleton only: opens on an Android 15 emulator, connects and disconnects through Mobile Wallet Adapter with Solana Mobile's mock wallet (one approval screen). No buy screen yet. Not tested on a real device or with Phantom or Solflare |
| Web page (`web/`) | placeholder page only |
| Measurement scripts | not yet in this repository |

## Repository layout

| path | what |
|---|---|
| `programs/rung/` | The order program: `open_order`, `try_rung`, `refund`, `cancel` |
| `programs/rung/tests/` | Scenario and security tests (Rust, LiteSVM) |
| `test-programs/mock-pump/` | Test double that imitates the interface of pump's `buy_exact_quote_in_v3`. Not pump's code, never deployed |
| `client/` | TypeScript client (web3.js v1 only): addresses, instruction builders, quote, fee budget, the sender that tries the rungs. Checked byte for byte against the Rust program |
| `web/` | Next.js web page, deployed on Vercel |
| `scripts/` | Helper scripts (`set-rpc-url.sh` stores the RPC URL in the git-ignored `.env.local`) |
| `docs/pump-arayuz.md` | Extract of pump's public IDL and docs that the buy call is written from (Turkish notes, English quotes) |
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
| Expo SDK | not chosen yet |

The Android side runs on Windows, not in WSL: the Android SDK, the emulator and `adb` live there. Expo and Gradle will run from a second clone of this repository on the Windows file system, at a path that contains only ASCII characters; the program is built from the WSL clone. This split is the plan, not a verified setup: the app does not exist yet. What is verified: the emulator boots to Android 15 with the Play Store present.

| Android tool | version |
|---|---|
| Android Emulator | 37.2.12 |
| Emulator system image | Android 15 (API 35), Google Play, x86_64 |
| JDK | 21 |

Emulator, created once with `avdmanager` and started without Android Studio:

```
avdmanager create avd -n rung-play35 -k "system-images;android-35;google_apis_playstore;x86_64" -d pixel_7
emulator -avd rung-play35
```

`avdmanager` leaves `PlayStore.enabled=no` in the AVD's `config.ini`; set it to `yes` by hand. If the Windows user name contains non-ASCII characters, point `TEMP`, `ANDROID_AVD_HOME` and `ANDROID_EMULATOR_HOME` at ASCII-only folders first, otherwise the Java-based SDK tools fail with "Unable to establish loopback connection".

## Tests

```bash
anchor test        # builds the program and the test double, then runs `cargo test`
```

The tests load the built program into LiteSVM and load the test double at pump's address. 129 tests: unit tests of the rung arithmetic, the ladder scenarios (a tight rung fails and a later one fills, at most one buy, timing, cap, expiry, refund, cancel), input limits, and security tests (wrong signer, substituted accounts, a fake buy program, a buy program that delivers too few tokens, pre-funded accounts, replayed and late calls). Rejections are checked by exact error code, and balances are checked to the lamport.

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

```bash
cd web
npm install
npm run build
```

## Devnet runs

Real transactions on devnet (test SOL, pump's devnet deployment, a live devnet curve), sent with `scripts/devnet-ladder.ts` on Nov 23, 2026. Tight mode (1% → 2% → 3%), 0.01 SOL, mint `B8fRBPHkEVfqE6FfUYsPKkyZvdjH3SxvQpYpyYRtG511`. The wallet signs one transaction (`open_order`); every try is signed by the one-time session key.

In the second and third run the price was moved on purpose by a buy from our own wallet right after the order opened. That push is a test aid of the script, not part of the product.

| run | what happened | paid vs. seen | fees |
|---|---|---|---|
| price did not move | [rung 1% filled](https://explorer.solana.com/tx/5rG3LwqhXeFhrws96mwfUV57uoJy3SypETcBcymZoMotRhiPgswsowYL6JSrajkezuxMBVRXGwhybE2xn8ghJjnm?cluster=devnet) | +0.00% | 0.000016 SOL |
| price pushed +1.5% | [rung 1% failed](https://explorer.solana.com/tx/3qyr6rUPTvSjsKZfmU2j8v4QZsecooCRWytbTpvzML6Tm67zrfSpLf9mDKtThGxsWTSgchcGmtNbBz2wQYTT6qiF?cluster=devnet) with pump's error 6042, [rung 2% filled](https://explorer.solana.com/tx/3gZ8WhEJkWruaDSDrzyA3xT7xMBHo2gro89aStjz6FqxE3Ski6fwwnWGHh1jZPcVQCALJzK14q1fofr7P6uX3ftr?cluster=devnet) four slots later | +1.49% | 0.000022 SOL |
| price pushed +4.5%, above the 3% cap | rungs [1%](https://explorer.solana.com/tx/35SeeE5X7q9J3QFkLquzBiWCZR3BbpX7ypYurbv6sJiJRZj8yRxGgHCpA9yYTNKkV9jJioQ7yYdDDF9YRc2z7wGg?cluster=devnet), [2%](https://explorer.solana.com/tx/26P3nKWRRRHNVL5A2rwtPDC6i5wMnhbZXg6BL15GMdEB5D14hLv5mtf4SWcW5Kq2xSyfBaoc2Rkbv1iaJG29o6Wy?cluster=devnet) and [3%](https://explorer.solana.com/tx/3FbWyrKHhjQJsdGeF5RthSBYTTYd8c45mwPbxpDicFiaLiX5eg6TytVweCd7HuWPq9ccymeu8hHZE9Trxg2QwH1C?cluster=devnet) all failed, then the [refund](https://explorer.solana.com/tx/2Q2XYpHszQS6P62587rnmjNdmSzJKAWcZDdv2Pgg8o1FFhWfrTFDncor7R4LkN8EoVtZnJhMKfGZ4HupZ9Vy75xQ?cluster=devnet): not bought, the order amount and the rent reserve came back in full | not bought | 0.00003325 SOL |

Measured on devnet in these runs: a `try_rung` that buys used about 123,000 compute units, one that fails on slippage about 94,000, the refund about 9,000. With a compute-unit limit of 200,000 and a price of 5,000 micro-lamports each try cost 6,000 lamports whether it bought or not.

To repeat (devnet only; the script refuses any other cluster):

```bash
cd client && npm install && cd ..
client/node_modules/.bin/tsx scripts/devnet-ladder.ts --find-mint
client/node_modules/.bin/tsx scripts/devnet-ladder.ts --mint <MINT> --amount 0.01 --mode tight --dry-run
```

## License

MIT. See [LICENSE](LICENSE).
