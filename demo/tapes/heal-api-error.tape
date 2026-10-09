# QA tape for an API error: a real claude seat on a scratch daemon gets its pane swapped for a fake one whose last
# turn ends in an API error. The daemon shows the seat stalled, types one carry on line, and clears it once it moves.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 10

Output demo/out/heal-api-error.mp4
Output demo/out/heal-api-error.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-heal-api-error"
Env MESSHALL_PORT "7895"
Env TMUX_TMPDIR "/tmp/messhall-tape-tmux-heal-api-error"

Hide
Type "unset TMUX; rm -rf $MESSHALL_HOME /tmp/messhall-tape-heal-api-error-cwd; mkdir -p $TMUX_TMPDIR /tmp/messhall-tape-heal-api-error-cwd; pnpm -s messhall-dev daemon --keep > /dev/null; pnpm -s dev room new demo > /dev/null"
Enter
Sleep 8s
Type "pnpm -s dev spawn demo api --role worker --cwd /tmp/messhall-tape-heal-api-error-cwd --model haiku --instructions 'post one line saying you read your role, then end your turn' > /dev/null; until ! tmux capture-pane -p -t '=messhall_demo_api:' | grep -q 'esc to interrupt'; do sleep 2; done; sleep 10; clear; echo seated"
Enter
Wait+Screen@300s /^seated/
Type "clear"
Enter
Sleep 1s
Show

Type "tmux respawn-pane -k -t '=messhall_demo_api:' 'bash demo/tapes/heal-api-error-pane.sh'; sleep 1; tmux capture-pane -p -t '=messhall_demo_api:' | grep .; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@30s /exit [0-9]/
Sleep 3s

Type "perl -e 'alarm 50; exec @ARGV' pnpm -s dev watch demo; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@90s /exit [0-9](.|\n)*exit [0-9]/
Sleep 3s

Type "clear; tmux capture-pane -p -t '=messhall_demo_api:' | grep .; grep -h 'API error' $MESSHALL_HOME/logs/*.log | cut -c1-120; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@30s /exit [0-9]/
Sleep 8s

Hide
Type "tmux kill-session -t '=messhall_demo_api:'; kill $(lsof -t -iTCP:7895 -sTCP:LISTEN)"
Enter
Sleep 1s
