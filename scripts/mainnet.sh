#!/usr/bin/env bash
# Runs scripts/ladder.ts on mainnet: adds --mainnet and takes the RPC URL from
# RPC_URL (environment, or the git-ignored .env.local) without printing it.
# Everything else is passed through, so the rules of scripts/network.ts apply:
# --keypair has no default, an order is at most 0.01 SOL, and nothing is sent
# without --yes-real-sol.
#
#   bash scripts/mainnet.sh --keypair <FILE> --mint <MINT> --amount 0.01 --mode tight            (prints the plan)
#   bash scripts/mainnet.sh --keypair <FILE> --mint <MINT> --amount 0.01 --mode tight --yes-real-sol
#   bash scripts/mainnet.sh --keypair <FILE> --status | --refund | --cancel
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${ENV_FILE:-$repo_root/.env.local}"

if [[ -z "${RPC_URL-}" && -f "$env_file" ]]; then
  RPC_URL="$(grep '^RPC_URL=' "$env_file" | head -n 1 | cut -d= -f2- || true)"
fi
if [[ -z "${RPC_URL-}" ]]; then
  echo "Refused: mainnet needs RPC_URL (environment, or .env.local written by scripts/set-rpc-url.sh)." >&2
  echo "Nothing was sent." >&2
  exit 1
fi
export RPC_URL

if ! command -v node >/dev/null 2>&1 && [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh" >/dev/null
fi

cd "$repo_root/client"
exec node_modules/.bin/tsx ../scripts/ladder.ts --mainnet "$@"
