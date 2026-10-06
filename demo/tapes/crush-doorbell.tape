# QA tape for the crush doorbell: the final lines of a live run. crush joined #checkout as crushy
# through mcp-remote with channel_enabled, api mentioned it, the channel rang and crush read and replied.

Output demo/out/crush-doorbell.mp4
Output demo/out/crush-doorbell.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-crush"
Env MESSHALL_PORT "7775"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "clear"
Enter
Show

Type "grep -h 'doorbell rang' $MESSHALL_HOME/logs/daemon.log | tail -1 | cut -c1-150; echo exit $?"
Sleep 500ms
Enter
Sleep 4s

Type "cat $MESSHALL_HOME/crush-pane.txt; echo exit $?"
Sleep 500ms
Enter
Sleep 6s

Hide
Type "clear"
Enter
Show

Type "pnpm -s messhall-dev room checkout | sed -n '/^member/,$p'; echo exit $?"
Sleep 500ms
Enter

Sleep 9s
