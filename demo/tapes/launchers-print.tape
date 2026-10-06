# QA tape for messhall claude and messhall codex: --print shows each command and first prompt,
# then a real run refuses because no daemon answers on the scratch port.

Output demo/out/launchers-print.mp4
Output demo/out/launchers-print.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-launchers"
Env MESSHALL_PORT "7787"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME && mkdir -p $MESSHALL_HOME/checkout-api && clear"
Enter
Show

Type "pnpm -s dev claude --print --room checkout --cwd $MESSHALL_HOME/checkout-api -- --model opus; echo exit $?"
Sleep 500ms
Enter
Sleep 5s

Type "pnpm -s dev codex --print --room checkout --as web --cwd $MESSHALL_HOME/checkout-api; echo exit $?"
Sleep 500ms
Enter
Sleep 5s

Type "pnpm -s dev claude --room checkout; echo exit $?"
Sleep 500ms
Enter
Sleep 4s

Type "pnpm -s dev codex --room checkout; echo exit $?"
Sleep 500ms
Enter
Sleep 6s
