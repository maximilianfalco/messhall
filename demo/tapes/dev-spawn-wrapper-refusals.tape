# QA tape for the dev spawn wrapper refusals: a row with no branch, an unknown row, and flock with no daemon.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 10

Output demo/out/dev-spawn-wrapper-refusals.mp4
Output demo/out/dev-spawn-wrapper-refusals.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-devspawnrefusals"
Env MESSHALL_PORT "7797"

Hide
Type "clear"
Enter
Show

Type "pnpm -s messhall-dev spawn D19 --dry-run; echo exit $?"
Sleep 500ms
Enter
Sleep 6s

Type "pnpm -s messhall-dev spawn B999 --dry-run; echo exit $?"
Sleep 500ms
Enter
Sleep 6s

Type "pnpm -s messhall-dev flock; echo exit $?"
Sleep 500ms
Enter
Sleep 6s
