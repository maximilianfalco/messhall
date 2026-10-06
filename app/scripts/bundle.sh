#!/bin/bash
# Builds the Debug app with swift build and wraps it in app/build/Messhall.app.
set -euo pipefail
cd "$(dirname "$0")/.."

# xcode-select may point at CommandLineTools, which has no XCTest or Testing for swift test.
if [ -z "${DEVELOPER_DIR:-}" ] && [ -d /Applications/Xcode.app ]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi

swift build --package-path Messhall --product Messhall
BIN="$(swift build --package-path Messhall --show-bin-path)/Messhall"
APP=build/Messhall.app

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/Messhall"
cp Messhall/Resources/Info.plist "$APP/Contents/Info.plist"
# Ad hoc is enough for a local Debug build. Headroom's signing identity is for installed release builds.
codesign --force --sign - "$APP" 2>/dev/null
echo "$PWD/$APP"
