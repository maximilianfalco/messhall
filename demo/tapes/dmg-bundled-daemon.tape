# QA tape for the dmg: mounts the built dmg, lists it, runs the daemon from the node and CLI inside the app,
# and asks it for health on a scratch port. Needs app/build/Messhall.dmg from make dmg.

Output demo/out/dmg-bundled-daemon.mp4
Output demo/out/dmg-bundled-daemon.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-dmg"
Env MESSHALL_PORT "7840"
Env MESSHALL_SUMMARIES "off"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME; hdiutil detach -quiet /tmp/dmg-tape 2>/dev/null; clear"
Enter
Show

Type "hdiutil attach -quiet -nobrowse -mountpoint /tmp/dmg-tape app/build/Messhall.dmg; ls /tmp/dmg-tape; echo exit $?"
Enter
Sleep 2s

Type "R=/tmp/dmg-tape/Messhall.app/Contents/Resources/runtime; ls $R $R/cli; echo exit $?"
Enter
Sleep 2s

Type "$R/node --disable-warning=ExperimentalWarning $R/cli/dist/src/cli.js daemon > /dev/null 2>&1 &"
Enter
Sleep 3s

Type "curl -s 127.0.0.1:$MESSHALL_PORT/health; echo; echo exit $?"
Enter
Sleep 2s

Type "kill %1; hdiutil detach -quiet /tmp/dmg-tape; echo exit $?"
Enter
Sleep 3s
