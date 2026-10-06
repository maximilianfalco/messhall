#!/usr/bin/env bash
# One raw initialize on the scratch daemon. Prints the revision it answered and the channel capability.
# Usage: protocol-0326-init.sh <revision> <client name>
set -euo pipefail
key="$(cat "$MESSHALL_HOME/agent-key")"
body=$(printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"%s","capabilities":{},"clientInfo":{"name":"%s","version":"0"}}}' "$1" "$2")
curl -s "http://127.0.0.1:$MESSHALL_PORT/mcp" -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' -H "X-Messhall-Key: $key" -d "$body" |
  grep -oE '"protocolVersion":"[^"]+"|claude/channel' | tr '\n' ' '
echo
