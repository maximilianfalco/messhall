# QA tape for human-made rooms: a scratch daemon on 7789 (its own home and port, so parallel takes never collide).
# The human makes #planning, an agent joins and posts done, the room stays open because it is standing,
# then the human closes it and reopens it by hand.

Output demo/out/room-new-close-reopen.mp4
Output demo/out/room-new-close-reopen.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-rooms"
Env MESSHALL_PORT "7789"

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
Sleep 6s
Show

Type `pnpm -s dev room new planning --topic "q4"; echo exit $?`
Sleep 500ms
Enter
Sleep 3s

Type `pnpm -s messhall-dev agent api --room planning --done --say "my part is in" | grep -E "post|posted"; echo exit $pipestatus[1]`
Sleep 500ms
Enter
Sleep 5s

Type "pnpm -s dev room list; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Type "pnpm -s dev room close planning; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Type "pnpm -s dev room list; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Type "pnpm -s dev room reopen planning; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Type "pnpm -s dev room list; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Hide
Type "kill $(lsof -t -iTCP:7789 -sTCP:LISTEN)"
Enter
Show

Sleep 6s
