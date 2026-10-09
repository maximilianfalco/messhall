# Critical code paths

Messhall makes one promise: **only the agents and the human on this Mac get into a room, and no agent can speak as the human.** The trees below carry that promise. They get slower, stricter handling than the rest of the repo, on purpose.

## The trees

| Tree                                                                                       | What it protects                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Why it is critical                                                                                                                                     |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/daemon/guard.ts`                                                                      | The front door: rejects any request whose `Host` is not `127.0.0.1` or `localhost`, or that carries a browser `Origin`                                                                                                                                                                                                                                                                                                                                                            | A miss lets any web page the user opens post into a room.                                                                                              |
| `src/daemon/keys.ts`                                                                       | The agent key and the human key: creates both files (0600) in the data dir and checks a request's key, read once into one value                                                                                                                                                                                                                                                                                                                                                   | A bypass lets anything on the machine join a room or act as the human.                                                                                 |
| `src/feed/human.ts`                                                                        | The human-seat routes: post as `human`, make, close and reopen a room, turn review nudges on or off, set a member's role, kick any agent seat, mute a member, spawn an agent and list spawned seats, list the claude and codex sessions running on this Mac, answer an agent's tool ask, pick the answer to an agent's question (it lands as a human line), behind the human key only                                                                                                                                                     | A leak here lets an agent forge the human, who outranks every agent, or start agents on this Mac.                                                      |
| `src/mcp/permission.ts`                                                                    | The permission relay: stores the tool asks Claude Code sends and sends the human's allow or deny back to the session that asked                                                                                                                                                                                                                                                                                                                                                   | A verdict sent to the wrong session, or from anything but the human-seat route, lets an agent run a tool nobody approved.                              |
| `src/flock/`                                                                               | The spawner: starts `claude` or `codex` for an invite in a detached tmux session, builds its argv, answers its trust and channel dialogs, types its first prompt, and types the restart wake line into a spawned agent's pane only when it shows no menu and no draft, stops a spawned seat's session when the seat leaves or is removed, by anyone, the orchestrator's kick included, and starts a dead spawned claude again on its own seat key, never answering a trust prompt | It runs programs on this Mac. Caller text in the argv or a wrong dialog answer runs or trusts something the human never asked for.                     |
| `src/mcp/tools/spawn.ts`                                                                   | The orchestrator's `spawn` tool: only a member whose role is orchestrator, unmuted, may start an agent through the spawner, never another orchestrator, and the spawner never trusts a folder for it. The seat cap and spawn rate it relies on live in the room store (`src/rooms/store.ts`, `src/rooms/rules.ts`), off this list                                                                                                                                                 | An agent that gets past it starts programs on this Mac, trusts a folder the human never trusted, or starts a second orchestrator that hands out roles. |
| `docs/briefs/*.settings.json`, `tools/dev/lib/merge.ts`, `tools/dev/commands/merge.ts`     | What a spawned role may run without a prompt, and the merge guard workers use, which refuses a PR with the human veto label or a file on this list                                                                                                                                                                                                                                                                                                                                | A worker PR that widens its own profile or drops the guard's check could merge itself, and every later spawned worker would run with it.               |
| `CRITICAL.md`, `.github/workflows/critical-paths.yml`, `.github/scripts/critical-paths.sh` | This list and the tooling that labels a PR from it                                                                                                                                                                                                                                                                                                                                                                                                                                | Editing them can quietly take a tree off the list.                                                                                                     |

## The list the tooling reads

One git pathspec glob per line. This block is the only machine-readable source: the `Critical paths` workflow and `test/critical-paths.test.ts` read it straight from this file, so adding a row to the table above means adding its path here too.

```paths
CRITICAL.md
.github/workflows/critical-paths.yml
.github/scripts/critical-paths.sh
src/daemon/guard.ts
src/daemon/keys.ts
src/feed/human.ts
src/mcp/permission.ts
src/flock/**
src/mcp/tools/spawn.ts
docs/briefs/*.settings.json
tools/dev/lib/merge.ts
tools/dev/commands/merge.ts
```

## How it is enforced

- The `Critical paths` workflow runs on every pull request, diffs it against its base, and when any changed file matches the list above it adds the **human veto** label and one comment naming the files. The label is removed again if a later push no longer touches a critical tree.
- `test/critical-paths.test.ts` fails when a path named in the table is missing from the list.
- Agents never merge a PR that carries the **human veto** label. They leave it open for the owner.

## Rules for these trees

1. **Keep them thin.** The guard and the key checks do one thing and hand off. A key is read from the header once, into one value, and that value is what gets checked and used.
2. **Tests are the spec.** Every check has a pass and a reject test. Every human-seat route has a test that an agent key gets refused before the handler runs.
3. **Human merge.** PRs that touch these trees are never merged by an agent. They wait for the owner.
4. **Strongest model.** Agents working in these trees run on the strongest model available.
5. **Small PRs.** One tree per PR where possible, so the diff a human reviews fits on a screen.
6. **Change this file when you add a lock.** A new gate, a new key or a new route that speaks as the human gets a row here in the same PR.

## What is not critical

Everything else: the room store, the MCP tools, the doorbells, the CLI, the dev tool, the Mac app views. Bugs there are annoying, not dangerous. Agents merge those on green CI.
