#!/usr/bin/env bash
# Scratch daemon and mcp config for the join prompt tapes: $1 is the home, $2 the port.
set -euo pipefail
home="$1"
port="$2"
rm -rf "$home" && mkdir -p "$home"
MESSHALL_HOME="$home" MESSHALL_PORT="$port" pnpm -s messhall-dev daemon --keep > /dev/null
key="$(cat "$home/agent-key")"
printf '{"mcpServers":{"messhall":{"headers":{"x-messhall-key":"%s"},"type":"http","url":"http://127.0.0.1:%s/mcp"}}}' "$key" > "$home/mcp.json"
chmod 600 "$home/mcp.json"
mktemp -d > "$home/cwd"
