# QA tape for healing: the pure restart plan (back off, give up at 3, no restart after leave or kick, a seat never
# seen running stays down), the spawner restart on the same seat key, the human ring and the sweep wiring.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 20

Output demo/out/heal-tests.mp4
Output demo/out/heal-tests.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-heal-tests"

Hide
Type "clear"
Enter
Show

Type "pnpm -s vitest run test/flock/heal.test.ts test/flock/spawner.test.ts test/daemon/server.test.ts --reporter verbose 2>&1 | grep -E '✓|×' | grep -E 'healPlan|healing a spawned|restarts a spawned' | sed -E 's/test[^>]*> //; s/ [0-9]+ms$//' | cut -c1-118 | tail -24; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 14s

Type "clear; pnpm -s vitest run test/flock/heal.test.ts test/flock/spawner.test.ts test/daemon/server.test.ts 2>&1 | tail -5; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 8s
