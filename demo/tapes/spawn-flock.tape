# QA tape for spawn and flock. It targets the real #dev room on purpose, so render it with vhs, not render.sh.
# Needs a throwaway open queue row whose job starts "smoke dry" and a spawned one whose job starts "smoke:".

Output demo/out/spawn-flock.mp4
Output demo/out/spawn-flock.gif

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "Q=.claude/skills/messhall-pickup-any-work/scripts/queue.py; DRY=$(python3 $Q show | awk '/smoke dry/{print $1}'); clear"
Enter
Show

Type "pnpm -s messhall-dev spawn $DRY --dry-run | fold -w 120; echo exit $?"
Sleep 500ms
Enter
Sleep 9s

Hide
Type "clear"
Enter
Show

Type "pnpm -s messhall-dev flock; echo exit $?"
Sleep 500ms
Enter
Sleep 4s

Type "pnpm -s messhall-dev room dev --limit 30 | grep -E 'f8-spawn-smoke( |$)'; echo exit $?"
Sleep 500ms
Enter

Sleep 10s
