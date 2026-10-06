# QA tape for the loop guard: a scratch daemon on 7796 (its own home and port, so parallel takes never collide).
# api and web trade 12 lines alone, the daemon pauses them and pings the human. A partner line no longer wakes
# web's wait, a human line does, and the human line lifts the pause.

Output demo/out/loop-guard.mp4
Output demo/out/loop-guard.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-loop-guard"
Env MESSHALL_PORT "7796"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type@1ms `rm -rf $MESSHALL_HOME; setopt no_monitor no_notify pipefail; pnpm -s messhall-dev daemon --keep > /dev/null 2>&1 && for i in 1 2 3 4 5 6; do pnpm -s dev post checkout --as api "@web schema tweak $i" > /dev/null; pnpm -s dev post checkout --as web "@api looks good $i" > /dev/null; done; W="pnpm -s messhall-dev agent web --room checkout --wait --url http://127.0.0.1:7796 --key-file $MESSHALL_HOME/agent-key"; clear`
Enter
Sleep 25s
Show

Type "pnpm -s messhall-dev room checkout --url http://127.0.0.1:7796 --limit 3 | tail -6; echo exit $?"
Sleep 500ms
Enter
Sleep 5s

Type `(sleep 2; pnpm -s dev post checkout --as api "@web one more idea" > /dev/null) & eval $W --timeout 8 | grep -E "blocked|nothing yet|new since|one more"; echo exit $?`
Sleep 500ms
Enter
Sleep 13s

Type `(sleep 2; pnpm -s dev say checkout "@web @api stop here and sum up" > /dev/null) & eval $W --timeout 20 | grep -E "blocked|nothing yet|new since|sum up"; echo exit $?`
Sleep 500ms
Enter
Sleep 8s

Type `pnpm -s messhall-dev db "select name, paused_with from members where kind != 'human'"; echo exit $?`
Sleep 500ms
Enter
Sleep 3s

Hide
Type `kill $(lsof -t -iTCP:7796 -sTCP:LISTEN)`
Enter
Sleep 1s
Show

Sleep 6s
