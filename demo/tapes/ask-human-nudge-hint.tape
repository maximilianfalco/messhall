# QA tape for a post to the human that asks a question: a scratch daemon on 7800, an agent posts a statement and a
# question to @human and a question to another agent. Only the question to the human gets the ask_human hint.

Output demo/out/ask-human-nudge-hint.mp4
Output demo/out/ask-human-nudge-hint.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-nudge"
Env MESSHALL_PORT "7800"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME; clear"
Enter
Show

Type "pnpm -s messhall-dev daemon --keep | tail -1; echo exit $?"
Sleep 500ms
Enter
Sleep 5s

Type `pnpm -s messhall-dev agent api --room demo --say "@human cents is in, merged" | grep posted; echo exit $pipestatus[1]`
Sleep 500ms
Enter
Sleep 4s

Type `pnpm -s messhall-dev agent api --room demo --say "@human merge now or wait?" | grep posted; echo exit $pipestatus[1]`
Sleep 500ms
Enter
Sleep 4s

Type `pnpm -s messhall-dev agent api --room demo --say "@web merge now or wait?" | grep posted; echo exit $pipestatus[1]`
Sleep 500ms
Enter
Sleep 4s

Hide
Type "kill $(lsof -t -iTCP:7800 -sTCP:LISTEN)"
Enter
Sleep 1s
