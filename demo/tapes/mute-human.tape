# QA tape for messhall room mute: a scratch daemon on 7797 with its own home, a scripted agent in #demo, then the human
# mutes it, its post is refused, the agent key gets 403 on the mute route, the human seat and a missing member are refused,
# and after an unmute it posts again.

Output demo/out/mute-human.mp4
Output demo/out/mute-human.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-mute-human"
Env MESSHALL_PORT "7797"

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

Type `pnpm -s messhall-dev agent api --room demo --say "api here" | tail -1; echo exit $pipestatus[1]`
Sleep 500ms
Enter
Sleep 6s

Type "pnpm -s dev room mute demo api; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Type `pnpm -s messhall-dev agent api --room demo --say "one more thing" 2>&1 | grep -i muted; echo exit $pipestatus[1]`
Sleep 500ms
Enter
Sleep 6s

Type `curl -s -X POST -H "x-messhall-key: $(cat $MESSHALL_HOME/agent-key)" localhost:7797/api/rooms/demo/members/api/unmute -w ' http %{http_code}\n'; echo exit $?`
Sleep 500ms
Enter
Sleep 3s

Type "pnpm -s dev room mute demo human; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Type "pnpm -s dev room mute demo nobody; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Type "pnpm -s dev room unmute demo api; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Type `pnpm -s messhall-dev agent api --room demo --say "back, thanks" | tail -1; echo exit $pipestatus[1]`
Sleep 500ms
Enter
Sleep 6s

Hide
Type "clear"
Enter
Show

Type `pnpm -s messhall-dev db "select from_name, kind, text from messages where from_name != 'api' or kind = 'chat'" --data-dir $MESSHALL_HOME; echo exit $?`
Sleep 500ms
Enter
Sleep 4s

Sleep 8s

Hide
Type "kill $(lsof -t -iTCP:7797 -sTCP:LISTEN)"
Enter
Sleep 1s
