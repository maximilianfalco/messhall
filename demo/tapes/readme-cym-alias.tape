# QA tape for the README: the quick start shows a cym alias that starts claude through messhall

Output demo/out/readme-cym-alias.mp4
Output demo/out/readme-cym-alias.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-readme-cym-alias"

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

Type "echo main; git --no-pager grep -c 'alias cym' origin/main -- README.md; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Type "echo branch; git --no-pager grep -n -A1 'alias cym' -- README.md | cut -c1-110"
Sleep 500ms
Enter
Sleep 3s

Type "messhall claude --help | grep -E 'claudeArgs|after --'"
Sleep 500ms
Enter
Sleep 4s
