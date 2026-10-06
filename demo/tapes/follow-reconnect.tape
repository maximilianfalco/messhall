# QA tape for follow reconnect: a follow seat runs, the scratch daemon is killed and started again,
# the seat prints reconnected after N s, then a fifo line still lands in the room. Scratch home and port 7772.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 20

Output demo/out/follow-reconnect.mp4
Output demo/out/follow-reconnect.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-follow"
Env MESSHALL_PORT "7772"

Hide
Type "rm -rf $MESSHALL_HOME /tmp/follow-web.fifo; pnpm -s messhall-dev daemon --keep > /dev/null; clear"
Enter
Sleep 6s
Show

Type "pnpm -s messhall-dev agent web --room demo --follow --post-fifo /tmp/follow-web.fifo & seat=$!"
Sleep 500ms
Enter
Sleep 6s

Type "pnpm -s messhall-dev agent api --room demo --say '@web before the restart' > /dev/null; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@60s /\] @web before the restart/
Sleep 2s

Type "kill $(lsof -t -iTCP:7772 -sTCP:LISTEN); echo daemon killed, exit $?"
Sleep 500ms
Enter
Sleep 4s

Type "pnpm -s messhall-dev daemon --keep | grep health; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@90s /reconnected after/
Sleep 2s

Type "pnpm -s messhall-dev agent api --room demo --say '@web after the restart' > /dev/null; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@60s /\] @web after the restart/
Sleep 2s

Type "echo 'back after the restart' > /tmp/follow-web.fifo; echo exit $?"
Sleep 500ms
Enter
Sleep 2s

Type "pnpm -s messhall-dev room demo | tail -8; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@60s /last [0-9]+ messages/
Sleep 2s

Type "kill $seat; wait $seat; echo exit $?"
Sleep 500ms
Enter
Sleep 12s

Hide
Type "kill $(lsof -t -iTCP:7772 -sTCP:LISTEN); rm -f /tmp/follow-web.fifo"
Enter
Sleep 1s
