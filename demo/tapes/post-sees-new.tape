# QA tape for the post reply: api and web hold seats on a scratch daemon on port 7779, web asks api,
# api's next post names the crossed line, and after read_since the reply is plain again. Scratch MESSHALL_HOME and port only.

Output demo/out/post-sees-new.mp4
Output demo/out/post-sees-new.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-post-sees-new"
Env MESSHALL_PORT "7779"

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

Type "pnpm -s tsx --disable-warning=ExperimentalWarning demo/tapes/post-sees-new.ts; echo exit $?"
Sleep 500ms
Enter
Sleep 8s

Hide
Type "kill $(lsof -t -iTCP:7779 -sTCP:LISTEN); clear"
Enter
Show

Type "pnpm -s vitest run test/mcp/post.test.ts; echo exit $?"
Sleep 500ms
Enter
Sleep 8s
