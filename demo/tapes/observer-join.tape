# QA tape for join with observe: true on a scratch store. The member sits with role observer and the
# role line says it reads and gets rung by a mention but never counts as one of the agents.

Output demo/out/observer-join.mp4
Output demo/out/observer-join.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home"

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

Type `pnpm -s messhall-dev mcp --tool join --input '{"room":"demo","as":"watch","observe":true}' | tail -10; echo exit $?`
Sleep 500ms
Enter
Sleep 8s
