# QA tape for shared temp paths: briefs and skills no longer tell agents to write a fixed /tmp file

Output demo/out/scratch-per-agent-grep.mp4
Output demo/out/scratch-per-agent-grep.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-scratch-per-agent"

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

Type "echo main; git --no-pager grep -cE 'tmp/last.png|under...tmp' origin/main -- docs .claude demo/tapes/README.md; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Type "echo branch; git --no-pager grep -cE 'tmp/last.png|under...tmp' -- docs .claude demo/tapes/README.md; echo exit $?"
Sleep 500ms
Enter
Sleep 5s
