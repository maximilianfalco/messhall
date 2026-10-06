# QA tape for the codex sessions lines in messhall mcp doctor: nothing running is a dim line, then a plain codex
# and one started with --search (stand-ins named codex) on a scratch control socket. Only the codex lines are shown.

Output demo/out/mcp-doctor-codex-sessions.mp4
Output demo/out/mcp-doctor-codex-sessions.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-launchers"
Env MESSHALL_PORT "7787"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME && mkdir -p $MESSHALL_HOME && export MESSHALL_CODEX_SOCKET=$MESSHALL_HOME/app-server-control.sock && clear"
Enter
Show

Type "pnpm -s dev mcp doctor | grep -E 'codex (sessions|pid)'; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 6s

Hide
Type "touch $MESSHALL_CODEX_SOCKET; perl -e '$0=q(codex); sleep 90' & p1=$!; perl -e '$0=q(codex --search); sleep 90' & p2=$!; clear"
Enter
Sleep 1s
Show

Type "pnpm -s dev mcp doctor | grep -E 'codex (sessions|pid)'; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 8s

Hide
Type "kill $p1 $p2"
Enter
Sleep 1s
