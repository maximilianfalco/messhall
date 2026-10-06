# QA tape for reattach after a restart: a real claude -p with a seat key joins, the scratch daemon restarts
# under it, and its next post lands with no join. Scratch home and port 7799.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 20

Output demo/out/reattach-restart.mp4
Output demo/out/reattach-restart.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-reattach-restart"
Env MESSHALL_PORT "7799"

Hide
Type "rm -rf $MESSHALL_HOME; pnpm -s messhall-dev daemon --keep > /dev/null; clear"
Enter
Sleep 6s
Show

Type "demo/tapes/reattach-restart.sh claude; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@180s /exit [0-9]+/
Sleep 3s

Type "pnpm -s messhall-dev room demo | grep -E 'api'; echo room exit $?"
Sleep 500ms
Enter
Wait+Screen@30s /room exit [0-9]/
Sleep 10s

Hide
Type "kill $(lsof -t -iTCP:7799 -sTCP:LISTEN)"
Enter
Sleep 1s
