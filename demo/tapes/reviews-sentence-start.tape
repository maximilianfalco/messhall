# QA tape for review requests after a short sentence. It reads the real #dev room on purpose, so render it with vhs, not render.sh.

Output demo/out/reviews-sentence-start.mp4
Output demo/out/reviews-sentence-start.gif

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

Type "pnpm -s vitest run test/tools/review.test.ts test/tools/spawn.test.ts -t 'CI green|newest page' 2>&1 | grep -E '✓|Tests'; echo exit $?"
Sleep 500ms
Enter
Sleep 6s

Hide
Type "clear"
Enter
Show

Type "pnpm -s messhall-dev reviews --room dev | cut -c1-130; echo exit $?"
Sleep 500ms
Enter

Sleep 8s
