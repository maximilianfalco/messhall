# QA tape for the worker brief: a worker never asks the human to approve or run a command in its terminal

Output demo/out/no-terminal-asks.mp4
Output demo/out/no-terminal-asks.gif

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

Type "echo main; git --no-pager grep -c 'approve it in your terminal' origin/main -- docs/briefs; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Type "echo branch; git --no-pager grep -c 'approve it in your terminal' -- docs/briefs; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Type "git --no-pager grep -o 'never ask them to approve or run a command for you' -- docs/briefs"
Sleep 500ms
Enter
Sleep 5s
