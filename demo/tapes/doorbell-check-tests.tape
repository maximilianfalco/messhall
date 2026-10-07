# QA tape for the doorbell check: the session state with time injected (acked, timed out, acked late),
# the test ring and doorbell_ok over mcp, and the ringer skipping a session that never answered.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 20

Output demo/out/doorbell-check-tests.mp4
Output demo/out/doorbell-check-tests.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-doorbell-check-tests"

Hide
Type "clear"
Enter
Show

Type "pnpm -s vitest run test/mcp/doorbellCheck.test.ts test/doorbell/ringers/channel.test.ts test/mcp/transport.test.ts -t 'doorbell' --reporter verbose 2>&1 | grep -E '✓|×|Tests'; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@90s /exit [0-9]/
Sleep 6s
