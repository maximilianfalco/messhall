# QA tape for the summary labels: a scratch daemon on port 7785, the 60 post seed, the prompt test that pins
# Goal, Agreed, Shipped, Open and Waiting, and a late joiner gets the daemon's own summary in those labels.

Output demo/out/summary-wording.mp4
Output demo/out/summary-wording.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-summary-wording"
Env MESSHALL_PORT "7785"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "kill $(lsof -t -iTCP:7785 -sTCP:LISTEN) 2> /dev/null; sleep 1; rm -rf $MESSHALL_HOME; pnpm -s messhall-dev daemon --keep > /dev/null; clear"
Enter
Sleep 6s
Show

Type "bash demo/tapes/summaries-seed.sh checkout; echo exit $?"
Sleep 500ms
Enter
Sleep 4s
Hide
Sleep 45s
Show
Sleep 2s

Hide
Type "clear"
Enter
Show

Type "pnpm -s vitest run test/rooms/summaries.test.ts -t 'labeled parts' | grep -E 'Tests|✓'; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 6s
Hide
Sleep 20s
Type "clear"
Enter
Show

Type "pnpm -s messhall-dev agent late --room checkout | sed -n '/^latest summary/,/unseen/p'; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 12s

Hide
Type "kill $(lsof -t -iTCP:7785 -sTCP:LISTEN)"
Enter
Sleep 1s
