# QA tape for respawned rows: spawn keeps the row's seat key, so a stopped and respawned row reconnects with its role

Output demo/out/respawn-seat-tests.mp4
Output demo/out/respawn-seat-tests.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-respawn-seat"

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

Type "pnpm -s vitest run test/tools/spawn.test.ts -t writeSpawnConfig --reporter verbose 2>&1 | grep -E '✓|×|Tests'; echo exit $?"
Sleep 500ms
Enter
Sleep 12s
