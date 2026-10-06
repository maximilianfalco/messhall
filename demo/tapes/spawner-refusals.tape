# QA tape for spawner refusals: a cwd that is not a folder, a model that reads as a flag, a taken name,
# and the doctor tmux line. Scratch home and port 7791.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 10

Output demo/out/spawner-refusals.mp4
Output demo/out/spawner-refusals.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-spawnerrefusals"
Env MESSHALL_PORT "7791"

Hide
Type "rm -rf $MESSHALL_HOME; pnpm -s messhall-dev daemon --keep > /dev/null; pnpm -s dev room new demo > /dev/null; pnpm -s messhall-dev agent api --room demo > /dev/null; clear"
Enter
Sleep 10s
Show

Type "pnpm -s dev spawn demo web --role worker --cwd /tmp/no-such-folder; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@30s /exit [0-9]/
Sleep 2s

Type "pnpm -s dev spawn demo web --role worker --cwd /tmp --model=--dangerously-skip-permissions; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@30s /exit [0-9](.|\n)*exit [0-9]/
Sleep 2s

Type "pnpm -s dev spawn demo api --role worker --cwd /tmp; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@30s /exit [0-9](.|\n)*exit [0-9](.|\n)*exit [0-9]/
Sleep 2s

Type "pnpm -s dev mcp doctor | grep tmux; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@60s /tmux:/
Sleep 6s

Hide
Type "kill $(lsof -t -iTCP:7791 -sTCP:LISTEN)"
Enter
Sleep 1s
