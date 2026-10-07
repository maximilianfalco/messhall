# QA tape for version checks: a daemon from before build stamps gets "run messhall start",
# then this branch's daemon is quiet. Scratch home and port 7821. OLD_DAEMON is a checkout of main before the stamps.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 20

Output demo/out/versions-old-daemon.mp4
Output demo/out/versions-old-daemon.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-versions"
Env MESSHALL_PORT "7821"

Hide
Type "rm -rf $MESSHALL_HOME; (pnpm -s --dir $OLD_DAEMON dev daemon > /dev/null 2>&1 &); sleep 5; clear"
Enter
Sleep 7s
Show

Type "pnpm -s dev status; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@60s /exit [0-9]/
Sleep 4s

Hide
Type "kill $(lsof -t -iTCP:7821 -sTCP:LISTEN); sleep 1; pnpm -s messhall-dev daemon --keep > /dev/null; clear"
Enter
Sleep 8s
Show

Type "pnpm -s dev status; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@60s /exit [0-9]/
Sleep 5s

Hide
Type "kill $(lsof -t -iTCP:7821 -sTCP:LISTEN)"
Enter
Sleep 1s
