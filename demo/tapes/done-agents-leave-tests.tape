# QA tape for done agents leaving: a done seat away 61 minutes leaves (59 stays), not done, still here and the
# orchestrator stay, the daemon sweep does it, and a seat that leaves, is kicked or leaves on its own stops its session.

Output demo/out/done-agents-leave-tests.mp4
Output demo/out/done-agents-leave-tests.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-done-agents-leave-tests"

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

Type "pnpm -s vitest run test/rooms/doneLeave.test.ts test/flock/spawner.test.ts test/daemon/server.test.ts test/docs/briefs.test.ts -t 'leave|session|done' --reporter verbose 2>&1 | grep -E '✓|×|Tests' | sed 's/ [0-9]*ms$//'; echo exit $?"
Sleep 500ms
Enter
Sleep 16s
