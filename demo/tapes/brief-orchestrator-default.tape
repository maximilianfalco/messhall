# QA tape for the orchestrator seat: the orchestrator name reads the shipped orchestrator brief

Output demo/out/brief-orchestrator-default.mp4
Output demo/out/brief-orchestrator-default.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-brief"
Env MESSHALL_PORT "7797"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME && mkdir -p $MESSHALL_HOME/shop && printf 'lead the room\\n' > $MESSHALL_HOME/lead.md && clear"
Enter
Show

Type "pnpm -s dev claude --print --room dev --as orchestrator --cwd $MESSHALL_HOME/shop; echo exit $?"
Sleep 500ms
Enter
Sleep 6s
