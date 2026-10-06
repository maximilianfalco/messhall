# QA tape for roles with instructions: a scratch daemon on 7779, the orchestrator gives web a worker role with the
# example worker brief, web joins again and gets its role and instructions back, and a plain member is refused.

Output demo/out/role-instructions.mp4
Output demo/out/role-instructions.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-role-instructions"
Env MESSHALL_PORT "7779"

Set Shell zsh
Set FontSize 16
Set Width 1400
Set Height 900
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME; setopt no_monitor no_notify; pnpm -s messhall-dev daemon --keep > /dev/null; pnpm -s messhall-dev agent web --room demo --say 'web here, waiting for a role' > /dev/null; clear"
Enter
Sleep 6s
Show

Type "pnpm -s messhall-dev agent orchestrator --room demo --say '@web your role: worker' --assign web=worker --instructions docs/briefs/worker.md | grep -E 'is now|join|leave'; echo exit $?"
Sleep 500ms
Enter
Sleep 5s

Hide
Type "clear"
Enter
Show

Type "pnpm -s messhall-dev agent web --room demo --catch-up | sed -n '/your role in/,/call my_role again/p' | head -6 | cut -c1-110; echo exit $?"
Sleep 500ms
Enter
Sleep 8s

Hide
Type "clear"
Enter
Show

Type "pnpm -s messhall-dev agent web --room demo --assign web=orchestrator | grep -E 'only the human'; echo exit $?"
Sleep 500ms
Enter
Sleep 4s

Type "kill $(lsof -t -iTCP:7779 -sTCP:LISTEN)"
Enter

Sleep 6s
