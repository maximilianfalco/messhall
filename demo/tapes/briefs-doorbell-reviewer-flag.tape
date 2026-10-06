# QA tape for spawn --reviewer: the flag shows in help next to --instructions

Output demo/out/briefs-doorbell-reviewer-flag.mp4
Output demo/out/briefs-doorbell-reviewer-flag.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-briefs"

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

Type "pnpm -s messhall-dev spawn --help | grep -A1 -E 'instructions|reviewer'; echo exit $?"
Sleep 500ms
Enter
Sleep 6s
