# QA tape for the README: install notes, positioning, orchestrator start and the mac app section

Output demo/out/readme-refresh.mp4
Output demo/out/readme-refresh.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-readme-refresh"

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

Type "git --no-pager grep -n -E 'herdr|pnpm setup|versioned release|--orchestrator|## The Mac app' -- README.md | cut -c1-120"
Sleep 500ms
Enter
Sleep 4s

Type "messhall room new --help | grep -E 'orchestrator|cwd'"
Sleep 500ms
Enter
Sleep 4s
