# QA tape for make install when pnpm's global bin dir is not on PATH: one clear line, no pnpm stack.

Output demo/out/f10-install-path-missing.mp4
Output demo/out/f10-install-path-missing.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-f10-install-path-missing"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "export PNPM_HOME=/tmp/messhall-tape-pnpm-missing && mkdir -p $PNPM_HOME && clear"
Enter
Show

Type "FORCE=1 make install 2>&1 | tail -3; echo exit ${pipestatus[1]}"
Sleep 500ms
Enter
Sleep 25s
