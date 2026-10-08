# QA tape for take-to-room: the prompt is listed, picks a room or joins the named one, and the server instructions carry the line.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 20

Output demo/out/take-to-room-tests.mp4
Output demo/out/take-to-room-tests.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-take-to-room-tests"

Hide
Type "clear"
Enter
Show

Type "pnpm -s vitest run test/mcp/joinPrompt.test.ts --reporter verbose 2>&1 | grep -E '✓|×|Tests'; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@90s /exit [0-9]/
Sleep 6s
