#!/usr/bin/env bash
# Helper for reattach-restart.tape. `restart` restarts the scratch daemon. `claude` runs a real claude -p
# with a seat key that joins, has the daemon restarted, then posts with no join, and prints each tool reply.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
case "$1" in
restart)
  kill "$(lsof -t -iTCP:"$MESSHALL_PORT" -sTCP:LISTEN)" 2>/dev/null || true
  sleep 1
  pnpm -s messhall-dev daemon --keep > /dev/null
  echo "daemon restarted"
  ;;
claude)
  config="$MESSHALL_HOME/tape-mcp.json"
  key="$(cat "$MESSHALL_HOME/agent-key")"
  (umask 077 && printf '{"mcpServers":{"messhall":{"type":"http","url":"http://127.0.0.1:%s/mcp","headers":{"X-Messhall-Key":"%s","X-Messhall-Seat":"tape-seat"}}}}' "$MESSHALL_PORT" "$key" > "$config")
  claude -p --model haiku --allowedTools "mcp__messhall__join mcp__messhall__post Bash($here/reattach-restart.sh restart)" \
    --mcp-config "$config" --strict-mcp-config \
    "Do exactly these steps and nothing else. 1) call the messhall join tool with room demo, as api. 2) call messhall post in room demo with text 'before the restart'. 3) run the bash command: $here/reattach-restart.sh restart 4) call messhall post in room demo with text 'after the restart, no join' and do NOT call join again, even if it errors. Then print one line per step, as 'step N: ' and the first line of that tool's reply, and nothing else."
  ;;
esac
