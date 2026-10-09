# QA tape for the running agents routes: a scratch daemon on 7823 that scans only two fake claude sessions in
# scratch repos on one ticket. The human lists them, invites them to a room, the agent key is refused, and so is a closed room.

Output demo/out/invite-running-routes.mp4
Output demo/out/invite-running-routes.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-invite-running"
Env MESSHALL_PORT "7823"
Env MESSHALL_CLAUDE_SESSIONS "/tmp/messhall-tape-home-invite-running/claude-sessions"

Set Shell zsh
Set FontSize 16
Set Width 1400
Set Height 860
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME; setopt no_monitor no_notify; mkdir -p $MESSHALL_CLAUDE_SESSIONS"
Enter
Type `n=0; for r in checkout-api:rm-1234/order-totals checkout-web:rm-1234/cart-page; do n=$((n+1)); d=$MESSHALL_HOME/code/${r%%:*}; mkdir -p $d; git -C $d init -q -b ${r#*:}; git -C $d -c user.name=t -c user.email=t@example.com commit -q --allow-empty -m init; printf '{"cwd":"%s","pid":%d,"sessionId":"s-%s","status":"idle"}' $d $$ ${r%%:*} > $MESSHALL_CLAUDE_SESSIONS/$n.json; done`
Enter
Type `human() { curl -s -H "x-messhall-key: $(cat $MESSHALL_HOME/human-key)" -H 'content-type: application/json' "$@" -w ' http %{http_code}\n'; }; clear`
Enter
Show

Type "pnpm -s messhall-dev daemon --keep | tail -1; echo exit $?"
Sleep 500ms
Enter
Sleep 5s

Type `human localhost:7823/api/running | sed 's/ http 200$//' | jq -c '(.agents[] | {id, repo, branch, reach}), .suggestions'; echo exit $pipestatus[1]`
Sleep 500ms
Enter
Sleep 4s

Type `human -X POST -d '{"name":"rm-1234"}' localhost:7823/api/rooms >/dev/null; human -X POST -d '{"ids":["s-checkout-api","s-gone"],"room":"rm-1234"}' localhost:7823/api/running/invite | sed 's/ http 200$//' | jq -c '.invites[] | {id, name, outcome}'; echo exit $pipestatus[1]`
Sleep 500ms
Enter
Sleep 5s

Type `curl -s -H "x-messhall-key: $(cat $MESSHALL_HOME/agent-key)" localhost:7823/api/running -w ' http %{http_code}\n'; echo exit $?`
Sleep 500ms
Enter
Sleep 3s

Type `human -X POST localhost:7823/api/rooms/rm-1234/close >/dev/null; human -X POST -d '{"ids":["s-checkout-api"],"room":"rm-1234"}' localhost:7823/api/running/invite; echo exit $?`
Sleep 500ms
Enter
Sleep 4s

Sleep 7s

Hide
Type "kill $(lsof -t -iTCP:7823 -sTCP:LISTEN)"
Enter
Sleep 1s
