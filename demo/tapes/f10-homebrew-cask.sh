#!/bin/bash
# Sets up or tears down the scratch tap the f10-homebrew-cask tape installs from.
# up: copies the tap's cask twice, one pointed at the local dmg, one only with its sha. down: undoes it.
set -euo pipefail
CASK=~/Documents/Code/homebrew-tap/Casks/messhall.rb
PREFS=~/Library/Preferences/dev.messhall.app.plist
case "$1" in
  up)
    rm -rf /tmp/messhall-tape-apps && mkdir -p /tmp/messhall-tape-apps
    cp "$PREFS" /tmp/messhall-tape-prefs.plist
    brew tap-new --no-git messhall-qa/local >/dev/null 2>&1 || true
    T="$(brew --repository messhall-qa/local)/Casks" && mkdir -p "$T"
    DMG="$PWD/app/build/Messhall.dmg"
    SHA="$(shasum -a 256 "$DMG" | cut -d' ' -f1)"
    sed -e "s|sha256 \".*\"|sha256 \"$SHA\"|" -e "s|url \".*\"|url \"file://$DMG\"|" "$CASK" >"$T/messhall.rb"
    sed -e "s|sha256 \".*\"|sha256 \"$SHA\"|" -e 's/^cask "messhall"/cask "messhall-release"/' "$CASK" >"$T/messhall-release.rb"
    ;;
  down)
    # zap trashes the app's prefs, and this Mac's real app shares them, so put them back.
    defaults import dev.messhall.app /tmp/messhall-tape-prefs.plist
    brew untap messhall-qa/local >/dev/null 2>&1
    ;;
esac
