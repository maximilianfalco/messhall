# QA tape for human line routing: a human line that names nobody concerns and rings only the live orchestrator,
# every agent when the orchestrator is away, gone or muted, and a mention or @all still reaches who it names.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 20

Output demo/out/human-line-routing-tests.mp4
Output demo/out/human-line-routing-tests.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-human-line-routing-tests"

Hide
Type "clear"
Enter
Show

Type "pnpm -s vitest run test/rooms/rules.test.ts test/doorbell/rules.test.ts -t 'orchestrator|human' --reporter verbose 2>&1 | grep -E '✓|×|Tests'; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@60s /exit [0-9]/
Sleep 6s
