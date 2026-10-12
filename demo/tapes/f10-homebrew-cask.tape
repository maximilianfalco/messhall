# QA tape for the Homebrew cask: installs the tap's cask from a scratch tap with the url pointed at the local
# make dmg build, runs the brew-linked messhall against a scratch daemon, audits the cask, then zaps it.
# Needs app/build/Messhall.dmg and the tap clone at ~/Documents/Code/homebrew-tap.

Output demo/out/f10-homebrew-cask.mp4
Output demo/out/f10-homebrew-cask.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-cask"
Env MESSHALL_PORT "7864"
Env MESSHALL_SUMMARIES "off"
Env HOMEBREW_NO_AUTO_UPDATE "1"
Env HOMEBREW_NO_AUTOREMOVE "1"
Env HOMEBREW_NO_ENV_HINTS "1"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME; bash demo/tapes/f10-homebrew-cask.sh up; clear"
Enter
Show

Type "brew install --cask --appdir=/tmp/messhall-tape-apps messhall-qa/local/messhall; echo exit $?"
Enter
Sleep 12s

Type "readlink /opt/homebrew/bin/messhall; echo exit $?"
Enter
Sleep 2s

Type "/opt/homebrew/bin/messhall daemon > /dev/null 2>&1 & sleep 2; /opt/homebrew/bin/messhall status; echo exit $?"
Enter
Sleep 5s

Type "kill %1; brew uninstall --zap --cask messhall-qa/local/messhall; test ! -e /opt/homebrew/bin/messhall; echo exit $?"
Enter
Sleep 8s

Type "brew audit --cask --strict messhall-qa/local/messhall-release; echo exit $?"
Enter
Sleep 10s

Hide
Type "bash demo/tapes/f10-homebrew-cask.sh down; clear"
Enter
Show

Type "pnpm -s vitest run test/app/launcher.test.ts | tail -4; echo exit $?"
Enter
Sleep 15s
