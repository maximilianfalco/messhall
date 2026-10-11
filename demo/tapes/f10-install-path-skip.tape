# QA tape for make install after a real pnpm link: the second run skips.

Output demo/out/f10-install-path-skip.mp4
Output demo/out/f10-install-path-skip.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-f10-install-path-skip"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "export PNPM_HOME=/tmp/messhall-tape-pnpm-skip && export PATH=$PNPM_HOME:$PATH && npx -y pnpm@10.15.0 add --global link:$PWD >/dev/null 2>&1 && clear"
Enter
Show

Type "FORCE=1 make install 2>&1 | tail -2; echo exit ${pipestatus[1]}"
Sleep 500ms
Enter
Sleep 25s
