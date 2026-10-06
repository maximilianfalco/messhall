# QA tape for the Claude doorbell: a real Claude Code in tmux joins #checkout over a dev channel,
# a scripted api mentions it, the bell rings and it reads and replies. Scratch home and port 7794.

Output demo/out/channel-doorbell.mp4
Output demo/out/channel-doorbell.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-channels"
Env MESSHALL_PORT "7794"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME /tmp/messhall-tape-channel.txt; clear"
Enter
Show

Type "pnpm -s messhall-dev channel --room checkout --as web > /tmp/messhall-tape-channel.txt; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@240s /exit [0-9]/
Sleep 3s

Hide
Type "clear"
Enter
Show

Type "grep -E 'MCP server|: [0-9]+ new in|post to reply|replied|did not' /tmp/messhall-tape-channel.txt; echo exit $?"
Sleep 500ms
Enter
Sleep 8s

Hide
Type "clear"
Enter
Show

Type "sed -n '/^#checkout/,/^last /p' /tmp/messhall-tape-channel.txt; echo exit $?"
Sleep 500ms
Enter

Sleep 8s
