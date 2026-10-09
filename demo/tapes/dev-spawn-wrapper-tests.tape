# QA tape for the dev spawn wrapper: claim, worktree, product spawn, hand-back on a refusal, flock stop by row.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 10

Output demo/out/dev-spawn-wrapper-tests.mp4
Output demo/out/dev-spawn-wrapper-tests.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-devspawntests"

Hide
Type "clear"
Enter
Show

Type "pnpm -s vitest run test/tools/spawn.test.ts --reporter verbose 2>&1 | grep -E 'spawnRun|seatRun|flockStop|Tests'; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@90s /exit [0-9]/
Sleep 8s
