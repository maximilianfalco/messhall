#!/bin/bash
# Quits a checkout's app, unregisters it from LaunchServices and deletes its app/build. Takes the checkout, else this one.
# Stale builds under the Messhall ids once made macOS drop every banner, so worktrees clean up before removal.
set -euo pipefail
cd "${1:-$(dirname "$0")/../..}"

# A worktree has a .git file. A folder means the main checkout, nothing means a typo in WORKTREE=.
if [ -d .git ] && [ -z "${FORCE:-}" ]; then
  echo "$PWD is the main checkout, whose app the human runs. FORCE=1 make app-clean to clean it anyway." >&2
  exit 1
fi
if [ ! -e .git ]; then
  echo "$PWD is not a git worktree, nothing cleaned." >&2
  exit 1
fi

LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
APP="$PWD/app/build/Messhall.app"
BIN="$APP/Contents/MacOS/Messhall"

if pkill -f "$BIN"; then
  for _ in $(seq 50); do pgrep -f "$BIN" >/dev/null || break; sleep 0.1; done
  pkill -9 -f "$BIN" || true
fi
"$LSREGISTER" -u "$APP" 2>/dev/null || true
rm -rf app/build
echo "cleaned $APP"
