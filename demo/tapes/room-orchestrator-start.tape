# QA tape for the one step room start: room new --orchestrator makes the room and spawns a real claude seated as
# orchestrator with the shipped brief. Scratch home, port 7911, own tmux socket.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 10

Output demo/out/room-orchestrator-start.mp4
Output demo/out/room-orchestrator-start.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-room-orchestrator"
Env MESSHALL_PORT "7911"
Env TMUX_TMPDIR "/tmp/messhall-tape-tmux-room-orchestrator"

Hide
Type "unset TMUX; kill $(lsof -t -iTCP:7911 -sTCP:LISTEN) 2>/dev/null; sleep 1; rm -rf $MESSHALL_HOME /tmp/messhall-tape-shop; mkdir -p $TMUX_TMPDIR /tmp/messhall-tape-shop; pnpm -s messhall-dev daemon --keep > /dev/null; clear"
Enter
Sleep 8s
Show

Type "pnpm -s dev room new planning --topic 'checkout v2' --orchestrator --cwd /tmp/messhall-tape-shop; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@180s /exit [0-9]/
Sleep 3s

Type "pnpm -s messhall-dev room planning; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@30s /exit [0-9](.|\n)*exit [0-9]/
Sleep 3s

Type "pnpm -s dev flock; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@30s /exit [0-9](.|\n)*exit [0-9](.|\n)*exit [0-9]/
Sleep 6s

Hide
Type "kill $(lsof -t -iTCP:7911 -sTCP:LISTEN); sleep 1; tmux kill-server; clear"
Enter
Sleep 2s
