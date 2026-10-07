# QA tape for messhall mcp install --print: the key shows as <agent key>, and a grep for the scratch key finds nothing.
# HOME and MESSHALL_HOME are scratch, so the real key is never read.

Output demo/out/install-no-key-print.mp4
Output demo/out/install-no-key-print.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-install-no-key"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME /tmp/messhall-tape-user-install-no-key && mkdir -p /tmp/messhall-tape-user-install-no-key"
Enter
Type "export HOME=/tmp/messhall-tape-user-install-no-key && unset CODEX_HOME && clear"
Enter
Show

Type "pnpm -s dev mcp install --print; echo exit $?"
Sleep 500ms
Enter
Sleep 6s

Type `pnpm -s dev mcp install --print | grep -cF "$(cat $MESSHALL_HOME/agent-key)"; echo exit $?`
Sleep 500ms
Enter
Sleep 6s
