# CLAUDE.md

Repo rules for Messhall. The global `~/CLAUDE.md` still applies; these add to it or override it where stated.

## Read first

- The plan lives in the gitignored `personal-dev-notes.md` under "Plan (moved out of the repo)". It is the source of truth for scope and decisions, and its "Engineering standards" section is binding for every change. Read that file first; worktrees link it in.
- `CRITICAL.md` names the code trees that hold the trust promise (the Host/Origin guard, the agent and human keys, the human-seat routes). Changes there wait for the owner to merge and run on the strongest model.
- The `messhall-control` skill (`.claude/skills/messhall-control/`) is how work gets verified: `pnpm messhall-dev check` before any commit, the matching `messhall-dev` command as evidence, and a feature map row for every surface.
- The `messhall-pickup-any-work` skill (`.claude/skills/messhall-pickup-any-work/`) is how work gets picked: claim a row in the job queue, build it in its own worktree, close the row. Spawned with no brief? Run that skill.
- The `using-messhall` skill (`.claude/skills/using-messhall/`) is how an agent takes part in a room: converse, ask, answer, hand over, not just status lines. Spawned agents read it before joining.
- The `messhall-tape-qa` skill (`.claude/skills/messhall-tape-qa/`) is how QA proof gets recorded: one vhs tape per case, uploaded with `pnpm messhall-dev qa-upload`, a table in the PR.

## Branches, commits, pushes

- `main` is the only long-lived branch. Never build on it.
- One branch per job, named after the slice: `f1/store`, `f2/mcp-tools`. Commit on the branch as often as useful (this overrides the global "no automatic commits" rule for this repo).
- Work runs in git worktrees under `.worktrees/<name>` (gitignored): `git worktree add .worktrees/f1-store -b f1/store --no-track origin/main`, then `pnpm install` and link `personal-dev-notes.md` in. Remove the worktree after the merge.
- Push a branch once, when the gate is green. Open the PR, let CI run once, then squash-merge with `gh pr merge <n> --squash --admin` (never a merge commit or a rebase onto `main`). `main` has a ruleset: PRs only, squash only, one code owner review, signed commits, no force push. The owner merges through the admin bypass, which is why `--admin` is needed. When `main` moves under an open branch, `git merge origin/main` into it. Never rebase or force-push a pushed branch.
- Merge without asking when CI is green, except PRs that touch a `CRITICAL.md` tree (they get the **human veto** label): those wait for the owner.
- Commit and PR titles are title-only conventional commits. No bodies, no AI credit.
- Job queue row ids live in the queue and the vault only. Never write them in commits, PR titles or bodies, or any tracked file. Name the thing instead: "the room store".

## PRs

- Fill every section of `.github/pull_request_template.md`. The One Liner is plain words. Key Decisions lists every `decided by agent, veto here` item. Never tick checkboxes meant for the owner, never tag anyone, never reference other PRs by number.
- Every PR carries QA proof. CLI, daemon and MCP work gets a vhs recording (`demo/tapes/`, rules in `demo/tapes/README.md`); the Mac app gets screenshots. Images go to the `qa-assets` branch under `pr-<n>/` and into a `| case | recording |` table at the end of "QA and Testing".
- Write in the owner's voice: lowercase starts, `dont` not `don't`, `we` not `I`, no em dashes, no semicolons.

## Data

- Everything is local. The daemon binds `127.0.0.1`, nothing goes to a cloud, and no room data ever lives in the repo.
- The daemon is the only SQLite writer. The CLI and the Mac app talk to the daemon, never to the database file.
- The agent key and the human key are files in the data dir with mode 0600. Never print them, log them or paste them in chat.
