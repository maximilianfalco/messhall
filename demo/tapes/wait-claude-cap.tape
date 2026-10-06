# QA tape for the Claude Code wait cap: a scripted agent sends claude-code as its client name,
# asks wait for 250 s and is cut at 110 s, under the 120 s background cut. Scratch home and port 7790.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 10

Output demo/out/wait-claude-cap.mp4
Output demo/out/wait-claude-cap.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-waitclaudecap"
Env MESSHALL_PORT "7790"

Hide
Type "rm -rf $MESSHALL_HOME; pnpm -s messhall-dev daemon --keep > /dev/null; clear"
Enter
Sleep 6s
Show

Type "pnpm -s messhall-dev agent api --room demo --client claude-code --wait --timeout 250; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@180s /exit [0-9]/
Sleep 6s

Hide
Type "kill $(lsof -t -iTCP:7790 -sTCP:LISTEN)"
Enter
Sleep 1s
