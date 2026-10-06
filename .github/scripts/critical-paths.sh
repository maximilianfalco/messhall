#!/usr/bin/env bash
# Prints the changed files between BASE and HEAD that match the ```paths block in CRITICAL.md.
# Exit 0 always; an empty output means nothing critical changed.
set -euo pipefail
BASE="${1:?usage: critical-paths.sh <base-ref> [head-ref]}"
HEAD="${2:-HEAD}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

specs=()
while IFS= read -r line; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  specs+=(":(glob)$line")
done < <(awk '/^```paths$/{on=1; next} /^```$/{on=0} on' "$ROOT/CRITICAL.md")

git -C "$ROOT" diff --name-only "$BASE...$HEAD" -- "${specs[@]}" | sort -u
