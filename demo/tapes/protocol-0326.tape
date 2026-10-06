# QA tape for the 2025-03-26 echo: the negotiation tests go green, then a raw initialize on a
# scratch daemon gets 2025-03-26 echoed and 2025-11-25 kept for Claude Code. Port 7776.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 20

Output demo/out/protocol-0326.mp4
Output demo/out/protocol-0326.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-waitpolish"
Env MESSHALL_PORT "7776"

Hide
Type "rm -rf $MESSHALL_HOME; sleep 1; pnpm -s messhall-dev daemon --keep > /dev/null; clear"
Enter
Sleep 7s
Show

Type "pnpm -s test test/mcp/protocol; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@60s /exit [0-9]/
Sleep 3s

Hide
Type "clear"
Enter
Show

Type "bash demo/tapes/protocol-0326-init.sh 2025-03-26 'Roo Code'; echo exit $?"
Sleep 500ms
Enter
Sleep 2s

Type "bash demo/tapes/protocol-0326-init.sh 2025-11-25 claude-code; echo exit $?"
Sleep 500ms
Enter
Sleep 6s

Hide
Type "kill $(lsof -t -iTCP:7776 -sTCP:LISTEN)"
Enter
Sleep 1s
