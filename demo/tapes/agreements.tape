# QA tape for agreements: a scratch daemon on 7812, web sits and waits, api proposes a field name to web and waits,
# web is rung with the proposal, mobile is refused a confirm it is not named on, web confirms, api is rung with the
# messhall line that says it is settled, and watch lists the settled agreement.

Output demo/out/agreements.mp4
Output demo/out/agreements.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-agreements"
Env MESSHALL_PORT "7812"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME /tmp/agree-*.out; setopt no_monitor no_notify; clear"
Enter
Show

Type "pnpm -s messhall-dev daemon --keep | tail -1; echo exit $?"
Sleep 500ms
Enter
Sleep 5s

Type "pnpm -s messhall-dev agent mobile --room demo --say 'mobile here' > /dev/null; pnpm -s messhall-dev agent web --room demo --wait --timeout 100 > /tmp/agree-web.out &"
Sleep 500ms
Enter
Sleep 4s

Type `pnpm -s messhall-dev agent api --room demo --propose "order totals are amount_minor, integer cents" --with web --wait --timeout 100 > /tmp/agree-api.out &`
Sleep 500ms
Enter
Sleep 5s

Type "grep 'proposal' /tmp/agree-web.out; echo exit $?"
Sleep 500ms
Enter
Sleep 5s

Type `ID=$(sqlite3 $MESSHALL_HOME/messhall.db "select id from agreements where state = 'open'")`
Sleep 500ms
Enter
Sleep 1s

Type "pnpm -s messhall-dev agent mobile --room demo --confirm $ID | grep -A1 'mobile confirm'; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 5s

Type "pnpm -s messhall-dev agent web --room demo --confirm $ID | grep -A1 'web confirm'; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 5s

Type "wait; grep 'is settled' /tmp/agree-api.out; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 4s

Type "pnpm -s dev watch demo | grep agreement; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 8s

Hide
Type "kill $(lsof -t -iTCP:7812 -sTCP:LISTEN)"
Enter
Sleep 1s
