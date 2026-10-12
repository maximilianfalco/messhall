# QA tape for invites with no copy and paste: a real haiku claude started by hand in a tmux pane on a scratch tmux
# server, a scratch daemon on 7934 that scans only that session, and the human invites it. Its line is typed into the
# pane, and the claude joins by itself.

Set Shell zsh
Set FontSize 16
Set Width 1400
Set Height 860
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Output demo/out/invite-auto-tmux.mp4
Output demo/out/invite-auto-tmux.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-invite-auto"
Env MESSHALL_PORT "7934"
Env MESSHALL_CLAUDE_SESSIONS "/tmp/messhall-tape-home-invite-auto/claude-sessions"
Env TMUX_TMPDIR "/tmp/messhall-tape-tmux-invite-auto"

Hide
Type "unset TMUX; setopt no_monitor no_notify; rm -rf $MESSHALL_HOME /tmp/messhall-tape-invite-api; mkdir -p $MESSHALL_CLAUDE_SESSIONS $TMUX_TMPDIR /tmp/messhall-tape-invite-api; git -C /tmp/messhall-tape-invite-api init -q -b rm-9/api; git -C /tmp/messhall-tape-invite-api -c user.name=t -c user.email=t@example.com commit -q --allow-empty -m init; pnpm -s messhall-dev daemon --keep > /dev/null"
Enter
Sleep 8s
Type `human() { curl -s -H "x-messhall-key: $(cat $MESSHALL_HOME/human-key)" -H 'content-type: application/json' "$@" -w ' http %{http_code}\n'; }; printf '{"mcpServers":{"messhall":{"type":"http","url":"http://127.0.0.1:7934/mcp","headers":{"X-Messhall-Key":"%s"}}}}' "$(cat $MESSHALL_HOME/agent-key)" > $MESSHALL_HOME/mcp.json`
Enter
Type `tmux new-session -d -s api -x 200 -y 50 -c /tmp/messhall-tape-invite-api 'claude --model haiku --strict-mcp-config --mcp-config /tmp/messhall-tape-home-invite-auto/mcp.json --allowedTools mcp__messhall'`
Enter
Type `until f=$(grep -l messhall-tape-invite-api ~/.claude/sessions/*.json 2>/dev/null) && grep -q '"status":"idle"' $f; do tmux capture-pane -p -t api | grep -q 'trust this folder' && tmux send-keys -t api Down Enter; sleep 1; done; ln -s $f $MESSHALL_CLAUDE_SESSIONS/; sleep 3; clear`
Enter
Wait@180s
Show

Type `human localhost:7934/api/running | sed 's/ http 200$//' | jq -c '.agents[] | {repo, branch, reach, status}'; echo exit $pipestatus[1]`
Sleep 500ms
Enter
Sleep 4s

Type `human -X POST -d "{\"ids\":[\"$(human localhost:7934/api/running | sed 's/ http 200$//' | jq -r '.agents[0].id')\"],\"room\":\"demo\"}" localhost:7934/api/running/invite | sed 's/ http 200$//' | jq -c '.invites[] | {name, outcome, why}'; echo exit $pipestatus[1]`
Sleep 500ms
Enter
Sleep 6s

Type "until pnpm -s messhall-dev room demo 2>/dev/null | grep -q 'api joined'; do sleep 2; done; pnpm -s messhall-dev room demo | tail -4; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@180s /exit [0-9]/
Sleep 3s

Type "tmux capture-pane -p -t api | grep -E 'invites you|join' | head -3; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 8s

Hide
Type "tmux kill-session -t api; kill $(lsof -t -iTCP:7934 -sTCP:LISTEN)"
Enter
Sleep 1s
