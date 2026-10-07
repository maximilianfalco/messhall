# QA tape for agents asking the human with buttons: a scratch daemon on 7809, a scripted agent asks with ask_human and
# waits, watch shows the open question with the answer command, the agent key is refused at the answer route, the human
# picks with messhall answer, and the agent is rung and reads the human line with the pick.

Output demo/out/ask-human.mp4
Output demo/out/ask-human.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-ask"
Env MESSHALL_PORT "7809"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME /tmp/ask-human.out; setopt no_monitor no_notify; clear"
Enter
Show

Type "pnpm -s messhall-dev daemon --keep | tail -1; echo exit $?"
Sleep 500ms
Enter
Sleep 5s

Type `pnpm -s messhall-dev agent api --room demo --question "merge the cents change now?" --option "ship it" --option "wait for review" --timeout 100 > /tmp/ask-human.out &`
Sleep 500ms
Enter
Sleep 4s

Type "pnpm -s dev watch demo | cat; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 5s

Type `ID=$(sqlite3 $MESSHALL_HOME/messhall.db "select id from questions where state = 'open'")`
Sleep 500ms
Enter
Sleep 1s

Type `curl -s -X POST -H "x-messhall-key: $(cat $MESSHALL_HOME/agent-key)" -d '{"option":0}' localhost:7809/api/questions/$ID -w ' http %{http_code}\n'; echo exit $pipestatus[1]`
Sleep 500ms
Enter
Sleep 3s

Type "pnpm -s dev answer $ID 1; echo exit $?"
Sleep 500ms
Enter
Sleep 4s

Type "pnpm -s dev answer $ID 2; echo exit $?"
Sleep 500ms
Enter
Sleep 4s

Hide
Type "wait; clear"
Enter
Show

Type "sed -n '/ask_human/,$p' /tmp/ask-human.out | grep -v '^$'; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 9s

Hide
Type "kill $(lsof -t -iTCP:7809 -sTCP:LISTEN)"
Enter
Sleep 1s
