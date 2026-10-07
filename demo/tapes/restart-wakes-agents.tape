# QA tape for the restart wake: three spawned Claude Code seats (haiku) sit idle on a scratch daemon, the daemon
# restarts, and all three come back on their own with no hand nudge.

Output demo/out/restart-wakes-agents.mp4
Output demo/out/restart-wakes-agents.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-restart-wakes-agents"
Env MESSHALL_PORT "7841"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME; mkdir -p $MESSHALL_HOME; for n in a b c; do tmux kill-session -t messhall-seat-wake-$n 2>/dev/null; done"
Enter
Type "printf 'There is nothing to build. End your turn now and stay idle, do not call wait.\nWhen a line tells you messhall restarted, call read_since on the room, then post one line: back after the restart.\n' > $MESSHALL_HOME/idle.md"
Enter
Type "pnpm -s messhall-dev daemon --keep | grep -o 'kill [0-9]*' | cut -d' ' -f2 > $MESSHALL_HOME/pid"
Enter
Sleep 5s
Type "for n in wake-a wake-b wake-c; do pnpm -s messhall-dev spawn agent --as $n --room dev --model haiku > /dev/null; done"
Enter
Sleep 150s
Type `for n in wake-a wake-b wake-c; do pnpm -s messhall-dev agent orchestrator --room dev --assign $n=worker --instructions $MESSHALL_HOME/idle.md --say "@$n your role: worker, call my_role" > /dev/null; done`
Enter
Sleep 30s
Type "until ! tmux capture-pane -p -t messhall-seat-wake-a | grep -q 'esc to interrupt' && ! tmux capture-pane -p -t messhall-seat-wake-b | grep -q 'esc to interrupt' && ! tmux capture-pane -p -t messhall-seat-wake-c | grep -q 'esc to interrupt'; do sleep 2; done; clear"
Enter
Sleep 30s
Show

Type "tmux ls | grep wake; pnpm -s dev export dev | grep -E '^- ' | tail -3; echo exit $?"
Sleep 500ms
Enter
Sleep 6s

Type "kill $(cat $MESSHALL_HOME/pid) && sleep 1 && pnpm -s messhall-dev daemon --keep | tail -1; echo exit $?"
Sleep 500ms
Enter
Sleep 25s

Type "clear; pnpm -s dev export dev | grep -E '^- ' | tail -7; echo exit $?"
Sleep 500ms
Enter
Sleep 5s

Type "grep -h woke $MESSHALL_HOME/logs/*.log | cut -c1-130; echo exit $?"
Sleep 500ms
Enter
Sleep 10s

Hide
Type "for n in a b c; do tmux kill-session -t messhall-seat-wake-$n; done; lsof -t -iTCP:7841 -sTCP:LISTEN | xargs kill"
Enter
Sleep 1s
