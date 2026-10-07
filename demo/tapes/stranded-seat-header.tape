# QA tape for no stranded seats: messhall claude refuses an entry with no seat header, start warns and says idle claudes need a nudge

Output demo/out/stranded-seat-header.mp4
Output demo/out/stranded-seat-header.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-stranded-header"

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

Type "pnpm -s vitest run test/cli/launch.test.ts test/cli/install.test.ts -t 'seat header|idle claude' --reporter verbose 2>&1 | grep -E '✓|×|Tests'; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@60s /exit [0-9]/
Sleep 6s
