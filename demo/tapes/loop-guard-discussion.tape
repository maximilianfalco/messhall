# QA tape for the loop guard leaving a discussion alone: a scratch daemon on 7796 (its own home).
# api and web trade 12 lines 11 s apart, the dogfood shape, and nothing pauses. Then 12 lines in a burst pause
# them, and a line from api to @human lifts the pause without the human.

Output demo/out/loop-guard-discussion.mp4
Output demo/out/loop-guard-discussion.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-loop-guard-discussion"
Env MESSHALL_PORT "7796"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type@1ms `rm -rf $MESSHALL_HOME; setopt no_monitor no_notify pipefail; pnpm -s messhall-dev daemon --keep > /dev/null 2>&1 && for i in 1 2 3 4 5 6; do pnpm -s dev post checkout --as api "@web totals field, round $i" > /dev/null; sleep 11; pnpm -s dev post checkout --as web "@api agreed for round $i, testing it" > /dev/null; sleep 11; done; R="pnpm -s messhall-dev room checkout --url http://127.0.0.1:7796 --limit 80"; T="pnpm -s messhall-dev db \"select count(*) as lines, min(created_at) as first, max(created_at) as last from messages where kind = 'chat'\""; P="pnpm -s messhall-dev db \"select name, paused_with from members where kind != 'human'\""; clear`
Enter
Sleep 150s
Show

Type `eval $T; eval $R | grep -c traded; eval $P; echo exit $?`
Sleep 500ms
Enter
Sleep 6s

Type `for i in 1 2 3 4 5 6; do pnpm -s dev post checkout --as api "@web again $i" > /dev/null; pnpm -s dev post checkout --as web "@api again $i" > /dev/null; done; eval $R | grep -o "@human.*"; eval $P; echo exit $?`
Sleep 500ms
Enter
Sleep 22s

Type `pnpm -s dev post checkout --as api "@human we are settling the totals field, a few more lines" > /dev/null; eval $P; echo exit $?`
Sleep 500ms
Enter
Sleep 5s

Hide
Type `kill $(lsof -t -iTCP:7796 -sTCP:LISTEN)`
Enter
Sleep 1s
Show

Sleep 6s
