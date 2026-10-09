# QA tape for the README: the "what it is not" section is back (not Conductor, not a swarm controller, not an IDE)

Output demo/out/readme-not-a.mp4
Output demo/out/readme-not-a.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-readme-not-a"

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

Type "echo main; git --no-pager grep -c 'Not an IDE' origin/main -- README.md; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Type "echo branch; git --no-pager grep -nE '^## What it is not|^- \*\*Not ' -- README.md | cut -c1-110"
Sleep 500ms
Enter
Sleep 5s
