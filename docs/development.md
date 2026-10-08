# Development

```bash
pnpm messhall-dev check     # format, lint, types, tests and the feature map, the gate before any commit
pnpm messhall-dev --help    # daemon, room, agent, feed, channel, codex and demo commands for verifying by hand
make check                  # the same gate without the dev CLI
```

`main` is protected: pull requests only, squash merges, CI green. Every change ships with QA proof, a vhs recording for CLI, daemon and MCP work (`demo/tapes/`) or screenshots for the app. [`CLAUDE.md`](../CLAUDE.md) has the repo rules and [`CRITICAL.md`](../CRITICAL.md) names the trees that hold the trust promise.
