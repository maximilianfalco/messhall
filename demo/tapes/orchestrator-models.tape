# QA tape for the orchestrator brief model rule: sonnet for menial jobs, opus for hard ones, reviewers on opus, no haiku.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 20

Output demo/out/orchestrator-models.mp4
Output demo/out/orchestrator-models.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-orchestrator-models"

Hide
Type "clear"
Enter
Show

Type "grep -nE 'model|opus|haiku' docs/briefs/orchestrator.md | cut -c1-130; pnpm -s vitest run test/docs/briefs.test.ts -t 'orchestrator brief models' --reporter verbose 2>&1 | grep -E '✓|×|Tests' | cut -c1-110; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Wait+Screen@60s /exit [0-9]/
Sleep 8s
