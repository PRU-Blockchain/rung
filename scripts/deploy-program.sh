#!/usr/bin/env bash
# Deploys the built Rung program (target/deploy/rung.so), or only checks what a
# deploy would need. On mainnet this spends real SOL: it is run by hand, after
# the amount printed by --check has been agreed.
#
#   bash scripts/deploy-program.sh --network mainnet|devnet|local-fork \
#        --wallet <keypair file> --sha256 <hash of the tested build> --check
#   bash scripts/deploy-program.sh ... --deploy --confirm <PROGRAM ID>
#        [--buffer <keypair file>] [--cu-price <micro-lamports>] [--tpu] [--rpc <url>]
#
# What it refuses, before anything is sent (scripts/deploy-program.test.sh):
#   - a build whose sha256 is not the one given (the build that passed the tests);
#   - a program key file whose address is not the program's declare_id;
#   - an RPC that is not the network named (genesis hash; a fork is not mainnet);
#   - --deploy without --confirm <PROGRAM ID>;
#   - a program that exists with another upgrade authority, or with too little room.
#
# THE UPGRADE AUTHORITY MUST NEVER BE LOCKED. This script never makes a deploy
# final and never changes the authority, and nothing else in this repository
# may (scripts/deploy-program.test.sh checks). The program's deposit comes back
# only when the upgrade authority closes the program; with the authority locked
# the deposit would stay in the program forever. Team decision, Nov 24, 2026.
#
# The wallet pays and becomes the upgrade authority. Key files are passed to
# the solana CLI by path; this script never prints or copies their contents.
# The mainnet RPC URL comes from RPC_URL (environment, or the git-ignored
# .env.local); it holds an API key, so only its host is ever printed.
#
# The buffer key is a file (made here if missing, without a seed phrase on the
# screen), so an interrupted deploy resumes by running the same command again.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
so_file="${SO_FILE:-$repo_root/target/deploy/rung.so}"
program_keypair="${PROGRAM_KEYPAIR:-$repo_root/target/deploy/rung-keypair.json}"
env_file="${ENV_FILE:-$repo_root/.env.local}"

DEVNET_GENESIS_HASH="EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
MAINNET_GENESIS_HASH="5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"

refuse() {
  echo "Refused: $*" >&2
  echo "Nothing was sent." >&2
  exit 1
}

# --- arguments ---------------------------------------------------------------------

network="" wallet="" want_sha="" buffer="" confirm="" rpc_flag="" cu_price=""
do_check=0 do_deploy=0 use_rpc=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --network) network="${2-}"; shift 2 ;;
    --wallet) wallet="${2-}"; shift 2 ;;
    --sha256) want_sha="${2-}"; shift 2 ;;
    --buffer) buffer="${2-}"; shift 2 ;;
    --confirm) confirm="${2-}"; shift 2 ;;
    --rpc) rpc_flag="${2-}"; shift 2 ;;
    --cu-price) cu_price="${2-}"; shift 2 ;;
    --tpu) use_rpc=0; shift ;;
    --check) do_check=1; shift ;;
    --deploy) do_deploy=1; shift ;;
    *) refuse "unknown argument: $1" ;;
  esac
done

case "$network" in
  mainnet | devnet | local-fork) ;;
  *) refuse "--network must be mainnet, devnet or local-fork" ;;
esac
[[ $((do_check + do_deploy)) -eq 1 ]] || refuse "say --check or --deploy (one of them)"
[[ -n "$wallet" ]] || refuse "--wallet <keypair file> is required (it pays, and becomes the upgrade authority)"
[[ -f "$wallet" ]] || refuse "wallet file not found: $wallet"
[[ -n "$want_sha" ]] || refuse "--sha256 <hash of the tested build> is required"
[[ -z "$cu_price" || "$cu_price" =~ ^[0-9]+$ ]] || refuse "--cu-price must be a whole number of micro-lamports"

# --- the build and the program address ------------------------------------------------

[[ -f "$so_file" ]] || refuse "program file not found: $so_file (run anchor build)"
have_sha="$(sha256sum "$so_file" | cut -d' ' -f1)"
[[ "$have_sha" == "$want_sha" ]] || refuse "$so_file is not the build that was tested (its sha256 is $have_sha)"
so_bytes="$(stat -c %s "$so_file")"

program_id="$(sed -n 's/^declare_id!("\([1-9A-HJ-NP-Za-km-z]\{32,44\}\)");.*/\1/p' "$repo_root/programs/rung/src/lib.rs")"
[[ -n "$program_id" ]] || refuse "could not read declare_id! from programs/rung/src/lib.rs"
grep -q "rung = \"$program_id\"" "$repo_root/Anchor.toml" || refuse "Anchor.toml does not name $program_id for rung"
have_program_key=0
if [[ -f "$program_keypair" ]]; then
  have_program_key=1
  key_address="$(solana address -k "$program_keypair")"
  [[ "$key_address" == "$program_id" ]] || refuse "the program key file is for $key_address, which does not match declare_id $program_id"
fi

same_file() { [[ -e "$1" && -e "$2" && "$(realpath "$1")" == "$(realpath "$2")" ]]; }
same_file "$wallet" "$program_keypair" && refuse "the wallet and the program key are the same file"
buffer="${buffer:-$HOME/.config/solana/rung-buffer-$network.json}"
if same_file "$buffer" "$wallet" || same_file "$buffer" "$program_keypair"; then
  refuse "the buffer key must be a file of its own"
fi

# --- the RPC ------------------------------------------------------------------------------

rpc=""
case "$network" in
  mainnet)
    rpc="${RPC_URL-}"
    if [[ -z "$rpc" && -f "$env_file" ]]; then
      rpc="$(grep '^RPC_URL=' "$env_file" | head -n 1 | cut -d= -f2- || true)"
    fi
    [[ -n "$rpc" ]] || refuse "mainnet needs RPC_URL (environment, or .env.local written by scripts/set-rpc-url.sh)"
    ;;
  devnet) rpc="${rpc_flag:-https://api.devnet.solana.com}" ;;
  local-fork) rpc="${rpc_flag:-http://127.0.0.1:8899}" ;;
esac

host="${rpc#*://}"
host="${host%%/*}"
host="${host%%\?*}"
host="${host##*@}"
if [[ "$host" == \[* ]]; then host="${host%%]*}]"; else host="${host%%:*}"; fi
is_local=0
[[ "$host" == "127.0.0.1" || "$host" == "localhost" || "$host" == "[::1]" ]] && is_local=1

# The pieces of the URL that can be a key: a query value, or a long last path segment.
secret=""
if [[ "$rpc" == *=* ]]; then secret="${rpc##*=}"; else secret="${rpc##*/}"; fi
[[ ${#secret} -ge 8 ]] || secret=""
hide() {
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line//"$rpc"/(RPC $host)}"
    [[ -n "$secret" ]] && line="${line//"$secret"/(hidden)}"
    printf '%s\n' "$line"
  done
}

if [[ "$network" == "mainnet" && $is_local -eq 1 ]]; then
  refuse "the RPC $host is on this machine: that is a fork, not mainnet (use --network local-fork)"
fi
if [[ "$network" == "local-fork" && $is_local -eq 0 ]]; then
  refuse "local-fork accepts only an RPC on this machine, not $host"
fi
if [[ $do_deploy -eq 1 && "$confirm" != "$program_id" ]]; then
  refuse "--deploy needs --confirm $program_id (the program address, typed out)"
fi

# --- from here on the script talks to the network (reads first) ------------------------------

genesis="$(solana genesis-hash -u "$rpc" 2>/dev/null || true)"
[[ -n "$genesis" ]] || refuse "could not read the genesis hash from the RPC $host"
case "$network" in
  mainnet) [[ "$genesis" == "$MAINNET_GENESIS_HASH" ]] || refuse "the RPC $host is not mainnet (genesis $genesis)" ;;
  devnet) [[ "$genesis" == "$DEVNET_GENESIS_HASH" ]] || refuse "the RPC $host is not devnet (genesis $genesis)" ;;
esac

wallet_address="$(solana address -k "$wallet")"
lamports_of() { solana "$@" -u "$rpc" --lamports 2>/dev/null | grep -o '[0-9]\+' | head -n 1; }
sol() { awk -v l="$1" 'BEGIN { printf "%.9f SOL", l / 1000000000 }'; }

balance="$(lamports_of balance "$wallet_address")" || true
[[ -n "${balance-}" ]] || refuse "could not read the balance of $wallet_address"
# Program data account: the program's bytes plus 45 bytes of header. Program account: 36 bytes.
data_rent="$(lamports_of rent $((so_bytes + 45)))" || true
program_rent="$(lamports_of rent 36)" || true
[[ -n "${data_rent-}" && -n "${program_rent-}" ]] || refuse "could not read the rent from the RPC $host"

shown="$(solana program show "$program_id" -u "$rpc" --keypair "$wallet" 2>&1 || true)"
exists=0
if grep -q '^Authority:' <<<"$shown"; then
  exists=1
  authority="$(sed -n 's/^Authority: *//p' <<<"$shown")"
  data_len="$(sed -n 's/^Data Length: *\([0-9]\+\).*/\1/p' <<<"$shown")"
  [[ "$authority" == "$wallet_address" ]] || refuse "the program exists and its upgrade authority is $authority, not this wallet ($wallet_address)"
  [[ "$data_len" -ge "$so_bytes" ]] || refuse "the program exists with room for $data_len bytes; this build is $so_bytes (extend it first: solana program extend)"
elif ! grep -qi 'unable to find\|not found\|does not exist' <<<"$shown"; then
  refuse "could not read the state of $program_id: $(hide <<<"$shown" | head -n 1)"
fi
[[ $exists -eq 1 || $have_program_key -eq 1 ]] || refuse "a first deploy needs the program key file ($program_keypair)"

[[ -n "$cu_price" ]] || { [[ "$network" == "mainnet" ]] && cu_price=50000 || cu_price=0; }
# About 1,000 bytes per write transaction, one signature each, plus a handful of others.
writes=$((so_bytes / 1000 + 5))
fees=$((writes * 5000 + writes * cu_price * 5000 / 1000000))
if [[ $exists -eq 1 ]]; then deposit=0; else deposit=$((data_rent + program_rent)); fi
# An upgrade needs the buffer's deposit while it runs; it comes back when the upgrade lands.
working=$((exists == 1 ? data_rent : 0))
# An interrupted deploy has already paid into the buffer account; that part is not needed twice.
in_buffer=0
if [[ -f "$buffer" ]]; then
  in_buffer="$(lamports_of balance "$(solana address -k "$buffer")")" || true
  in_buffer="${in_buffer:-0}"
fi
[[ "$in_buffer" -le "$data_rent" ]] || in_buffer="$data_rent"
need=$((deposit + working - in_buffer + fees))

echo "Network          $network (RPC $host)"
echo "Program          $program_id ($([[ $exists -eq 1 ]] && echo "exists: upgrade" || echo "not there yet: first deploy"))"
echo "Build            $so_bytes bytes, sha256 $have_sha"
echo "Wallet           $wallet_address: $(sol "$balance")"
if [[ $exists -eq 1 ]]; then
  echo "Deposit          none (already paid); $(sol "$working") is held while the upgrade runs and comes back"
else
  echo "Deposit          $(sol "$deposit") (program data $(sol "$data_rent") + program account $(sol "$program_rent"))"
  echo "                 comes back only if the program is closed; a closed program address cannot be used again"
fi
echo "Fees             about $(sol "$fees") for about $writes transactions (CU price $cu_price micro-lamports); do not come back"
if [[ "$in_buffer" -gt 0 ]]; then
  echo "In the buffer    $(sol "$in_buffer") already, from an earlier run of this deploy"
fi
echo "Needed in wallet about $(sol "$need")"
if [[ "$balance" -lt "$need" ]]; then
  echo "Short by         about $(sol $((need - balance)))"
fi
echo "Upgrade authority after the deploy: the wallet, $wallet_address"
echo "THE UPGRADE AUTHORITY MUST NEVER BE LOCKED: the deposit can come back only through it."

if [[ $do_check -eq 1 ]]; then
  echo "--check: nothing was sent."
  exit 0
fi
[[ "$balance" -ge "$need" ]] || refuse "the wallet holds less than the deploy needs"

# --- deploy -------------------------------------------------------------------------------------

if [[ ! -f "$buffer" ]]; then
  mkdir -p "$(dirname "$buffer")"
  solana-keygen new --silent --no-bip39-passphrase -o "$buffer" >/dev/null
  chmod 600 "$buffer"
fi
echo "Buffer           $(solana address -k "$buffer") (key file $buffer)"
echo
echo "Deploying. If this stops half way, run the same command again: it resumes from the buffer."
echo "To give up instead and take the deposit back from the buffer:"
echo "  solana program close --buffers --keypair $wallet -u <the same RPC>"
echo

if [[ $exists -eq 1 ]]; then program_arg="$program_id"; else program_arg="$program_keypair"; fi
args=(program deploy "$so_file" --program-id "$program_arg" --keypair "$wallet" --fee-payer "$wallet"
  --upgrade-authority "$wallet" --buffer "$buffer" -u "$rpc" --max-sign-attempts 50)
[[ "$cu_price" -gt 0 ]] && args+=(--with-compute-unit-price "$cu_price")
[[ $use_rpc -eq 1 ]] && args+=(--use-rpc)

set +e
solana "${args[@]}" 2>&1 | hide
status=${PIPESTATUS[0]}
set -e
if [[ $status -ne 0 ]]; then
  echo "The deploy did not finish (exit code $status). The SOL sent so far is in the buffer account, not lost: see above." >&2
  exit "$status"
fi

# --- verify what is on chain -----------------------------------------------------------------------

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
solana program dump "$program_id" "$tmp/onchain.so" -u "$rpc" --keypair "$wallet" >/dev/null 2>&1 || {
  echo "Deployed, but the program could not be read back to compare. Check by hand." >&2
  exit 1
}
onchain_sha="$(head -c "$so_bytes" "$tmp/onchain.so" | sha256sum | cut -d' ' -f1)"
padding="$(tail -c +$((so_bytes + 1)) "$tmp/onchain.so" | tr -d '\0' | wc -c)"
after="$(lamports_of balance "$wallet_address")"
echo
solana program show "$program_id" -u "$rpc" --keypair "$wallet" 2>&1 | hide
echo
if [[ "$onchain_sha" == "$have_sha" && "$padding" -eq 0 ]]; then
  echo "Verified: the program on $network is byte for byte the build $have_sha."
else
  echo "MISMATCH: the program on $network is not the build $have_sha (on chain: $onchain_sha)." >&2
  exit 1
fi
echo "Wallet           $(sol "$after") left; this deploy took $(sol $((balance - after)))"
