# QA tape for approving a tool ask from outside the terminal: a scratch daemon on 7808, a scripted agent asks to run
# a command the way Claude Code relays a permission dialog, the store holds the pending ask, the agent key is refused
# at the answer route, a made up id is refused, the human key allows it and the agent gets the verdict. Then a deny.

Output demo/out/approve-from-app.mp4
Output demo/out/approve-from-app.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-approve"
Env MESSHALL_PORT "7808"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME /tmp/ask-*.out; setopt no_monitor no_notify; clear"
Enter
Show

Type "pnpm -s messhall-dev daemon --keep | tail -1; echo exit $?"
Sleep 500ms
Enter
Sleep 5s

Type `pnpm -s messhall-dev agent api --room demo --ask "pnpm test" > /tmp/ask-1.out &`
Sleep 500ms
Enter
Sleep 4s

Type `sqlite3 -box $MESSHALL_HOME/messhall.db "select member, tool, description, input_preview, state from approvals"; echo exit $?`
Sleep 500ms
Enter
Sleep 4s

Type `ID=$(sqlite3 $MESSHALL_HOME/messhall.db "select id from approvals where state = 'pending'"); echo $ID`
Sleep 500ms
Enter
Sleep 2s

Type `curl -s -X POST -H "x-messhall-key: $(cat $MESSHALL_HOME/agent-key)" -d '{"behavior":"allow"}' localhost:7808/api/approvals/$ID -w ' http %{http_code}\n' | cut -c1-80; echo exit $pipestatus[1]`
Sleep 500ms
Enter
Sleep 3s

Type `curl -s -X POST -H "x-messhall-key: $(cat $MESSHALL_HOME/human-key)" -d '{"behavior":"allow"}' localhost:7808/api/approvals/4b0c6a52-0d7e-4b8e-9c55-0f6a1e2b3c4d -w ' http %{http_code}\n' | cut -c1-80; echo exit $pipestatus[1]`
Sleep 500ms
Enter
Sleep 3s

Type `curl -s -X POST -H "x-messhall-key: $(cat $MESSHALL_HOME/human-key)" -d '{"behavior":"allow"}' localhost:7808/api/approvals/$ID -w ' http %{http_code}\n' | cut -c1-80; echo exit $pipestatus[1]`
Sleep 500ms
Enter
Sleep 3s

Type "wait; grep -A1 'ask Bash' /tmp/ask-1.out; echo exit $?"
Sleep 500ms
Enter
Sleep 4s

Hide
Type "clear"
Enter
Show

Type `pnpm -s messhall-dev agent web --room demo --ask "rm -rf build" > /tmp/ask-2.out &`
Sleep 500ms
Enter
Sleep 4s

Type `ID=$(sqlite3 $MESSHALL_HOME/messhall.db "select id from approvals where state = 'pending'")`
Sleep 500ms
Enter
Sleep 1s

Type `curl -s -X POST -H "x-messhall-key: $(cat $MESSHALL_HOME/human-key)" -d '{"behavior":"deny"}' localhost:7808/api/approvals/$ID -w ' http %{http_code}\n' | cut -c1-80; echo exit $pipestatus[1]`
Sleep 500ms
Enter
Sleep 3s

Type "wait; grep -A1 'ask Bash' /tmp/ask-2.out; echo exit $?"
Sleep 500ms
Enter
Sleep 4s

Type `sqlite3 -box $MESSHALL_HOME/messhall.db "select member, tool, state from approvals"; echo exit $?`
Sleep 500ms
Enter
Sleep 7s

Hide
Type "kill $(lsof -t -iTCP:7808 -sTCP:LISTEN)"
Enter
Sleep 1s
