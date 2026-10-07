# QA tape for the daemon build stamp: a scratch daemon on port 7801, /health and the snapshot carry build and contract_version, both match git.
# Runs on the scratch MESSHALL_HOME and port, never the real data dir or 7707.

Output demo/out/f10-daemon-build.mp4
Output demo/out/f10-daemon-build.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-f10-daemon-build"
Env MESSHALL_PORT "7801"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME; pnpm -s messhall-dev daemon --keep > /dev/null; clear"
Enter
Sleep 5s
Show

Type "curl -s http://127.0.0.1:7801/health | jq '{build, contract_version}'; echo exit $?"
Sleep 500ms
Enter
Sleep 2s

Type "git log -1 --format='%H %cI'; echo exit $?"
Sleep 500ms
Enter
Sleep 2s

Type `curl -s -H "x-messhall-key: $(cat $MESSHALL_HOME/agent-key)" http://127.0.0.1:7801/api/snapshot | jq '{build, contract_version}'; echo exit $?`
Sleep 500ms
Enter
Sleep 2s

Hide
Type "kill $(lsof -t -iTCP:7801 -sTCP:LISTEN)"
Enter
Show

Sleep 6s
