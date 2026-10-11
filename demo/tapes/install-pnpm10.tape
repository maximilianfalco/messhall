# QA tape for make install on pnpm 10.15: a pnpm shim over npx and a scratch PNPM_HOME, so the real messhall shim stays put.

Output demo/out/install-pnpm10.mp4
Output demo/out/install-pnpm10.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-install-pnpm10"
Env PNPM_HOME "/private/tmp/messhall-tape-pnpm10-home"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $PNPM_HOME $MESSHALL_HOME; mkdir -p $PNPM_HOME; printf '#!/bin/sh\nexec npx -y pnpm@10.15.0 $@\n' > $PNPM_HOME/pnpm; chmod +x $PNPM_HOME/pnpm; export PATH=$PNPM_HOME:$PATH; clear"
Enter
Show

Type "FORCE=1 make install 2>&1 | tail -6; echo exit ${pipestatus[1]}"
Sleep 500ms
Enter
Sleep 40s

Type "pnpm --version; ls $PNPM_HOME; $PNPM_HOME/messhall --version; echo exit $?"
Sleep 500ms
Enter
Sleep 4s
