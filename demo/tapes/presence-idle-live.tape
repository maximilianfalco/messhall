# QA tape for idle presence, live: a real Claude seat with the channel doorbell ends its turn and
# sits quiet past the 30 minute away line, still reads idle, and a mention rings it. Port 7808.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 20

Output demo/out/presence-idle-live.mp4
Output demo/out/presence-idle-live.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-presence-idle-live"
Env MESSHALL_PORT "7808"

Hide
Type "rm -rf $MESSHALL_HOME; clear"
Enter
Show

Type "pnpm -s messhall-dev channel --room demo --as quiet-claude --quiet 1880 > /tmp/presence-idle-live.log 2>&1; echo exit $? >> /tmp/presence-idle-live.log; echo finished"
Sleep 500ms
Enter
Hide
Wait+Screen@45m /^finished/
Type "clear; grep -E 'quiet|is (idle|away)|mention|repl|exit' /tmp/presence-idle-live.log | head -20"
Enter
Sleep 2s
Show
Sleep 8s
