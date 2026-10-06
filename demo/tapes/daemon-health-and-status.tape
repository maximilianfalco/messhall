# QA tape for the daemon: a scratch daemon on port 7797, /health, a browser Origin refused with 403, status, then stop.
# Runs on the scratch MESSHALL_HOME and port, never the real data dir or 7707.

Output demo/out/daemon-health-and-status.mp4
Output demo/out/daemon-health-and-status.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home"
Env MESSHALL_PORT "7797"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME; clear"
Enter
Show

Type "pnpm -s messhall-dev daemon --keep; echo exit $?"
Sleep 500ms
Enter
Sleep 5s

Type "curl -s http://127.0.0.1:7797/health; echo; echo exit $?"
Sleep 500ms
Enter
Sleep 2s

Type "curl -si -H 'Origin: https://evil.example' http://127.0.0.1:7797/health | head -1"
Sleep 500ms
Enter
Sleep 2s

Hide
Type "clear"
Enter
Show

Type "pnpm -s dev status; echo exit $?"
Sleep 500ms
Enter
Sleep 4s

Type "kill $(lsof -t -iTCP:7797 -sTCP:LISTEN) && sleep 1 && pnpm -s dev status; echo exit $?"
Sleep 500ms
Enter

Sleep 7s
