# QA tape for the spawner: messhall spawn starts a real claude in tmux, seated with its role from its first call,
# then flock lists it and flock stop removes it. Scratch home and port 7791.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 10

Output demo/out/spawner-seat.mp4
Output demo/out/spawner-seat.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-spawnerseat"
Env MESSHALL_PORT "7791"

Hide
Type "rm -rf $MESSHALL_HOME /tmp/messhall-tape-api; mkdir -p /tmp/messhall-tape-api; pnpm -s messhall-dev daemon --keep > /dev/null; pnpm -s dev room new demo > /dev/null; clear"
Enter
Sleep 8s
Show

Type "pnpm -s dev spawn demo api --role worker --instructions 'post one line saying you read your role' --cwd /tmp/messhall-tape-api --model haiku; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@150s /exit [0-9]/
Sleep 2s

Type "pnpm -s dev flock; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@30s /exit [0-9]\n(.|\n)*exit [0-9]/
Sleep 25s

Type "clear; pnpm -s messhall-dev room demo | head -12; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@30s /exit [0-9]/
Sleep 3s

Type "pnpm -s dev flock stop api; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@30s /stopped api/
Sleep 6s

Hide
Type "tmux kill-session -t =messhall_demo_api:; kill $(lsof -t -iTCP:7791 -sTCP:LISTEN)"
Enter
Sleep 1s
