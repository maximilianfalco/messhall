# QA tape for asking the human several questions at once: a scratch daemon on 7881, a scripted agent asks three
# questions (a recommended pick, a pick any one, a plain one) with ask_human and waits, watch shows the ask with one
# pick slot per question, the human answers with a pick, two picks and their own words, and the agent reads one human
# line with a header per question.

Output demo/out/ask-human-questions.mp4
Output demo/out/ask-human-questions.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-ask-questions"
Env MESSHALL_PORT "7881"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME /tmp/ask-human-questions.out; setopt no_monitor no_notify; clear"
Enter
Show

Type "pnpm -s messhall-dev daemon --keep | tail -1; echo exit $?"
Sleep 500ms
Enter
Sleep 5s

Type "pnpm -s tsx --disable-warning=ExperimentalWarning demo/tapes/ask-human-questions.ts > /tmp/ask-human-questions.out &"
Sleep 500ms
Enter
Sleep 4s

Type "pnpm -s dev watch demo | tail -12; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 7s

Type `ID=$(sqlite3 $MESSHALL_HOME/messhall.db "select id from questions where state = 'open'")`
Sleep 500ms
Enter
Sleep 1s

Type `pnpm -s dev answer $ID 1 1,3 "api only for now"; echo exit $?`
Sleep 500ms
Enter
Sleep 5s

Hide
Type "wait; clear"
Enter
Show

Type "cat /tmp/ask-human-questions.out; echo exit $?"
Sleep 500ms
Enter
Sleep 10s

Hide
Type "kill $(lsof -t -iTCP:7881 -sTCP:LISTEN)"
Enter
Sleep 1s
