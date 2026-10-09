# QA tape for the tmux trap: with TMUX set, as inside an agent's pane, tmux ignores TMUX_TMPDIR and talks to the
# server TMUX names. Two scratch servers stand in for the real one, which this tape never touches.

Output demo/out/tmux-died-env-trap.mp4
Output demo/out/tmux-died-env-trap.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-tmux-died-env-trap"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "unset TMUX; A=/tmp/messhall-tape-trap-a; B=/tmp/messhall-tape-trap-b; mkdir -p $A $B; TMUX_TMPDIR=$A tmux -f /dev/null new-session -d -s stands-for-real 'sleep 120'; SOCK=$(TMUX_TMPDIR=$A tmux display-message -p '#{socket_path}'); clear"
Enter
Sleep 2s
Show

Type "TMUX=$SOCK,1,0 TMUX_TMPDIR=$B tmux ls; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Type "env -u TMUX TMUX_TMPDIR=$B tmux ls; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Type "grep -h 'kill-server' docs/briefs/worker.settings.json demo/tapes/README.md | cut -c1-110; echo exit $?"
Sleep 500ms
Enter
Sleep 6s

Hide
Type "TMUX_TMPDIR=$A tmux kill-server; rm -rf $A $B"
Enter
Sleep 1s
