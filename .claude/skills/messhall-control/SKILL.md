---
name: messhall-control
description: Verification and control skill for the Messhall repo. Use it to prove a change works before calling it done, to reproduce a vague report, to find how a surface is reached, or before any commit. Triggers on "check as we go", "does it work", "verify", "run it", "reproduce this", "feature map", "what surfaces exist", "before commit", and after building or changing any CLI command, MCP tool, daemon route, feed event or dev command. Pairs a local dev CLI (pnpm messhall-dev) that gathers evidence with a feature map that records every surface, how to reach it, and how to verify it.
---

# Messhall control

Two parts, used together:

1. **`pnpm messhall-dev <command>`**, a local dev CLI in `tools/dev/`. Run it instead of writing one-off scripts, so evidence is reproducible across sessions. When it cannot check something you need, extend it rather than working around it.
2. **The feature map**, `references/feature-map.md`. Materialized memory of every surface: how a user or agent reaches it, what it does, where the code is, its status, and the dev command that verifies it. Read it before touching a surface, and update it in the same commit that changes one.

## The loop

1. Find the row in the feature map. If the surface is new, add the row first with status `building`. Flip a `planned` row to `building` when you start it.
2. Build with tests first (`/tdd`).
3. Run `pnpm messhall-dev check`. It runs format, lint, types, tests and the feature map check in parallel. Nothing ships while it is red.
4. Exercise the surface with the command in the row's Verify column. Paste the evidence (the table or the response) into your reply and the PR, not a claim.
5. Flip the row to `built`, fix its Code and Verify cells, then `pnpm messhall-dev featuremap --check`.
6. Commit. The commit title is the feature, the evidence lives in the reply and the PR.

## Commands

| Command | Evidence it gives |
|---|---|
| `pnpm messhall-dev check` | format, lint, types, tests and the feature map check, as one pass/fail table with the tail of each failed step. Exit 1 on any failure |
| `pnpm messhall-dev featuremap [--check]` | row counts by status, and every `built` or `building` row whose code paths are missing. `--check` exits 1 on drift |
| `pnpm messhall-dev env` | node, pnpm, `claude --version` and whether it has Channels (2.1.80+), `codex --version`, the data dir, the daemon's `/health` on `MESSHALL_PORT` or 7707, and whether the Claude Code and Codex messhall entries are present |
| `pnpm messhall-dev qa-upload <pr> <files...>` | commits gifs or screenshots to the `qa-assets` branch under `pr-<n>/` without touching your branch, prints one markdown image per file |
| `pnpm messhall-dev db "<sql>" [--data-dir <d>]` | a read-only query against a `messhall.db`, rows as a table. A write fails |
| `pnpm messhall-dev daemon [--keep]` | `messhall daemon` from source on `MESSHALL_HOME` (else a temp dir) and `MESSHALL_PORT` (else a free port): its url, pid, data dir and `/health` body. Stops it unless `--keep` |
| `pnpm messhall-dev room <name> [--data-dir <d>]` | a room's members with presence and cursor, and its last messages, read only from the daemon's data dir |
| `pnpm messhall-dev store [--data-dir <d>]` | a scripted join, post, read, done, leave and presence sweep on a scratch room store with a fake clock, then its rooms, members, messages and event counts |
| `pnpm messhall-dev mcp [--tool <name> --input '<json>' --as <role> --room <room>]` | the MCP server over an in-memory client: instructions, each tool's title, annotations, fields and description length against the budget. With `--tool`, one call's text and `isError` |
| `pnpm messhall-dev agent <role> --room <r> [--say <text>] [--wait] [--url <u>] [--key-file <f>]` | a scripted agent over real HTTP MCP on a running daemon: join, post, wait, read, each reply and how long `wait` blocked |
| `pnpm messhall-dev feed [--room <r>] [--url <u>] [--since <seq>] [--count <n>]` | the live SSE feed of the running daemon, read with the human key: a `snapshot` line, then one line per `message`, `member`, `presence` or `room` event with its sequence. `--since` replays from the event log instead. Exits after `--count` lines or on ctrl-c |
| `pnpm messhall-dev demo [--agents 2] [--keep] [--dry-run] [--timeout 240]` | two real Claude Code sessions in two temp repos agree a contract change through one room: a pass or fail row per step with its time, the room checks, both repo tests, the transcript, tokens per agent and the wall time. Exit 1 on any failed row |
| `pnpm messhall-dev schema` | writes `contracts/schema.json` from the zod contracts (also `pnpm schema` and `pnpm build`). A test fails when the committed file is stale |

The rest (`channel`, `codex`) land with the feature they verify. Their rows in the Dev tool section of the feature map are `planned` and say what each will prove. Add the dev command before the surface it verifies.

`scripts/messhall-dev` is a shell wrapper for the same tool, for use from any directory.

## Feature map rules

- One row per surface a user or agent can reach. Columns: Feature, Reach, Does, Code, Status, Verify.
- Reach is literal: the exact command and flags, the MCP tool name and inputs, the HTTP method and route.
- Code cells hold backticked repo paths. `featuremap --check` fails when a `built` or `building` row points at a path that does not exist. A `planned` row names where the code will live.
- Status is one of `planned`, `building`, `built`, `cut`. Nothing else parses.
- Verify names a `messhall-dev` command. If no command can verify the row, add one to the tool first.
- No pipe characters inside a cell, the parser splits on them. Write "or" instead.

## Gardener rule

When you correct a pattern in review or in your own work, do not stop at the fix. In this order: make the pattern impossible in the codebase (a type, a single paved helper), then a lint rule in `oxlint.config.ts`, then a line in the plan's "Engineering standards" in `personal-dev-notes.md`. A comment explaining a workaround is the start of a virus, not a fix.
