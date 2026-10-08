# QA tape for review findings: the briefs and the pickup skill no longer offer an optional nit tier

Output demo/out/no-nits-grep.mp4
Output demo/out/no-nits-grep.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-no-nits"

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

Type "echo main; git --no-pager grep -ciE 'nits? alone|then nits|nits are your call|3. nit:|should-fix and nits' origin/main -- docs/briefs .claude/skills app/Messhall/Resources/Templates; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Type "echo branch; git --no-pager grep -ciE 'nits? alone|then nits|nits are your call|3. nit:|should-fix and nits' -- docs/briefs .claude/skills app/Messhall/Resources/Templates; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Type "git --no-pager grep -nE 'Every finding fixed|No nits|Fix every finding' -- docs/briefs | cut -c1-120"
Sleep 500ms
Enter
Sleep 5s
