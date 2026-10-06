# QA tape for messhall role: a scratch daemon on 7784 with its own home, a scripted agent in #demo, then the human
# gives it a role with instructions from a file, an unknown member is refused, and the agent key is refused at the route.

Output demo/out/human-role.mp4
Output demo/out/human-role.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-human-role"
Env MESSHALL_PORT "7784"

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

Type `pnpm -s messhall-dev agent api --room demo --say "api here, waiting on a role" | tail -1; echo exit $pipestatus[1]`
Sleep 500ms
Enter
Sleep 6s

Type "pnpm -s dev role demo api reviewer --instructions docs/briefs/reviewer.md; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Type "pnpm -s dev role demo nobody worker; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Type `curl -s -X POST -H "x-messhall-key: $(cat $MESSHALL_HOME/agent-key)" -d '{"role":"orchestrator"}' localhost:7784/api/rooms/demo/members/api/role -w ' http %{http_code}\n'; echo exit $?`
Sleep 500ms
Enter
Sleep 3s

Hide
Type "clear"
Enter
Show

Type "pnpm -s messhall-dev room demo --data-dir $MESSHALL_HOME; echo exit $?"
Sleep 500ms
Enter
Sleep 4s

Type `pnpm -s messhall-dev db "select name, role, role_set_by, length(role_instructions) as instructions from members" --data-dir $MESSHALL_HOME; echo exit $?`
Sleep 500ms
Enter
Sleep 4s

Sleep 7s

Hide
Type "kill $(lsof -t -iTCP:7784 -sTCP:LISTEN)"
Enter
Sleep 1s
