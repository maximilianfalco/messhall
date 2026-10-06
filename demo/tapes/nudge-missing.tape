# QA tape for messhall-dev nudge on a session tmux does not have: it says so and exits 1.

Output demo/out/nudge-missing.mp4
Output demo/out/nudge-missing.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-nudge-missing"

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

Type "pnpm -s messhall-dev nudge messhall-seat-nobody 'carry on'; echo exit $?"
Sleep 500ms
Enter
Sleep 5s
