# QA tape for seated reviewers and the review gate. It targets the real #dev room on purpose, so render it with vhs, not render.sh.
# Needs a seat spawned as reviewer-1 with the reviewer role and a spawned smoke worker that went through a review round trip.

Output demo/out/reviewers.mp4
Output demo/out/reviewers.gif

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

Type "pnpm -s messhall-dev flock | cut -c1-130; echo exit $?"
Sleep 500ms
Enter
Sleep 5s

Hide
Type "clear"
Enter
Show

Type "pnpm -s messhall-dev room dev --limit 200 | grep -E 'your role|ready for review|round [0-9]|review of|approved|merged' | cut -c1-130 | tail -12; echo exit $?"
Sleep 500ms
Enter
Sleep 6s

Type "pnpm -s messhall-dev reviews --room dev | cut -c1-130; echo exit $?"
Sleep 500ms
Enter

Sleep 10s
