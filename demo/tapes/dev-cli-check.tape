# QA tape for the dev CLI: the gate as one table, then the feature map counts. Run from the repo root.
# Nothing here touches a daemon. MESSHALL_HOME is set so render.sh can prove the take is scratch.

Output demo/out/dev-cli-check.mp4
Output demo/out/dev-cli-check.gif

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

Type "pnpm -s messhall-dev check; echo exit $?"
Sleep 500ms
Enter
Sleep 8s

Type "pnpm -s messhall-dev featuremap --check; echo exit $?"
Sleep 500ms
Enter

Sleep 6s
