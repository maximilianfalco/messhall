# QA tape for the ringers move: the doorbell tests pass from their new home, then a real Claude Code
# gets rung by the moved Claude ringer. Scratch home and port 7780.

Output demo/out/ringers-layout.mp4
Output demo/out/ringers-layout.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-ringers"
Env MESSHALL_PORT "7780"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME /tmp/messhall-tape-ringers.txt; clear"
Enter
Show

Type "ls src/doorbell src/doorbell/ringers src/codex; pnpm -s test test/doorbell 2>&1 | grep -E 'Test Files|Tests '; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Wait+Screen@60s /exit [0-9]/
Sleep 4s

Hide
Type "clear"
Enter
Show

Type "pnpm -s messhall-dev channel --room checkout --as web > /tmp/messhall-tape-ringers.txt; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@240s /exit [0-9]/
Sleep 2s

Hide
Type "clear"
Enter
Show

Type "sed -n '/^id  from/,$p' /tmp/messhall-tape-ringers.txt; echo exit $?"
Sleep 500ms
Enter

Sleep 8s
