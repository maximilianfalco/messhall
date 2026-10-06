# QA tape for the pickup skill: list ready jobs, then a claim that waits on its Needs.
# Runs on a scratch copy of the made-up test queue, never the real one.

Output demo/out/pickup-queue-show.mp4
Output demo/out/pickup-queue-show.gif

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Env MESSHALL_HOME "/tmp/messhall-tape-home"
Env MESSHALL_PORT "7797"

Hide
Type "S=/tmp/messhall-tape-queue; SCRIPTS=.claude/skills/messhall-pickup-any-work/scripts; rm -rf $S; mkdir -p $S/$SCRIPTS"
Enter
Type "cp $SCRIPTS/queue.py $S/$SCRIPTS/; cp test/skills/fixtures/job-queue.md $S/queue.md"
Enter
Type "printf -- '- Job queue: `%s`\n' $S/queue.md > $S/personal-dev-notes.md; cd $S; clear"
Enter
Show

Type "python3 .claude/skills/messhall-pickup-any-work/scripts/queue.py show; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Type "python3 .claude/skills/messhall-pickup-any-work/scripts/queue.py claim B92 'agent 2026-01-02 10:00 f2/mugs' .worktrees/f2-mugs; echo exit $?"
Sleep 500ms
Enter

Sleep 5s
