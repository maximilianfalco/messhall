# QA tape for messhall mcp install and doctor: --print on a scratch key, an install into scratch Claude and Codex
# configs, then doctor. HOME, CLAUDE_CONFIG_DIR, MESSHALL_HOME and the port are scratch, so real configs are never read.

Output demo/out/mcp-install-print-and-doctor.mp4
Output demo/out/mcp-install-print-and-doctor.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-install"
Env MESSHALL_PORT "7791"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME /tmp/messhall-tape-user-install && mkdir -p /tmp/messhall-tape-user-install/claude"
Enter
Type "export HOME=/tmp/messhall-tape-user-install CLAUDE_CONFIG_DIR=/tmp/messhall-tape-user-install/claude && unset CODEX_HOME && clear"
Enter
Show

Type "pnpm -s dev mcp install --print; echo exit $?"
Sleep 500ms
Enter
Sleep 6s

Hide
Type "clear"
Enter
Show

Type "pnpm -s messhall-dev daemon --keep | tail -2; echo exit $?"
Sleep 500ms
Enter
Sleep 5s

Type "pnpm -s dev mcp install --yes; echo exit $?"
Sleep 500ms
Enter
Sleep 12s

Hide
Type "clear"
Enter
Show

Type "pnpm -s dev mcp doctor; echo exit $?"
Sleep 500ms
Enter
Sleep 10s

Hide
Type "kill $(lsof -t -iTCP:7791 -sTCP:LISTEN)"
Enter
Sleep 1s
