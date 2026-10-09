# QA tape for the orchestrator brief: a scripted orchestrator on a scratch daemon reads the topic, posts the plan,
# hands out roles, runs the review gate, kicks the last seat and wraps up. Stand-in seats, no claude starts.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 10

Output demo/out/orchestrator-brief-run.mp4
Output demo/out/orchestrator-brief-run.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-orchestratorbriefrun"
Env MESSHALL_PORT "7920"

Hide
Type "kill $(lsof -t -iTCP:7920 -sTCP:LISTEN) 2>/dev/null; sleep 1; rm -rf $MESSHALL_HOME; pnpm -s messhall-dev daemon --keep > /dev/null; clear"
Enter
Sleep 8s
Show

Type "pnpm -s tsx demo/tapes/orchestrator-run.ts; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@60s /exit [0-9]/
Sleep 4s

Type "clear; pnpm -s messhall-dev room toy | sed -n '/^id/,/closed/p' | cut -c1-120; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Wait+Screen@30s /exit [0-9]/
Sleep 6s

Type "pnpm -s messhall-dev reviews --room toy; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@30s /exit [0-9](.|\n)*exit [0-9]/
Sleep 6s

Hide
Type "kill $(lsof -t -iTCP:7920 -sTCP:LISTEN)"
Enter
Sleep 1s
