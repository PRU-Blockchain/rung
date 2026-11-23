# Rung

Work in progress for the Dev3pack Global Hackathon (Solana). Nothing in this repository is usable yet.

## Status

| part | state |
|---|---|
| On-chain order program (Anchor) | written and tested locally, bonding curve only: against a test double of pump's buy instruction and against the real pump program dumped from mainnet, both inside LiteSVM. Not reviewed, not deployed, no transaction sent to mainnet yet. PumpSwap pools: not yet |
| Android app (React Native + Expo) | not yet |
| Web page (`web/`) | placeholder page only |
| Measurement scripts | not yet in this repository |

## Repository layout

| path | what |
|---|---|
| `programs/rung/` | The order program: `open_order`, `try_rung`, `refund`, `cancel` |
| `programs/rung/tests/` | Scenario and security tests (Rust, LiteSVM) |
| `test-programs/mock-pump/` | Test double that imitates the interface of pump's `buy_exact_quote_in_v3`. Not pump's code, never deployed |
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

The tests load the built program into LiteSVM and load the test double at pump's address. 117 tests: unit tests of the rung arithmetic, the ladder scenarios (a tight rung fails and a later one fills, at most one buy, timing, cap, expiry, refund, cancel), input limits, and security tests (wrong signer, substituted accounts, a fake buy program, a buy program that delivers too few tokens, pre-funded accounts, replayed and late calls). Rejections are checked by exact error code, and balances are checked to the lamport.

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

## License

MIT. See [LICENSE](LICENSE).
