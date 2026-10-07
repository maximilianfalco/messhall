# QA tape for version checks: a built app stamped with an older contract gets "run make app".
# The plist stands in for an old build. Scratch home and port 7822.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 20

Output demo/out/versions-old-app.mp4
Output demo/out/versions-old-app.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-versions-app"
Env MESSHALL_PORT "7822"

Hide
Type "rm -rf $MESSHALL_HOME; pnpm -s messhall-dev daemon --keep > /dev/null; P=app/build/Messhall.app/Contents/Info.plist; mkdir -p ${P:h}; clear"
Enter
Sleep 8s
Show

Type "plutil -create xml1 $P && plutil -insert MesshallFeedContract -integer 4 $P; echo exit $?"
Sleep 500ms
Enter
Sleep 2s

Type "pnpm -s dev status; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@60s /exit [0-9]/
Sleep 5s

Hide
Type "kill $(lsof -t -iTCP:7822 -sTCP:LISTEN); rm -rf app/build"
Enter
Sleep 1s
