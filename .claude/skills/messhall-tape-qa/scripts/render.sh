#!/usr/bin/env bash
# Render one tape after checking it can only touch a scratch messhall home.
# Usage: render.sh <tape>, run from the directory the tape expects.
set -euo pipefail

tape="${1:?usage: render.sh <tape>}"
fail() { echo "render: $*" >&2; exit 1; }

[ -f "$tape" ] || fail "no tape at $tape"
command -v vhs >/dev/null || fail "vhs is missing. brew install vhs"

# The tape's own Env line is the home we check, so the check and the take never differ.
home="$(sed -n 's/^Env MESSHALL_HOME "\(.*\)"$/\1/p' "$tape" | head -1)"
real="$HOME/Library/Application Support/messhall"
[ -n "$home" ] || fail "$tape has no Env MESSHALL_HOME line. add one that points at a scratch dir"
[ "${home%/}" != "$real" ] || fail "$tape points at the real data dir. use a scratch dir like /tmp/messhall-tape-home"

MESSHALL_HOME="$home" vhs "$tape"

sed -n 's/^Output \(.*\)$/\1/p' "$tape" | while read -r out; do
  [ -f "$out" ] || fail "vhs did not write $out"
  bytes="$(wc -c <"$out" | tr -d ' ')"
  echo "$out $((bytes / 1024))KB"
  case "$out" in
    *.gif) [ "$bytes" -lt 10000000 ] || echo "  over 10MB, GitHub will refuse it. lower Framerate or Height" ;;
  esac
done
