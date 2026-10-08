# QA tape for the guarded merge: the cases it refuses and the one it merges, through a fake gh.
# No daemon, scratch home, no real PR is touched.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 10

Output demo/out/role-permissions-merge-guard.mp4
Output demo/out/role-permissions-merge-guard.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-mergeguard"

Hide
Type "clear"
Enter
Show

Type "pnpm -s messhall-dev merge --help | head -4; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Type "pnpm -s vitest run test/tools/merge.test.ts --reporter verbose 2>&1 | grep -E '✓|×|Tests'; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@60s /exit [0-9]/
Sleep 7s
