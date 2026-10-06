# QA tape for the protocol versions: the negotiation tests go green, then a real Claude Code
# still lands on 2025-11-25 with its channel and answers the bell. Scratch home and port 7782.

Output demo/out/protocol-versions.mp4
Output demo/out/protocol-versions.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-protocol"
Env MESSHALL_PORT "7782"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME /tmp/messhall-tape-protocol.txt; mkdir -p $MESSHALL_HOME; clear"
Enter
Show

Type "pnpm -s test test/mcp/protocol; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@60s /exit [0-9]/
Sleep 5s

Hide
Type "clear"
Enter
Show

Type "pnpm -s messhall-dev channel --room checkout --as web > /tmp/messhall-tape-protocol.txt; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@240s /exit [0-9]/
Sleep 2s

Hide
Type "clear"
Enter
Show

Type "grep -oE 'negotiatedProtocolVersion[^,]*|Channel notifications registered' $MESSHALL_HOME/channel-debug.log | sort -u; tail -8 /tmp/messhall-tape-protocol.txt; echo exit $?"
Sleep 500ms
Enter

Sleep 10s
