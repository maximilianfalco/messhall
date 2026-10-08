#!/bin/bash
# Builds app/build/Messhall.dmg: a Release Messhall.app that carries node and the messhall CLI, ad hoc signed.
# Signing with a Developer ID and notarizing need the owner's Apple account, so they are not here.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$PWD"

if [ -z "${DEVELOPER_DIR:-}" ] && [ -d /Applications/Xcode.app ]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi

# A release build, so the CLI's version is whatever the tag says.
pnpm build
swift build --package-path app/Messhall -c release --product Messhall
BIN="$(swift build --package-path app/Messhall -c release --show-bin-path)/Messhall"

APP=app/build/Messhall.app
RUNTIME="$APP/Contents/Resources/runtime"
rm -rf "$APP" app/build/dmg app/build/Messhall.dmg
mkdir -p "$APP/Contents/MacOS" "$RUNTIME/cli"
cp "$BIN" "$APP/Contents/MacOS/Messhall"
cp app/Messhall/Resources/Info.plist "$APP/Contents/Info.plist"
if COMMIT="$(git rev-parse HEAD 2>/dev/null)"; then
  AT="$(TZ=UTC0 git log -1 --format=%cd --date=format-local:%Y-%m-%dT%H:%M:%S.000Z)"
  /usr/libexec/PlistBuddy -c "Add :MesshallCommit string $COMMIT" \
    -c "Add :MesshallCommittedAt string $AT" "$APP/Contents/Info.plist"
fi

# The daemon needs node 22 for node:sqlite, so the app brings its own.
cp "$(command -v node)" "$RUNTIME/node"
cp -R dist package.json pnpm-lock.yaml "$RUNTIME/cli/"
(cd "$RUNTIME/cli" && pnpm install --prod --frozen-lockfile --ignore-scripts >/dev/null)

codesign --force --sign - "$RUNTIME/node"
codesign --force --sign - "$APP"

STAGE=app/build/dmg
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -quiet -volname Messhall -srcfolder "$STAGE" -ov -format UDZO app/build/Messhall.dmg
rm -rf "$STAGE"
echo "$ROOT/app/build/Messhall.dmg"
