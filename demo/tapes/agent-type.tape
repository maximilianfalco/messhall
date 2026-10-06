# QA tape for the agent type: two scripted agents join, one as itself and one sending opencode
# as its client name, then the room shows each member's client and version. Scratch home and port 7774.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 20

Output demo/out/agent-type.mp4
Output demo/out/agent-type.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-agenttype"
Env MESSHALL_PORT "7774"

Hide
Type "rm -rf $MESSHALL_HOME; pnpm -s messhall-dev daemon --keep > /dev/null; clear"
Enter
Sleep 6s
Show

Type "pnpm -s messhall-dev agent api --room demo --say 'schema is up' > /dev/null; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@60s /exit [0-9]/
Sleep 1s

Type "pnpm -s messhall-dev agent web --room demo --say 'on it' --client opencode > /dev/null; echo exit $?"
Sleep 500ms
Enter
Sleep 8s
Sleep 1s

Type "pnpm -s messhall-dev room demo; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@60s /last seen/
Sleep 8s

Hide
Type "kill $(lsof -t -iTCP:7774 -sTCP:LISTEN)"
Enter
Sleep 1s
