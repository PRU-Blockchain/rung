# Rung

Work in progress for the Dev3pack Global Hackathon (Solana). Nothing in this repository is usable yet.

## Status

| part | state |
|---|---|
| On-chain order program (Anchor) | not yet. `programs/rung` is still the unmodified Anchor template; it only proves the toolchain builds and tests |
| Android app (React Native + Expo) | not yet |
| Web page (`web/`) | placeholder page only |
| Measurement scripts | not yet in this repository |

## Repository layout

| path | what |
|---|---|
| `programs/rung/` | Anchor program and its Rust tests (LiteSVM) |
| `web/` | Next.js web page, deployed on Vercel |
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

## Tests

```bash
anchor build
anchor test        # runs `cargo test`; the tests load the built program into LiteSVM
```

```bash
cd web
npm install
npm run build
```

## License

MIT. See [LICENSE](LICENSE).
