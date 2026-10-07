# QA tape for no stranded seats: a ring that reaches no session is held, sent on reattach, dropped on leave

Output demo/out/stranded-held-ring.mp4
Output demo/out/stranded-held-ring.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-stranded-held"

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

Type "pnpm -s vitest run test/doorbell/doorbell.test.ts -t 'held|holds a ring' --reporter verbose 2>&1 | grep -E '✓|×|Tests'; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@60s /exit [0-9]/
Sleep 6s
