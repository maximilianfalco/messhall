# QA tape for the muster skill: a scratch daemon on 7901, a scripted convener plays the first muster steps (opens the
# room as orchestrator, writes the plan from the template, asks the human what done looks like), then the room view
# shows the goal, the open ask and the plan line, and the plan file sits in the data dir with the template sections.

Output demo/out/muster-convener.mp4
Output demo/out/muster-convener.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-muster"
Env MESSHALL_PORT "7901"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME; setopt no_monitor no_notify; clear"
Enter
Show

Type "pnpm -s messhall-dev daemon --keep | tail -1; echo exit $?"
Sleep 500ms
Enter
Sleep 5s

Type "pnpm -s tsx --disable-warning=ExperimentalWarning demo/tapes/muster-convener.ts; echo exit $?"
Sleep 500ms
Enter
Sleep 6s

Hide
Type "clear"
Enter
Show

Type "pnpm -s messhall-dev room greet-by-time --data-dir $MESSHALL_HOME | tail -9; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 5s

Type "grep '^## ' $MESSHALL_HOME/plans/greet-by-time.md; echo exit $?"
Sleep 500ms
Enter
Sleep 8s

Hide
Type "kill $(lsof -t -iTCP:7901 -sTCP:LISTEN)"
Enter
Sleep 1s
