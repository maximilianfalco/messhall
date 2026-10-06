# QA tape for messhall-dev nudge: a real Claude Code (haiku) in a scratch tmux session, a nudge that gets sent
# and answered, then the pane shows the input box empty.

Output demo/out/nudge-submit.mp4
Output demo/out/nudge-submit.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-nudge-submit"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME; mkdir -p $MESSHALL_HOME/cwd; tmux kill-session -t messhall-seat-tape 2>/dev/null"
Enter
Type "tmux new-session -d -s messhall-seat-tape -x 110 -y 30 -c $MESSHALL_HOME/cwd 'claude --model haiku'"
Enter
Sleep 5s
Type "tmux send-keys -t messhall-seat-tape Down Enter; clear"
Enter
Sleep 8s
Show

Type "pnpm -s messhall-dev nudge messhall-seat-tape 'reply with just the word ok'; echo exit $?"
Sleep 500ms
Enter
Sleep 10s

Type "tmux capture-pane -p -t messhall-seat-tape | grep -v '^ *$' | tail -8"
Sleep 500ms
Enter
Sleep 8s

Hide
Type "tmux kill-session -t messhall-seat-tape"
Enter
Sleep 1s
