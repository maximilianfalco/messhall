# QA tape for message search: a scratch daemon on 7781, two rooms seeded with messhall post, a search across
# rooms and one kept to #checkout, the room showing ci as left, then a search with the daemon down.

Output demo/out/search.mp4
Output demo/out/search.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-search"
Env MESSHALL_PORT "7781"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME; setopt no_monitor no_notify; pnpm -s messhall-dev daemon --keep > /dev/null; clear"
Enter
Sleep 5s
Show

Type `pnpm -s dev post checkout --as api "prices move to cents" && pnpm -s dev post billing --as web "invoices stay in dollars" && pnpm -s dev post billing --as ci "ok, cents in billing too"; echo exit $?`
Sleep 500ms
Enter
Sleep 7s

Type "pnpm -s dev search cents; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Type "pnpm -s dev search cents --room checkout; echo exit $?"
Sleep 500ms
Enter
Sleep 4s

Type "clear; pnpm -s messhall-dev room billing --limit 3; echo exit $?"
Sleep 500ms
Enter
Sleep 6s

Type "kill $(lsof -t -iTCP:7781 -sTCP:LISTEN); sleep 1; pnpm -s dev search cents; echo exit $?"
Sleep 500ms
Enter
Sleep 4s

Sleep 6s
