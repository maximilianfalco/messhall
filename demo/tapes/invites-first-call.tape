# QA tape for invites: an invited claude posts over real HTTP with only its seat header, codex joins with its invite token, the sweep drops an unused invite.

Output demo/out/invites-first-call.mp4
Output demo/out/invites-first-call.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-invites-first-call"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME; clear"
Enter
Show

Type "pnpm -s vitest run test/mcp/transport.test.ts test/mcp/join.test.ts test/daemon/server.test.ts -t invite --reporter verbose 2>&1 | grep -E '✓|×|Tests'; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 12s

Sleep 7s
