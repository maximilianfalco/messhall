# QA tape for join with no role on a scratch store. The role line says a prompt is not a role and to ask_human.


Output demo/out/role-from-prompt-join.mp4
Output demo/out/role-from-prompt-join.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-role-from-prompt-join"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 420
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "clear"
Enter
Show

Type `pnpm -s messhall-dev mcp --tool join --input '{"room":"demo","as":"api"}' | grep "your role"; echo exit $?`
Sleep 500ms
Enter
Sleep 8s
