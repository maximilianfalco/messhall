# QA tape for the spawn tool: an orchestrator calls spawn over real HTTP on a scratch daemon, a real claude
# takes its seat with its role, the room shows one started line, and flock lists it. Scratch home and port 7872.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 10

Output demo/out/spawn-tool-seat.mp4
Output demo/out/spawn-tool-seat.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-spawntoolseat"
Env MESSHALL_PORT "7872"

Hide
Type "rm -rf $MESSHALL_HOME /tmp/messhall-tape-spawntool-api; mkdir -p /tmp/messhall-tape-spawntool-api; pnpm -s messhall-dev daemon --keep > /dev/null; pnpm -s dev room new demo > /dev/null; clear"
Enter
Sleep 8s
Show

Type `pnpm -s tsx demo/tapes/spawn-tool-orchestrator.ts '{"room":"demo","name":"api","role":"worker","cwd":"/tmp/messhall-tape-spawntool-api","model":"haiku","instructions":"post one line saying you read your role"}'; echo exit $?`
Sleep 500ms
Enter
Wait+Screen@150s /exit [0-9]/
Sleep 25s

Type "pnpm -s messhall-dev room demo | tail -9; echo exit $?"
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
Type "tmux kill-session -t '=messhall_demo_api:'; kill $(lsof -t -iTCP:7872 -sTCP:LISTEN)"
Enter
Sleep 1s
