# QA tape for the restart wake of an away seat: one spawned Claude Code seat (haiku) sits idle on a scratch daemon,
# is marked away while the daemon is down, and the next restart still wakes it because its pane is open.

Output demo/out/restart-wakes-away-seat.mp4
Output demo/out/restart-wakes-away-seat.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-restart-wakes-away-seat"
Env MESSHALL_PORT "7871"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME; mkdir -p $MESSHALL_HOME; tmux kill-session -t messhall-seat-wake-a 2>/dev/null"
Enter
Type "printf 'There is nothing to build. End your turn now and stay idle, do not call wait.\nWhen a line tells you messhall restarted, call read_since on the room, then post one line: back after the restart.\n' > $MESSHALL_HOME/idle.md"
Enter
Type "pnpm -s messhall-dev daemon --keep | grep -o 'kill [0-9]*' | cut -d' ' -f2 > $MESSHALL_HOME/pid"
Enter
Sleep 5s
Type "pnpm -s messhall-dev spawn agent --as wake-a --room dev --model haiku > /dev/null"
Enter
Sleep 90s
Type `pnpm -s messhall-dev agent orchestrator --room dev --assign wake-a=worker --instructions $MESSHALL_HOME/idle.md --say "@wake-a your role: worker, call my_role" > /dev/null`
Enter
Sleep 30s
Type "until ! tmux capture-pane -p -t messhall-seat-wake-a | grep -q 'esc to interrupt'; do sleep 2; done; clear"
Enter
Sleep 30s
Show

Type "tmux ls | grep wake; pnpm -s dev export dev | grep -E '^- ' | tail -3; echo exit $?"
Sleep 500ms
Enter
Sleep 6s

Type "kill $(cat $MESSHALL_HOME/pid) && sleep 1 && sqlite3 $MESSHALL_HOME/messhall.db \"update members set presence = 'away' where name = 'wake-a'; select name, presence from members where name = 'wake-a'\"; echo exit $?"
Sleep 500ms
Enter
Sleep 4s

Type "pnpm -s messhall-dev daemon --keep | tail -1; echo exit $?"
Sleep 500ms
Enter
Sleep 25s

Type "clear; pnpm -s dev export dev | grep -E '^- ' | tail -4; echo exit $?"
Sleep 500ms
Enter
Sleep 5s

Type "grep -h woke $MESSHALL_HOME/logs/*.log | cut -c1-130; echo exit $?"
Sleep 500ms
Enter
Sleep 10s

Hide
Type "tmux kill-session -t messhall-seat-wake-a; lsof -t -iTCP:7871 -sTCP:LISTEN | xargs kill"
Enter
Sleep 1s
