# QA tape for the per client wait default: oh-my-pi (omp) waits 25 s with no timeout_s,
# Cline asking for 200 s is held to 50 s. Scratch home and port 7778.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 20

Output demo/out/wait-default-short-clients.mp4
Output demo/out/wait-default-short-clients.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-waitpolish"
Env MESSHALL_PORT "7778"

Hide
Type "rm -rf $MESSHALL_HOME; pnpm -s messhall-dev daemon --keep > /dev/null; clear"
Enter
Sleep 6s
Show

Type "pnpm -s messhall-dev agent pi --room demo --wait --client omp; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@60s /exit [0-9]/
Sleep 2s

Type "pnpm -s messhall-dev agent cline --room demo --wait --timeout 200 --client Cline; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@90s /cline wait, blocked/
Sleep 2s
Sleep 6s

Hide
Type "kill $(lsof -t -iTCP:7778 -sTCP:LISTEN)"
Enter
