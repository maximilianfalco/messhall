# QA tape for invites: the invite store: who may invite, an orchestrator never makes an orchestrator, name taken, the first call seats the role, expiry.

Output demo/out/invites-store.mp4
Output demo/out/invites-store.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-invites-store"

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

Type "pnpm -s vitest run test/rooms/invites.test.ts --reporter verbose 2>&1 | grep -E '✓|×|Tests'; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 12s

Sleep 7s
