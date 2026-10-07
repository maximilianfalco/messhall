# QA tape for notes that wait for a missing name: a scratch daemon on 7851, an agent mentions worker-9 who is not in the
# room, then worker-9 joins and the join reply says one note waits from api and the catch up read shows it.

Output demo/out/notes-for-later.mp4
Output demo/out/notes-for-later.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-notes-for-later"
Env MESSHALL_PORT "7851"

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

Type `pnpm -s messhall-dev agent api --room demo --say "@worker-9 the schema is in src/order.ts"; echo exit $?`
Sleep 500ms
Enter
Sleep 5s

Hide
Type "clear"
Enter
Show

Type `pnpm -s messhall-dev agent worker-9 --room demo --catch-up | grep -E "joined|waits for you|schema"; echo exit $pipestatus[1]`
Sleep 500ms
Enter
Sleep 6s

Hide
Type "kill $(lsof -t -iTCP:7851 -sTCP:LISTEN)"
Enter
Sleep 1s
