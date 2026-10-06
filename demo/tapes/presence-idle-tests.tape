# QA tape for idle presence: the rule, the sweep and the daemon keep a quiet seat its doorbell
# can still ring idle, and a seat nothing can reach turns away at 30 minutes.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 20

Output demo/out/presence-idle-tests.mp4
Output demo/out/presence-idle-tests.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-presence-idle-tests"

Hide
Type "clear"
Enter
Show

Type "pnpm -s vitest run test/rooms/rules.test.ts test/rooms/store.test.ts test/mcp/transport.test.ts -t 'Presence|presence|ringable|idle' --reporter verbose 2>&1 | grep -E '✓|×|Tests'; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@60s /exit [0-9]/
Sleep 6s
