# QA tape for asking the human: the tool caps (2 to 4 labels, 40 chars, no @, 500 char question), one answer per
# question, the agent key refused at the answer route, the answer line rings the asker, and expiry after 30 minutes.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 20

Output demo/out/ask-human-tests.mp4
Output demo/out/ask-human-tests.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-ask-human-tests"

Hide
Type "clear"
Enter
Show

Type "pnpm -s vitest run test/mcp/askHuman.test.ts test/daemon/questions.test.ts --reporter verbose 2>&1 | grep -E '✓|×|Tests' | cut -c1-110; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Wait+Screen@60s /exit [0-9]/
Sleep 8s
