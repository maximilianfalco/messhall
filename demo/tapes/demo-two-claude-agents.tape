# QA tape for the end-to-end demo: two real Claude Code sessions in two temp repos agree a
# contract change through #demo, fix both tests and close the room. Scratch home and port 7792.

Output demo/out/demo-two-claude-agents.mp4
Output demo/out/demo-two-claude-agents.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-demo"
Env MESSHALL_PORT "7792"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME /tmp/messhall-tape-demo.txt; clear"
Enter
Show

Type "pnpm -s messhall-dev demo --timeout 240 > /tmp/messhall-tape-demo.txt 2>/dev/null; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@330s /exit [0-9]/
Sleep 3s

Hide
Type "clear"
Enter
Show

Type "sed -n '/^step/,/^under the cap/p' /tmp/messhall-tape-demo.txt; echo exit $?"
Sleep 500ms
Enter
Sleep 8s

Hide
Type "clear"
Enter
Show

Type "sed -n '/^#demo/,$p' /tmp/messhall-tape-demo.txt; echo exit $?"
Sleep 500ms
Enter

Sleep 10s
