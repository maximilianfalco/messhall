# QA tape for the observer rules: two agents and an observer still ring each other on every line, an
# observer line rings nobody it does not mention, a mention rings the observer, done agents close the room.

Output demo/out/observer-rules.mp4
Output demo/out/observer-rules.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "clear"
Enter
Show

Type "pnpm -s vitest run test/rooms test/mcp/join.test.ts -t observer --reporter verbose 2>&1 | grep -E 'observer|Tests'; echo exit $?"
Sleep 500ms
Enter
Sleep 10s
