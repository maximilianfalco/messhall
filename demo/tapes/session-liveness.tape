# QA tape for session liveness: a scripted agent killed with -9 mid-wait turns gone within
# about 75 s, then a new agent joins under the same name and reconnects. Port 7773.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 20

Output demo/out/session-liveness.mp4
Output demo/out/session-liveness.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-liveness"
Env MESSHALL_PORT "7773"

Hide
Type "rm -rf $MESSHALL_HOME; sleep 1; pnpm -s messhall-dev daemon --keep > /dev/null; clear"
Enter
Sleep 8s
Show

Type "pnpm -s messhall-dev agent web --room demo --wait --timeout 270 > /dev/null &"
Sleep 500ms
Enter
Sleep 5s

Type "pnpm -s messhall-dev room demo | grep -E '^(member|web)'; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@30s /exit [0-9]/
Sleep 2s

Type "pkill -9 -f 'agent web --room demo'; s=$SECONDS; until pnpm -s messhall-dev room demo | grep -qE '^web .*gone'; do sleep 3; done; echo gone after $((SECONDS-s)) s; echo exit $?"
Sleep 500ms
Enter
Hide
Wait+Screen@120s /gone after [0-9]+ s/
Show
Sleep 2s

Type "pnpm -s messhall-dev room demo | grep -E '^(member|web)|system'; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@30s /web is gone/
Sleep 2s

Hide
Type "clear"
Enter
Show

Type "pnpm -s messhall-dev agent web --room demo --say 'back after the crash' | grep -E 'join|reconnected|members'; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@30s /reconnected #demo/
Sleep 2s

Type "pnpm -s messhall-dev room demo | grep system; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@30s /web reconnected/
Sleep 6s

Hide
Type "kill $(lsof -t -iTCP:7773 -sTCP:LISTEN)"
Enter
Sleep 1s
