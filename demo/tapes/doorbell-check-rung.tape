# QA tape for the doorbell check, live: a real Claude Code in tmux joins #checkout over a dev channel,
# answers its test ring with doorbell_ok, then a mention rings it and it replies. Scratch home and port 7831.

Output demo/out/doorbell-check-rung.mp4
Output demo/out/doorbell-check-rung.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-doorbell-check-rung"
Env MESSHALL_PORT "7831"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME /tmp/messhall-tape-doorbell-rung.txt; clear"
Enter
Show

Type "pnpm -s messhall-dev channel --room checkout --as web > /tmp/messhall-tape-doorbell-rung.txt; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@240s /exit [0-9]/
Sleep 3s

Hide
Type "clear"
Enter
Show

Type "grep -E 'doorbell|answered its doorbell check|read the doorbell|doorbell_ok' /tmp/messhall-tape-doorbell-rung.txt | cut -c1-160; echo exit $?"
Sleep 500ms
Enter
Sleep 10s
