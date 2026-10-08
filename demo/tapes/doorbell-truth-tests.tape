# QA tape for the doorbell label: a rejoin sends a fresh test ring, and a ring that reached the seat turns off back to on.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 20

Output demo/out/doorbell-truth-tests.mp4
Output demo/out/doorbell-truth-tests.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-doorbell-truth-tests"

Hide
Type "clear"
Enter
Show

Type "pnpm -s vitest run test/mcp/doorbellCheck.test.ts test/doorbell/ringers/channel.test.ts --reporter verbose 2>&1 | grep -E 'reaches the session|×|Tests'; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@90s /exit [0-9]/
Sleep 6s
