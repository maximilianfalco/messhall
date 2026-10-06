# QA tape for the toolchain: the full gate, then the dev CLI help. Run from the repo root.
# Nothing here touches a daemon or real data.

Output demo/out/scaffold-make-check.mp4
Output demo/out/scaffold-make-check.gif

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

Type "make check 2>&1 | tail -n 14; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 12s

Hide
Type "clear"
Enter
Show

Type "pnpm --silent messhall-dev --help; echo exit $?"
Sleep 500ms
Enter

Sleep 5s
