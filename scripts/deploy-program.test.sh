#!/usr/bin/env bash
# Tests of the refusals of scripts/deploy-program.sh that need no network:
# every case here must stop before the first RPC request. The network part is
# rehearsed against a local fork (README, "Deploy rehearsal").
#
#   bash scripts/deploy-program.test.sh
#
# Uses the built program (target/deploy/rung.so and its keypair file, whose
# address only is read) and throwaway keys made in a temporary directory.
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
script="$repo_root/scripts/deploy-program.sh"
so="$repo_root/target/deploy/rung.so"
program_keypair="$repo_root/target/deploy/rung-keypair.json"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
solana-keygen new --silent --no-bip39-passphrase -o "$tmp/wallet.json" >/dev/null
solana-keygen new --silent --no-bip39-passphrase -o "$tmp/other-program.json" >/dev/null

sha="$(sha256sum "$so" | cut -d' ' -f1)"
program_id="$(solana address -k "$program_keypair")"
# An address no RPC answers on: a case that wrongly reaches the network fails loudly instead of passing.
dead_rpc="https://rung-test.invalid/?api-key=SECRET-VALUE"

pass=0
fail=0

# expect_refusal <name> <text the refusal must contain> <arguments...>
expect_refusal() {
  local name="$1" want="$2"
  shift 2
  local out code
  out="$(ENV_FILE="$tmp/no-such-env" RPC_URL="${RPC_URL_FOR_CASE-}" bash "$script" "$@" 2>&1)"
  code=$?
  if [[ $code -ne 0 && "$out" == *"$want"* && "$out" == *"Nothing was sent."* && "$out" != *"SECRET-VALUE"* ]]; then
    pass=$((pass + 1))
    echo "ok   $name"
  else
    fail=$((fail + 1))
    echo "FAIL $name"
    echo "     exit code $code, wanted a refusal containing: $want"
    echo "$out" | sed 's/^/     | /'
  fi
}

good=(--wallet "$tmp/wallet.json" --sha256 "$sha")

RPC_URL_FOR_CASE="" expect_refusal "no --network" "--network must be mainnet, devnet or local-fork" \
  "${good[@]}" --check
RPC_URL_FOR_CASE="" expect_refusal "unknown network" "--network must be mainnet, devnet or local-fork" \
  --network testnet "${good[@]}" --check
RPC_URL_FOR_CASE="" expect_refusal "neither --check nor --deploy" "say --check or --deploy" \
  --network devnet "${good[@]}"
RPC_URL_FOR_CASE="" expect_refusal "both --check and --deploy" "say --check or --deploy" \
  --network devnet "${good[@]}" --check --deploy --confirm "$program_id"
RPC_URL_FOR_CASE="" expect_refusal "no wallet" "--wallet <keypair file> is required" \
  --network devnet --sha256 "$sha" --check
RPC_URL_FOR_CASE="" expect_refusal "wallet file missing" "wallet file not found" \
  --network devnet --wallet "$tmp/none.json" --sha256 "$sha" --check
RPC_URL_FOR_CASE="" expect_refusal "no --sha256" "--sha256 <hash of the tested build> is required" \
  --network devnet --wallet "$tmp/wallet.json" --check
RPC_URL_FOR_CASE="" expect_refusal "a different build" "is not the build that was tested" \
  --network devnet --wallet "$tmp/wallet.json" --sha256 "${sha/#?/0}x" --check
RPC_URL_FOR_CASE="" PROGRAM_KEYPAIR="$tmp/other-program.json" expect_refusal "program key of another address" "does not match declare_id" \
  --network devnet "${good[@]}" --check
RPC_URL_FOR_CASE="" expect_refusal "mainnet without an RPC" "mainnet needs RPC_URL" \
  --network mainnet "${good[@]}" --check
RPC_URL_FOR_CASE="http://127.0.0.1:8899" expect_refusal "mainnet on this machine" "is on this machine: that is a fork, not mainnet" \
  --network mainnet "${good[@]}" --check
RPC_URL_FOR_CASE="$dead_rpc" expect_refusal "local fork on another machine" "local-fork accepts only an RPC on this machine" \
  --network local-fork --rpc "$dead_rpc" "${good[@]}" --check
RPC_URL_FOR_CASE="$dead_rpc" expect_refusal "deploy without --confirm" "--deploy needs --confirm $program_id" \
  --network mainnet "${good[@]}" --deploy
RPC_URL_FOR_CASE="$dead_rpc" expect_refusal "deploy with a wrong --confirm" "--deploy needs --confirm $program_id" \
  --network mainnet "${good[@]}" --deploy --confirm "$(solana address -k "$tmp/wallet.json")"
RPC_URL_FOR_CASE="$dead_rpc" expect_refusal "the wallet as the program key" "the wallet and the program key are the same file" \
  --network mainnet --wallet "$program_keypair" --sha256 "$sha" --check
RPC_URL_FOR_CASE="$dead_rpc" expect_refusal "the wallet as the buffer key" "the buffer key must be a file of its own" \
  --network mainnet "${good[@]}" --buffer "$tmp/wallet.json" --check
# The last guard before the network: an RPC that does not answer is a refusal too, and its key stays hidden.
RPC_URL_FOR_CASE="$dead_rpc" expect_refusal "an RPC that does not answer" "could not read the genesis hash" \
  --network mainnet "${good[@]}" --check

# --- the upgrade authority is never locked or moved by a script -----------------------------------
# Locking it (a "final" deploy) or moving it is a decision the team makes by hand.
# No script or config here may hold such a command.

lock_pattern='--fin''al|set-upgrade-autho''rity|--new-upgrade-autho''rity'
lock_commands_in() { grep -rnE -- "$lock_pattern" "$@" 2>/dev/null || true; }

check() {
  local name="$1" ok="$2" detail="${3-}"
  if [[ "$ok" == "yes" ]]; then
    pass=$((pass + 1))
    echo "ok   $name"
  else
    fail=$((fail + 1))
    echo "FAIL $name"
    [[ -n "$detail" ]] && echo "$detail" | sed 's/^/     | /'
  fi
}

# The detector itself: it must see each kind of locking command.
printf 'solana program deploy x.so --fin%s\n' "al" >"$tmp/bad1.sh"
printf 'solana program set-upgrade-autho%s ID --fin%s\n' "rity" "al" >"$tmp/bad2.sh"
printf 'solana program set-upgrade-autho%s ID --new-upgrade-autho%s OTHER\n' "rity" "rity" >"$tmp/bad3.sh"
found="$(lock_commands_in "$tmp/bad1.sh" "$tmp/bad2.sh" "$tmp/bad3.sh" | cut -d: -f1 | sort -u | wc -l)"
check "the detector sees a locking command" "$([[ "$found" -eq 3 ]] && echo yes || echo no)" "saw $found of 3"

found="$(lock_commands_in "$repo_root/scripts" "$repo_root/Anchor.toml" "$repo_root/client/package.json" "$repo_root/client/src" \
  "$repo_root/web/package.json" "$repo_root/app/package.json")"
check "no script or config here can lock the upgrade authority" "$([[ -z "$found" ]] && echo yes || echo no)" "$found"

echo
echo "$pass passed, $fail failed"
[[ $fail -eq 0 ]]
