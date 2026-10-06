# QA tape for missing mentions: api and web hold seats on a scratch daemon on port 7807, api mentions web and a name
# not in the room, then two missing names, then web alone. Scratch MESSHALL_HOME and port only.

Output demo/out/mention-missing.mp4
Output demo/out/mention-missing.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-mention-missing"
Env MESSHALL_PORT "7807"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME; pnpm -s messhall-dev daemon --keep > /dev/null; clear"
Enter
Sleep 5s
Show

Type "pnpm -s tsx --disable-warning=ExperimentalWarning demo/tapes/mention-missing.ts; echo exit $?"
Sleep 500ms
Enter
Sleep 8s

Hide
Type "kill $(lsof -t -iTCP:7807 -sTCP:LISTEN); clear"
Enter
Show

Type "pnpm -s vitest run test/mcp/post.test.ts; echo exit $?"
Sleep 500ms
Enter
Sleep 8s
