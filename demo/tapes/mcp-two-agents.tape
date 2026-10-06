# QA tape for the MCP tools: a scratch daemon on port 7797, web blocks in wait, api mentions it,
# web's wait returns and read_since shows the post. Scratch MESSHALL_HOME and port only.

Output demo/out/mcp-two-agents.mp4
Output demo/out/mcp-two-agents.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-mcp"
Env MESSHALL_PORT "7797"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME /tmp/messhall-tape-web.txt; clear"
Enter
Show

Type "pnpm -s messhall-dev daemon --keep; echo exit $?"
Sleep 500ms
Enter
Sleep 5s

Hide
Type "clear"
Enter
Show

Type "pnpm -s messhall-dev agent web --room checkout --wait > /tmp/messhall-tape-web.txt &"
Sleep 500ms
Enter
Sleep 4s

Type "pnpm -s messhall-dev agent api --room checkout --say '@web total is cents now'; echo exit $?"
Sleep 500ms
Enter
Sleep 7s

Hide
Type "wait; clear"
Enter
Show

Type "sed -n '/wait, blocked/,/authority/p' /tmp/messhall-tape-web.txt; echo exit $?"
Sleep 500ms
Enter
Sleep 8s

Hide
Type "clear"
Enter
Show

Type "kill $(lsof -t -iTCP:7797 -sTCP:LISTEN) && echo daemon stopped; echo exit $?"
Sleep 500ms
Enter

Sleep 4s
