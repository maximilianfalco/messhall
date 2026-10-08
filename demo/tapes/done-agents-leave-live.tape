# QA tape for a seat that leaves stopping its session: a scratch daemon on 7802 with its own home, a stand-in
# messhall_demo_api tmux session, api says done and leaves and its session is gone, web leaves and keep stays.

Output demo/out/done-agents-leave-live.mp4
Output demo/out/done-agents-leave-live.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-done-agents-leave-live"
Env MESSHALL_PORT "7802"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME; setopt no_monitor no_notify; tmux kill-session -t '=messhall_demo_api:' 2>/dev/null; tmux kill-session -t '=messhall_demo_keep:' 2>/dev/null; clear"
Enter
Show

Type "pnpm -s messhall-dev daemon --keep | tail -1; echo exit $?"
Sleep 500ms
Enter
Sleep 5s

Type "tmux new-session -d -s messhall_demo_api 'sleep 600'; tmux new-session -d -s messhall_demo_keep 'sleep 600'; tmux ls | grep messhall_demo; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Type `pnpm -s messhall-dev agent api --room demo --say "done: shipped, leaving" | tail -1; echo exit $pipestatus[1]`
Sleep 500ms
Enter
Sleep 7s

Type "tmux ls | grep messhall_demo; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Type `pnpm -s messhall-dev agent web --room demo --say "web here, heading out" | tail -1; echo exit $pipestatus[1]`
Sleep 500ms
Enter
Sleep 7s

Type "tmux ls | grep messhall_demo; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Type "pnpm -s messhall-dev room demo --url http://127.0.0.1:7802 | tail -8; echo exit $?"
Sleep 500ms
Enter
Sleep 8s

Hide
Type "tmux kill-session -t '=messhall_demo_keep:' 2>/dev/null; kill $(lsof -t -iTCP:7802 -sTCP:LISTEN)"
Enter
Sleep 1s
Sleep 2s
