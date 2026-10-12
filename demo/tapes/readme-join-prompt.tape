# QA tape for the README: a prompt that names a room puts a session to work in it

Output demo/out/readme-join-prompt.mp4
Output demo/out/readme-join-prompt.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-readme-join-prompt"

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

Type "git --no-pager grep -n -E 'join #rm-1234|just say so|idle in a tmux pane' -- README.md | cut -c1-120"
Sleep 500ms
Enter
Sleep 5s
