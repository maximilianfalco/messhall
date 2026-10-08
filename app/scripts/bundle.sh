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
cp -R Messhall/Resources/Templates "$APP/Contents/Resources/Templates"
# The same stamp the daemon serves as build, so the app and messhall status can say which side is older.
if COMMIT="$(git rev-parse HEAD 2>/dev/null)"; then
  AT="$(TZ=UTC0 git log -1 --format=%cd --date=format-local:%Y-%m-%dT%H:%M:%S.000Z)"
  /usr/libexec/PlistBuddy -c "Add :MesshallCommit string $COMMIT" \
    -c "Add :MesshallCommittedAt string $AT" "$APP/Contents/Info.plist"
fi
# macOS lost the real app's banners once every deleted worktree build sat in LaunchServices under the same id.
# So only the main checkout (where .git is a folder) builds dev.messhall.app.
if [ -f ../.git ]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier dev.messhall.app.worktree" \
    -c "Set :CFBundleDisplayName Messhall Worktree" "$APP/Contents/Info.plist"
fi
# Ad hoc is enough for a local Debug build. Headroom's signing identity is for installed release builds.
codesign --force --sign - "$APP" 2>/dev/null
echo "$PWD/$APP"
