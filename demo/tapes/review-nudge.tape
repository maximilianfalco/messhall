# QA tape for review nudges: a scratch daemon on 7823 (its own home and port, so parallel takes never collide).
# f8-thing asks reviewer-1, who sleeps. The request is backdated in the scratch db (no tape waits 15 real minutes):
# at 10 min the daemon rings reviewer-1 again, at 15 it posts one line that wakes reviewer-2. Then the room turns it off.

Output demo/out/review-nudge.mp4
Output demo/out/review-nudge.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-review-nudge"
Env MESSHALL_PORT "7823"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type@1ms `rm -rf $MESSHALL_HOME; setopt no_monitor no_notify pipefail; U="--url http://127.0.0.1:7823 --key-file $MESSHALL_HOME/agent-key --room dev"; pnpm -s messhall-dev daemon --keep > /dev/null 2>&1 && for r in reviewer-1 reviewer-2; do eval pnpm -s messhall-dev agent $r $U --follow > $MESSHALL_HOME/$r.out 2>&1 & sleep 4; pnpm -s dev role dev $r reviewer > /dev/null; done; eval pnpm -s messhall-dev agent f8-thing $U --say "'ready for review: https://github.com/acme/widgets/pull/12 @reviewer-1'" > /dev/null; DB=$MESSHALL_HOME/messhall.db; ago() { sqlite3 $DB "update messages set created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-$1 minutes') where text like 'ready for review:%'"; }; clear`
Enter
Sleep 32s
Show

Type `pnpm -s messhall-dev room dev --url http://127.0.0.1:7823 --limit 2 | tail -3; echo exit $?`
Sleep 500ms
Enter
Sleep 5s

Type `ago 11; sleep 16; grep -o 'messhall: f8-thing has waited[^"]*' $MESSHALL_HOME/logs/daemon.log; echo exit $?`
Sleep 500ms
Enter
Sleep 20s

Type `ago 16; sleep 16; grep 'waited 15 min' $MESSHALL_HOME/reviewer-2.out; echo exit $?`
Sleep 500ms
Enter
Sleep 20s

Type `sleep 16; pnpm -s messhall-dev db "select count(*) as handoff_lines from messages where text like '%waited 15 min%'"; echo exit $?`
Sleep 500ms
Enter
Sleep 20s

Type `pnpm -s dev room nudges dev off; echo exit $?`
Sleep 500ms
Enter
Sleep 4s

Hide
Type `kill %1 %2; kill $(lsof -t -iTCP:7823 -sTCP:LISTEN); clear`
Enter
Sleep 1s
Show

Sleep 6s
