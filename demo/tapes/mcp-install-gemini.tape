# QA tape for Gemini CLI in messhall mcp install, doctor and uninstall. HOME, CLAUDE_CONFIG_DIR, MESSHALL_HOME and the
# port are scratch, so real configs are never read. The key is masked with sed before the settings file is shown.

Output demo/out/mcp-install-gemini.mp4
Output demo/out/mcp-install-gemini.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-gemini"
Env MESSHALL_PORT "7796"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME /tmp/messhall-tape-user-gemini && mkdir -p /tmp/messhall-tape-user-gemini/claude /tmp/messhall-tape-user-gemini/.gemini"
Enter
Type "export HOME=/tmp/messhall-tape-user-gemini CLAUDE_CONFIG_DIR=/tmp/messhall-tape-user-gemini/claude && unset CODEX_HOME GEMINI_CLI_HOME && setopt pipefail"
Enter
Type `echo '{ "theme": "Dracula", "mcpServers": { "other": { "command": "other" } } }' > ~/.gemini/settings.json`
Enter
Type "pnpm -s messhall-dev daemon --keep > /dev/null && clear"
Enter
Sleep 5s
Show

Type "pnpm -s dev mcp install --yes | grep -iv claude; echo exit $?"
Sleep 500ms
Enter
Sleep 12s

Hide
Type "clear"
Enter
Show

Type "sed -E 's/[0-9a-f]{64}/<agent key>/' ~/.gemini/settings.json"
Sleep 500ms
Enter
Sleep 2s

Type "pnpm -s dev mcp doctor | grep -E 'daemon|entry'; echo exit $?"
Sleep 500ms
Enter
Sleep 10s

Hide
Type "clear"
Enter
Show

Type "pnpm -s dev mcp uninstall --yes; echo exit $?"
Sleep 500ms
Enter
Sleep 6s

Type "cat ~/.gemini/settings.json"
Sleep 500ms
Enter
Sleep 4s

Hide
Type "kill $(lsof -t -iTCP:7796 -sTCP:LISTEN)"
Enter
Sleep 2s
