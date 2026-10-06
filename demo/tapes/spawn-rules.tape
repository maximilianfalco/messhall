# QA tape for the spawn rules: the seat prompt keeps agents off the human seat, the argv reads the main checkout, row agents close their own row.

Output demo/out/spawn-rules.mp4
Output demo/out/spawn-rules.gif

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Env MESSHALL_HOME "/tmp/messhall-tape-home-spawn-rules"

Hide
Type "clear"
Enter
Show

Type "pnpm -s messhall-dev spawn agent --as reviewer-9 --dry-run | grep -oE -- '--add-dir [^ ]+|Talk in the room[^.]*\.|Never speak as the human[^.]*\.|test with[^.]*\.'; echo exit $?"
Sleep 500ms
Enter
Sleep 6s

Type "pnpm -s vitest run test/tools/spawn.test.ts -t 'spawnPrompt|seatPrompt|spawnArgv' | tail -5; echo exit $?"
Sleep 500ms
Enter

Sleep 10s
