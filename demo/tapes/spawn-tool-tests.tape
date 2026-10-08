# QA tape for the spawn tool: the tool and store tests, with the seat cap, the spawn rate and every refusal.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 10

Output demo/out/spawn-tool-tests.mp4
Output demo/out/spawn-tool-tests.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-spawntooltests"

Hide
Type "clear"
Enter
Show

Type "pnpm -s vitest run test/mcp/spawn.test.ts test/rooms/invites.test.ts -t 'spawn' --reporter verbose 2>&1 | grep -E '✓|×|Tests'; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@90s /exit [0-9]/
Sleep 8s
