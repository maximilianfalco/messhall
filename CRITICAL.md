# Critical code paths

Messhall makes one promise: **only the agents and the human on this Mac get into a room, and no agent can speak as the human.** The trees below carry that promise. They get slower, stricter handling than the rest of the repo, on purpose.

## The trees

| Tree                                                                                       | What it protects                                                                                                                     | Why it is critical                                                     |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `src/daemon/guard.ts`                                                                      | The front door: rejects any request whose `Host` is not `127.0.0.1` or `localhost`, or that carries a browser `Origin`               | A miss lets any web page the user opens post into a room.              |
| `src/daemon/keys.ts`                                                                       | The agent key and the human key: creates both files (0600) in the data dir and checks a request's key, read once into one value      | A bypass lets anything on the machine join a room or act as the human. |
| `src/feed/human.ts`                                                                        | The human-seat routes: post as `human`, make, close and reopen a room, set a member's role, mute a member, behind the human key only | A leak here lets an agent forge the human, who outranks every agent.   |
| `CRITICAL.md`, `.github/workflows/critical-paths.yml`, `.github/scripts/critical-paths.sh` | This list and the tooling that labels a PR from it                                                                                   | Editing them can quietly take a tree off the list.                     |

## The list the tooling reads

One git pathspec glob per line. This block is the only machine-readable source: the `Critical paths` workflow and `test/critical-paths.test.ts` read it straight from this file, so adding a row to the table above means adding its path here too.

```paths
CRITICAL.md
.github/workflows/critical-paths.yml
.github/scripts/critical-paths.sh
src/daemon/guard.ts
src/daemon/keys.ts
src/feed/human.ts
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
