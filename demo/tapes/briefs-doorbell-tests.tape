# QA tape for the doorbell briefs: the seat prompt ends the turn when idle, fits one tmux burst, and spawn --reviewer names the gate

Output demo/out/briefs-doorbell-tests.mp4
Output demo/out/briefs-doorbell-tests.gif

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

Type "pnpm -s vitest run test/tools/spawn.test.ts test/docs/briefs.test.ts -t 'turn|tmux burst|reviewer' --reporter verbose 2>&1 | grep -E '✓|×|Tests'; echo exit $?"
Sleep 500ms
Enter
Sleep 12s
