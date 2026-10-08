# QA tape for healing: two real claude seats on a scratch daemon and a tmux server of their own, the server is
# killed, and the daemon starts both again on their seats with their roles. Scratch home, port 7891, own tmux socket.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 10

Output demo/out/heal-kill-tmux-server.mp4
Output demo/out/heal-kill-tmux-server.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-heal"
Env MESSHALL_PORT "7891"
Env TMUX_TMPDIR "/tmp/messhall-tape-tmux-heal"

Hide
Type "unset TMUX; rm -rf $MESSHALL_HOME /tmp/messhall-tape-heal-api /tmp/messhall-tape-heal-web; mkdir -p $TMUX_TMPDIR /tmp/messhall-tape-heal-api /tmp/messhall-tape-heal-web; pnpm -s messhall-dev daemon --keep > /dev/null; pnpm -s dev room new demo > /dev/null"
Enter
Sleep 8s
Type "pnpm -s dev spawn demo api --role worker --cwd /tmp/messhall-tape-heal-api --model haiku --instructions 'post one line saying you read your role, then end your turn' > /dev/null; pnpm -s dev spawn demo web --role reviewer --cwd /tmp/messhall-tape-heal-web --model haiku --instructions 'post one line saying you read your role, then end your turn' > /dev/null; clear; echo seated"
Enter
Wait+Screen@300s /^seated/
Sleep 20s
Type "clear"
Enter
Sleep 1s
Show

Type "pnpm -s dev flock; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@30s /exit [0-9]/
Sleep 3s

Type "tmux kill-server; tmux ls; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@30s /exit [0-9](.|\n)*exit [0-9]/
Sleep 3s

Type "pnpm -s dev flock; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@30s /exit [0-9](.|\n)*exit [0-9](.|\n)*exit [0-9]/
Sleep 3s

Type "clear; until [ $(pnpm -s dev flock | grep -c running) = 2 ]; do sleep 5; done; pnpm -s dev flock; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@400s /exit [0-9]/
Sleep 40s

Type "pnpm -s messhall-dev room demo | tail -14; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@30s /exit [0-9](.|\n)*exit [0-9]/
Sleep 8s

Hide
Type "kill $(lsof -t -iTCP:7891 -sTCP:LISTEN); sleep 1; tmux kill-server"
Enter
Sleep 1s
