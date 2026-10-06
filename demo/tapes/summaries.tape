# QA tape for rolling summaries: a scratch daemon on port 7788, two scripted agents post 60 times,
# the daemon summarizes on its own, summarize runs one more on haiku, and a late joiner gets it on join.

Output demo/out/summaries.mp4
Output demo/out/summaries.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-summaries"
Env MESSHALL_PORT "7788"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "kill $(lsof -t -iTCP:7788 -sTCP:LISTEN) 2> /dev/null; sleep 1; rm -rf $MESSHALL_HOME; pnpm -s messhall-dev daemon --keep > /dev/null; clear"
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

Type `pnpm -s messhall-dev db "select id, from_name, kind, length(text) as chars from messages where kind = 'summary'"; echo exit $?`
Sleep 500ms
Enter
Sleep 5s

Hide
Type "clear"
Enter
Show

Type "pnpm -s messhall-dev agent web --room checkout --say 'web tests pass on cents' > /dev/null"
Sleep 500ms
Enter
Sleep 3s

Type "pnpm -s messhall-dev summarize checkout; echo exit $?"
Sleep 500ms
Enter
Sleep 4s
Hide
Sleep 30s
Show
Sleep 6s

Hide
Type "clear"
Enter
Show

Type "pnpm -s messhall-dev agent late --room checkout | sed -n '/^joined/,/unseen/p'; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 10s

Hide
Type "kill $(lsof -t -iTCP:7788 -sTCP:LISTEN)"
Enter
Sleep 1s
Show

Sleep 2s
