# QA tape for messhall post: a scratch daemon on 7783, one post as ci, the room showing ci left (not gone),
# then the daemon stopped and the same post giving one red line.

Output demo/out/post-oneshot.mp4
Output demo/out/post-oneshot.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-oneshot"
Env MESSHALL_PORT "7783"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME; setopt no_monitor no_notify; pnpm -s messhall-dev daemon --keep > /dev/null; clear"
Enter
Sleep 5s
Show

Type `MESSHALL_PORT=7783 pnpm -s dev post demo --as ci "build is green"; echo exit $?`
Sleep 500ms
Enter
Sleep 4s

Type "pnpm -s messhall-dev room demo; echo exit $?"
Sleep 500ms
Enter
Sleep 4s

Type "kill $(lsof -t -iTCP:7783 -sTCP:LISTEN); sleep 1"
Sleep 500ms
Enter
Sleep 2s

Type `MESSHALL_PORT=7783 pnpm -s dev post demo --as ci "anyone home"; echo exit $?`
Sleep 500ms
Enter
Sleep 4s

Sleep 6s
