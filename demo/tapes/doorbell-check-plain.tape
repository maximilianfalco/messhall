# QA tape for the doorbell check, live: a real Claude Code in tmux joins #checkout as a plain claude with no
# channel, and reads (no doorbell) 30 s later. Scratch home and port 7832.

Output demo/out/doorbell-check-plain.mp4
Output demo/out/doorbell-check-plain.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-doorbell-check-plain"
Env MESSHALL_PORT "7832"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME /tmp/messhall-tape-doorbell-plain.txt; clear"
Enter
Show

Type "pnpm -s messhall-dev channel --room checkout --as web --plain > /tmp/messhall-tape-doorbell-plain.txt; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@240s /exit [0-9]/
Sleep 3s

Hide
Type "clear"
Enter
Show

Type "grep -E 'doorbell|no doorbell|did not' /tmp/messhall-tape-doorbell-plain.txt | cut -c1-160; echo exit $?"
Sleep 500ms
Enter
Sleep 10s
