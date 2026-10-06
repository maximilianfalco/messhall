# QA tape for the mute MCP tool: it is listed with its budget, a plain agent and a mute on the human seat are refused,
# then the tool tests run (an orchestrator mutes, the muted post is refused, unmute lets it post again).

Output demo/out/mute-orchestrator.mp4
Output demo/out/mute-orchestrator.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-mute-orchestrator"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME; clear"
Enter
Show

Type "pnpm -s messhall-dev mcp | grep -A1 '^mute'; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 6s

Type `pnpm -s messhall-dev mcp --tool mute --as api --room demo --input '{"room":"demo","member":"web"}'; echo exit $?`
Sleep 500ms
Enter
Sleep 6s

Type `pnpm -s messhall-dev mcp --tool mute --as orchestrator --room demo --input '{"room":"demo","member":"human"}'; echo exit $?`
Sleep 500ms
Enter
Sleep 6s

Hide
Type "clear"
Enter
Show

Type "pnpm -s vitest run test/mcp/mute.test.ts --reporter verbose 2>&1 | grep -E '✓|×|Tests'; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 10s

Sleep 7s
