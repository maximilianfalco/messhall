# QA tape for seat first spawns: the first prompt only seats the agent, the row comes in the role instructions after the join.

Output demo/out/spawn-seat-first.mp4
Output demo/out/spawn-seat-first.gif

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Env MESSHALL_HOME "/tmp/messhall-tape-home-spawn-seat-first"

Hide
Type "clear"
Enter
Show

Type "pnpm -s messhall-dev spawn agent --as reviewer-9 --dry-run | grep 'prompt:' | grep -oiE 'queue|branch|worktree|brief|job' | wc -l; echo exit $?"
Sleep 500ms
Enter
Sleep 6s

Type "pnpm -s vitest run test/tools/spawn.test.ts -t 'row seat prompt|rowInstructions|assignLine|seatThenAssign' --reporter verbose | grep -E '✓|✗|×|Tests'; echo exit $?"
Sleep 500ms
Enter

Sleep 12s
