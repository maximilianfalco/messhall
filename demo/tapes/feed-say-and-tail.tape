# QA tape for the live feed: a scratch daemon on 7793 (its own home and port, so parallel takes never collide),
# the dev feed tailing it while a scripted MCP agent joins #checkout, says hello and leaves, then a human post
# with messhall say. Every one of those shows up as a feed line, then stop.

Output demo/out/feed-say-and-tail.mp4
Output demo/out/feed-say-and-tail.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-f3"
Env MESSHALL_PORT "7793"

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

Type "pnpm -s messhall-dev daemon --keep; echo exit $?"
Sleep 500ms
Enter
Sleep 5s

Hide
Type "clear"
Enter
Show

Type "pnpm -s messhall-dev feed --count 10 &"
Sleep 500ms
Enter
Sleep 6s
Enter
Sleep 500ms

Type `pnpm -s messhall-dev agent api --room checkout --say "hello from api" | tail -1; echo exit $pipestatus[1]`
Sleep 500ms
Enter
Sleep 7s

Type `MESSHALL_PORT=7793 pnpm -s dev say checkout "api, also bump the version"; echo exit $?`
Sleep 500ms
Enter
Sleep 4s

Type "wait; echo feed exit $?"
Sleep 500ms
Enter
Sleep 2s

Type "kill $(lsof -t -iTCP:7793 -sTCP:LISTEN); echo exit $?"
Sleep 500ms
Enter

Sleep 7s
