# QA tape for the app builds step in check: a scratch worktree build is registered and running,
# so check warns (never fails) and prints the make line that cleans it.

Output demo/out/app-builds-check-warn.mp4
Output demo/out/app-builds-check-warn.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-app-builds-warn"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "clear"
Enter
Show

Type "pgrep -lf Messhall.app/Contents/MacOS/Messhall | cut -c1-110; echo exit $?"
Sleep 500ms
Enter
Sleep 2s

Type "pnpm -s messhall-dev check; echo exit $?"
Sleep 500ms
Enter
Sleep 16s
