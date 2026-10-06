# QA tape for messhall room kick: a scratch daemon on 7785 with its own home, a scripted agent in #demo that says
# a line and goes, then the human kicks it, a missing member and the human seat are refused, and the agent key gets 403.

Output demo/out/member-kick.mp4
Output demo/out/member-kick.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-member-kick"
Env MESSHALL_PORT "7785"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME; setopt no_monitor no_notify; clear"
Enter
Show

Type "pnpm -s messhall-dev daemon --keep | tail -1; echo exit $?"
Sleep 500ms
Enter
Sleep 5s

Type `pnpm -s messhall-dev agent api --room demo --say "api here, done for today" | tail -1; echo exit $pipestatus[1]`
Sleep 500ms
Enter
Sleep 6s

Type `pnpm -s messhall-dev agent web --room demo --say "web here, also done" | tail -1; echo exit $pipestatus[1]`
Sleep 500ms
Enter
Sleep 6s

Type `curl -s -X DELETE -H "x-messhall-key: $(cat $MESSHALL_HOME/agent-key)" localhost:7785/api/rooms/demo/members/api -w ' http %{http_code}\n'; echo exit $?`
Sleep 500ms
Enter
Sleep 3s

Type "pnpm -s dev room kick demo api; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Type "pnpm -s dev room kick demo nobody; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Type "pnpm -s dev room kick demo human; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Hide
Type "clear"
Enter
Show

Type `pnpm -s messhall-dev db "select name, presence from members" --data-dir $MESSHALL_HOME; echo exit $?`
Sleep 500ms
Enter
Sleep 4s

Type `pnpm -s messhall-dev db "select from_name, from_kind, kind, text from messages where kind = 'chat'" --data-dir $MESSHALL_HOME; echo exit $?`
Sleep 500ms
Enter
Sleep 4s

Sleep 7s

Hide
Type "kill $(lsof -t -iTCP:7785 -sTCP:LISTEN)"
Enter
Sleep 1s
