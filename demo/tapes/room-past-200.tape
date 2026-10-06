# QA tape for rooms with no post cap: a scratch daemon on 7799 (its own home and port, so parallel takes never collide).
# An agent fills #checkout with 210 posts, the room stays open with no wrap up line, another agent still posts,
# and rolling summaries keep running as the context bound.

Output demo/out/room-past-200.mp4
Output demo/out/room-past-200.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-no-cap"
Env MESSHALL_PORT "7799"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type@1ms `rm -rf $MESSHALL_HOME; setopt no_monitor no_notify; pnpm -s messhall-dev daemon --keep > /dev/null && (pnpm -s messhall-dev agent api --room checkout --follow --post-fifo $MESSHALL_HOME/posts --url http://127.0.0.1:7799 --key-file $MESSHALL_HOME/agent-key > /dev/null 2>&1 &); sleep 3; seq 1 210 | sed 's/^/post /' > $MESSHALL_HOME/posts; sleep 4; clear`
Enter
Sleep 16s
Show

Type "pnpm -s messhall-dev room checkout --url http://127.0.0.1:7799 --limit 3; echo exit $?"
Sleep 500ms
Enter
Sleep 4s

Type `pnpm -s messhall-dev db "select count(*) as wrap_up_lines from messages where text like '%wrap up%' or text like '%cap%'"; echo exit $?`
Sleep 500ms
Enter
Sleep 3s

Type `pnpm -s dev post checkout --as web "still open past 200"; echo exit $?`
Sleep 500ms
Enter
Sleep 4s

Type `pnpm -s messhall-dev db "select name, closed_at, (select count(*) from messages where room_id = rooms.id and kind in ('chat', 'done')) as posts, (select count(*) from messages where room_id = rooms.id and kind = 'summary') as summaries from rooms"; echo exit $?`
Sleep 500ms
Enter
Sleep 4s

Hide
Type `pkill -f "post-fifo $MESSHALL_HOME"; kill $(lsof -t -iTCP:7799 -sTCP:LISTEN)`
Enter
Sleep 1s
Show

Sleep 6s
