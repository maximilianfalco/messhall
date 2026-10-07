# QA tape for no stranded seats: a real idle Claude Code, the scratch daemon restarts under it, a mention lands.
# Claude gives up its event stream and is not rung, the daemon holds the ring. Scratch home and port 7811.

Output demo/out/stranded-restart-live.mp4
Output demo/out/stranded-restart-live.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-stranded-live"
Env MESSHALL_PORT "7811"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME /tmp/messhall-tape-stranded.txt; mkdir -p $MESSHALL_HOME; clear"
Enter
Show

Type "pnpm -s messhall-dev channel --room checkout --as web --restart > /tmp/messhall-tape-stranded.txt; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@300s /exit [0-9]/
Sleep 3s

Hide
Type "clear"
Enter
Show

Type "grep -E 'restart|after the restart|post to reply|did not' /tmp/messhall-tape-stranded.txt; echo exit $?"
Sleep 500ms
Enter
Sleep 5s

Type "grep -oE 'Failed to open SSE stream: Not Found|SSE GET-stream reconnection exhausted.*' $MESSHALL_HOME/channel-debug.log | sort | uniq -c; echo exit $?"
Sleep 500ms
Enter
Sleep 5s

Type `grep -oE 'doorbell (rang|held, no session)","kind":"claude","name":"web"' $MESSHALL_HOME/logs/daemon.log; echo exit $?`
Sleep 500ms
Enter
Sleep 10s
