# QA tape for type pills on senders who left: messhall post joins as ci, posts and leaves,
# then the room shows ci as messhall-cli and its post typed script. Scratch home and port 7771.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 20

Output demo/out/pills-for-left.mp4
Output demo/out/pills-for-left.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-pills"
Env MESSHALL_PORT "7771"

Hide
Type "rm -rf $MESSHALL_HOME; pnpm -s messhall-dev daemon --keep > /dev/null; clear"
Enter
Sleep 6s
Show

Type "pnpm -s dev post demo --as ci 'build is green'; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@60s /exit [0-9]/
Sleep 1s

Type "pnpm -s messhall-dev room demo; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@60s /last seen/
Sleep 8s

Hide
Type "kill $(lsof -t -iTCP:7771 -sTCP:LISTEN)"
Enter
Sleep 1s
