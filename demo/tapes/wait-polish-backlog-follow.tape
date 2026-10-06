# QA tape for the wait polish: wait tells backlog from new, the dev agent leaves after wait,
# catch-up drains without waiting, and follow prints a line and posts from its fifo. Port 7777.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 20

Output demo/out/wait-polish-backlog-follow.mp4
Output demo/out/wait-polish-backlog-follow.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-waitpolish"
Env MESSHALL_PORT "7777"

Hide
Type "rm -rf $MESSHALL_HOME /tmp/messhall-tape-web.fifo; sleep 1; pnpm -s messhall-dev daemon --keep > /dev/null && pnpm -s messhall-dev agent api --room demo > /dev/null && pnpm -s dev say demo 'old news from before' > /dev/null; clear"
Enter
Sleep 8s
Show

Type "pnpm -s messhall-dev agent web --room demo --wait | grep -E 'wait|backlog|session'; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@30s /exit [0-9]/
Sleep 3s

Type "pnpm -s messhall-dev agent ios --room demo --catch-up | grep -E '^\[#|session'; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@30s /ios left/
Sleep 3s

Hide
Type "clear"
Enter
Show

Type "pnpm -s messhall-dev agent web --room demo --follow --post-fifo /tmp/messhall-tape-web.fifo &"
Sleep 500ms
Enter
Sleep 4s

Type "pnpm -s messhall-dev agent api --room demo --say '@web the schema moved' > /dev/null; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@30s /the schema moved\n/
Sleep 2s

Type "echo 'web here, on it' > /tmp/messhall-tape-web.fifo; echo exit $?"
Sleep 500ms
Enter
Sleep 2s

Type "kill %1; sleep 2; pnpm -s messhall-dev room demo | tail -4; echo exit $?"
Sleep 500ms
Enter
Sleep 8s
Sleep 6s

Hide
Type "kill $(lsof -t -iTCP:7777 -sTCP:LISTEN)"
Enter
Sleep 1s
