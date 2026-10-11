# QA tape for room suggestions: a scratch daemon on 7824 that scans four fake claude sessions. Two sit on main in
# one repo (never grouped), two share a ticket key across repos (grouped).

Output demo/out/suggest-roomless-routes.mp4
Output demo/out/suggest-roomless-routes.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-suggest-roomless"
Env MESSHALL_PORT "7824"
Env MESSHALL_CLAUDE_SESSIONS "/tmp/messhall-tape-home-suggest-roomless/claude-sessions"

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
Type `n=0; for r in shop-a:main shop-a:main checkout-api:rm-1234/order-totals checkout-web:rm-1234/cart-page; do n=$((n+1)); d=$MESSHALL_HOME/code/${r%%:*}; mkdir -p $d; git -C $d init -q -b ${r#*:}; git -C $d -c user.name=t -c user.email=t@example.com commit -q --allow-empty -m init; printf '{"cwd":"%s","pid":%d,"sessionId":"s-%s-%d","status":"idle"}' $d $$ ${r%%:*} $n > $MESSHALL_CLAUDE_SESSIONS/$n.json; done`
Enter
Type `human() { curl -s -H "x-messhall-key: $(cat $MESSHALL_HOME/human-key)" "$@"; }; clear`
Enter
Show

Type "pnpm -s messhall-dev daemon --keep | tail -1; echo exit $?"
Sleep 500ms
Enter
Sleep 5s

Type `human localhost:7824/api/running | jq -c '(.agents[] | {id, repo, branch}), {suggestions}'; echo exit $pipestatus[1]`
Sleep 500ms
Enter
Sleep 5s

Sleep 7s

Hide
Type "kill $(lsof -t -iTCP:7824 -sTCP:LISTEN)"
Enter
Sleep 1s
