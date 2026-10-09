# QA tape for the one step room start: a bad brief is refused before the room is made, and an agent that only
# takes the name orchestrator gets no role and cannot hand one out. Scratch home, port 7912.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Output demo/out/room-orchestrator-refusals.mp4
Output demo/out/room-orchestrator-refusals.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-room-orchestrator-refusals"
Env MESSHALL_PORT "7912"

Hide
Type "kill $(lsof -t -iTCP:7912 -sTCP:LISTEN) 2>/dev/null; sleep 1; rm -rf $MESSHALL_HOME; mkdir -p $MESSHALL_HOME; pnpm -s messhall-dev daemon --keep > /dev/null; clear"
Enter
Sleep 8s
Show

Type "pnpm -s dev room new planning --orchestrator --brief nope.md; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@30s /exit [0-9]/
Sleep 2s

Type "pnpm -s dev room list; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@30s /exit [0-9](.|\n)*exit [0-9]/
Sleep 2s

Type "pnpm -s messhall-dev agent api --room dev --say hi > /dev/null; pnpm -s messhall-dev agent orchestrator --room dev --assign api=reviewer; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@60s /exit [0-9](.|\n)*exit [0-9](.|\n)*exit [0-9]/
Sleep 2s

Type "clear; pnpm -s messhall-dev room dev | cut -c1-110; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Wait+Screen@30s /exit [0-9]/
Sleep 6s

Hide
Type "kill $(lsof -t -iTCP:7912 -sTCP:LISTEN); clear"
Enter
Sleep 2s
