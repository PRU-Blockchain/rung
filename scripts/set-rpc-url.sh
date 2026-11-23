#!/usr/bin/env bash
# Stores the mainnet RPC URL in .env.local (git-ignored) as RPC_URL.
# The URL contains an API key: it is read without echo and never printed.
#
# Usage (WSL):      bash scripts/set-rpc-url.sh
# Usage (Windows):  wsl -d Ubuntu -e bash /home/<user>/rung/scripts/set-rpc-url.sh
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${ENV_FILE:-$repo_root/.env.local}"

read -rsp "Paste the RPC URL and press Enter (input is hidden): " url
echo

# Trim surrounding whitespace and a trailing carriage return from Windows pastes.
url="$(printf '%s' "$url" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

if [[ ! "$url" =~ ^https://[^[:space:]]+$ ]]; then
  echo "Not saved: the value must be a single https:// URL (not the wss:// WebSocket URL)." >&2
  exit 1
fi

# Keep every other line of an existing file; replace only RPC_URL.
tmp="$(mktemp)"
if [[ -f "$env_file" ]]; then
  grep -v '^RPC_URL=' "$env_file" > "$tmp" || true
fi
printf 'RPC_URL=%s\n' "$url" >> "$tmp"
mv "$tmp" "$env_file"
chmod 600 "$env_file"

host="$(printf '%s' "$url" | sed -E 's#^https://([^/?]+).*#\1#')"
echo "Saved RPC_URL for host $host in $env_file"
