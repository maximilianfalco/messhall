# QA tape for the MCP server: the server block and the seven tools over an in-memory client, then a post
# before join refused with isError. Scratch MESSHALL_HOME only, no daemon.

Output demo/out/mcp-tools-list.mp4
Output demo/out/mcp-tools-list.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-mcp"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "clear"
Enter
Show

Type "pnpm -s messhall-dev mcp | sed -n '/^server/,/^capabilities/p'; echo exit $?"
Sleep 500ms
Enter
Sleep 5s

Hide
Type "clear"
Enter
Show

Type "pnpm -s messhall-dev mcp | sed -n '/^join/,$p'; echo exit $?"
Sleep 500ms
Enter
Sleep 7s

Hide
Type "clear"
Enter
Show

Type `pnpm -s messhall-dev mcp --tool post --input '{"room":"demo","text":"hi"}'; echo exit $?`
Sleep 500ms
Enter

Sleep 5s
