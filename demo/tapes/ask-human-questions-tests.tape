# QA tape for the question list: the new and old ask shapes and their limits, answers that fit or not, the answer line
# with a header per question, the migration of old rows, watch and messhall answer, then the whole run's totals.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 20

Output demo/out/ask-human-questions-tests.mp4
Output demo/out/ask-human-questions-tests.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-ask-questions-tests"

Hide
Type "clear"
Enter
Show

Type "pnpm -s vitest run test/mcp/askHuman.test.ts test/rooms/questions.test.ts test/daemon/questions.test.ts test/cli/answer.test.ts test/feed/render.test.ts test/rooms/db.test.ts --reporter verbose 2>&1 | grep -E '✓|×' | grep -iE 'question|header|typed|pick|short form|answer' | cut -c1-118 | tail -26; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 14s

Type "clear; pnpm -s vitest run test/mcp/askHuman.test.ts test/rooms/questions.test.ts test/daemon/questions.test.ts test/cli/answer.test.ts test/feed/render.test.ts test/rooms/db.test.ts 2>&1 | tail -5; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 8s
