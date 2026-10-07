# QA tape for the seat token: a claude started by hand (no seat header) joins and gets a seat token, the orchestrator
# makes it a worker, its session closes, a stranger is refused the name, and the token takes the seat back as
# reconnected with the worker role. Scratch home and port 7793.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 20

Output demo/out/plain-claude-seat.mp4
Output demo/out/plain-claude-seat.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-plain-claude-seat"
Env MESSHALL_PORT "7793"

Hide
Type "rm -rf $MESSHALL_HOME; setopt no_monitor no_notify; pnpm -s messhall-dev daemon --keep > /dev/null; alias claude-seat='pnpm -s tsx --disable-warning=ExperimentalWarning demo/tapes/plain-claude-seat.ts'; clear"
Enter
Sleep 6s
Show

Type "claude-seat api | tee /tmp/plain-claude-seat.out; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@60s /exit 0/
Sleep 2s

Type "pnpm -s messhall-dev agent orchestrator --room demo --say '@api your role: worker' --assign api=worker > /dev/null; echo exit $?"
Sleep 500ms
Enter
Sleep 8s

Type "claude-seat api; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@60s /name taken/
Sleep 3s

Type "claude-seat api $(grep -o 'tok-[0-9a-f-]\{36\}' /tmp/plain-claude-seat.out); echo exit $?"
Sleep 500ms
Enter
Wait+Screen@60s /worker/
Sleep 8s

Hide
Type "kill $(lsof -t -iTCP:7793 -sTCP:LISTEN); rm -f /tmp/plain-claude-seat.out"
Enter
Sleep 1s
