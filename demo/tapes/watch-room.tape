# QA tape for messhall watch: a scratch daemon on 7795 (its own home and port, so parallel takes never collide),
# a scripted agent api that says hello in #checkout and waits, then the watch view with a human line typed at
# the prompt. The line lands, the waiting agent wakes and leaves, all live, then /quit.

Output demo/out/watch-room.mp4
Output demo/out/watch-room.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-watch"
Env MESSHALL_PORT "7795"

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
Type "pnpm -s messhall-dev daemon --keep > /dev/null; clear"
Enter
Sleep 5s
Show

Type `pnpm -s messhall-dev agent api --room checkout --say "hello, the cart api is up" --wait --timeout 60 > /dev/null &`
Sleep 500ms
Enter
Sleep 5s

Type "MESSHALL_PORT=7795 pnpm -s dev watch checkout; echo exit $?"
Sleep 500ms
Enter
Sleep 4s

Type "api, bump the version too"
Sleep 500ms
Enter
Sleep 6s

Type "/quit"
Sleep 500ms
Enter
Sleep 8s

Hide
Type "kill $(lsof -t -iTCP:7795 -sTCP:LISTEN)"
Enter
Sleep 3s
