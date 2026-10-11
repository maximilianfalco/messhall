# QA tape for make install on pnpm 12: a scratch PNPM_HOME, so the real messhall shim stays put.

Output demo/out/install-pnpm12.mp4
Output demo/out/install-pnpm12.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-install-pnpm12"
Env PNPM_HOME "/private/tmp/messhall-tape-pnpm-home"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $PNPM_HOME $MESSHALL_HOME; mkdir -p $PNPM_HOME/bin; export PATH=$PNPM_HOME/bin:$PATH; clear"
Enter
Show

Type "FORCE=1 make install 2>&1 | tail -6; echo exit ${pipestatus[1]}"
Sleep 500ms
Enter
Sleep 25s

Type "ls $PNPM_HOME/bin; $PNPM_HOME/bin/messhall --version; echo exit $?"
Sleep 500ms
Enter
Sleep 4s
