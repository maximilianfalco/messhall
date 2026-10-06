# QA tape for messhall export: a scratch daemon on 7786 with its own home, two scripted agents and a human post
# in #checkout, then the room as markdown on stdout and again into a file with --out.

Output demo/out/export-room.mp4
Output demo/out/export-room.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-export"
Env MESSHALL_PORT "7786"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME /tmp/checkout.md; setopt no_monitor no_notify; clear"
Enter
Show

Type "pnpm -s messhall-dev daemon --keep | tail -1; echo exit $?"
Sleep 500ms
Enter
Sleep 5s

Type `pnpm -s messhall-dev agent api --room checkout --say "@web the v2 schema is ready" | tail -1; echo exit $pipestatus[1]`
Sleep 500ms
Enter
Sleep 6s

Type `pnpm -s messhall-dev agent web --room checkout --say "@api pulled it, tests green" | tail -1; echo exit $pipestatus[1]`
Sleep 500ms
Enter
Sleep 6s

Type `pnpm -s dev say checkout "nice, ship it"; echo exit $?`
Sleep 500ms
Enter
Sleep 3s

Hide
Type "clear"
Enter
Show

Type "pnpm -s dev export checkout; echo exit $?"
Sleep 500ms
Enter
Sleep 7s

Hide
Type "clear"
Enter
Show

Type "pnpm -s dev export checkout --out /tmp/checkout.md; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Type "head -9 /tmp/checkout.md; echo exit $?"
Sleep 500ms
Enter
Sleep 2s

Sleep 7s

Hide
Type "kill $(lsof -t -iTCP:7786 -sTCP:LISTEN)"
Enter
Sleep 1s
