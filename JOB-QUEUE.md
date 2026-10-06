# Local job queue

One markdown note that holds every open job, so any agent (or person) can be pointed at it and pick up work without a briefing. Messhall keeps its queue in the maintainer's notes folder, outside the repo, and finds it through the gitignored `personal-dev-notes.md`. Copy the idea for your own setup: the format is plain markdown tables and the repo skill `/messhall-pickup-any-work` reads and edits them.

## Why a queue and not a tracker

- **One click to spawn work.** An agent runs the skill, claims the first ready row and goes. No ticket triage, no chat brief.
- **Parallel by construction.** Jobs are split into lanes that share no code. Two agents in different lanes never collide.
- **Claims are visible.** A claimed row names its owner and its worktree, so a second agent can skip it or read its unmerged code to adapt.
- **It lives with your notes**, not in the repo, so plans and half-decisions stay private while the code stays public.

## Set it up

1. Create a note anywhere, for example `<your notes>/Messhall - Job Queue.md`.
2. Copy `personal-dev-notes.example.md` to `personal-dev-notes.md` and put the note's absolute path on the **Job queue** line, in backticks.
3. Fill the note with the sections below. The skill only needs the job tables; the rest is for humans.

## Format

Any table whose first header is `Id` is a job table, and the scripts read every one. Messhall uses three: Research (a background agent against primary docs), Decisions (a human choice, or a ticket's recommendation with a veto on the PR) and Builds (code). Columns the scripts read: `Id`, `Job`, `Needs`, `Status`, `Owner`, `Worktree`, `Links`, and for builds `Lane` and `Branch`. The ids below are examples.

```markdown
## Research

| Id  | Job                          | Needs | Status | Owner | Worktree | Links           |
| --- | ---------------------------- | ----- | ------ | ----- | -------- | --------------- |
| R80 | How the SDK streams progress | none  | open   |       |          | [[ticket note]] |

## Decisions

| Id  | Job                  | Needs | Status | Owner | Worktree | Links           |
| --- | -------------------- | ----- | ------ | ----- | -------- | --------------- |
| D80 | Message size cap     | none  | open   |       |          | [[ticket note]] |
| D81 | Progress event shape | R80   | open   |       |          | [[ticket note]] |

## Builds

| Id  | Job                         | Lane | Branch        | Needs    | Status | Owner | Worktree | Links |
| --- | --------------------------- | ---- | ------------- | -------- | ------ | ----- | -------- | ----- |
| B80 | Message cap in the store    | A    | `f1/cap`      | D80      | open   |       |          |       |
| B81 | Progress events on the feed | B    | `f3/progress` | D81, B80 | open   |       |          |       |

## Done log

- 2026-10-06: R80 done, progress arrives every 30s, verified against the SDK docs.
```

- **Needs** is a comma-separated list of other Ids, or `none`. A job is ready when its Status is `open` and every Id in Needs is `done`.
- **Status** is one of `open`, `claimed`, `done`.
- **Owner** is free text: who and when, for example `agent 2026-10-06 14:10 f1/cap`.
- **Worktree** is the checkout the job is being built in, for example `` `.worktrees/f1-cap` ``. Empty once the job is done.
- **Lane** groups builds that share code. Take jobs from different lanes when running agents in parallel. Rows without a lane show their table's name instead.
- **Branch** is the git branch for a build. One branch per job, squash-merged.
- **Done log** gets one dated line per finished job, oldest first.

A decision can name a prototype that lands inside a build, in which case both rows point at the same worktree.

## Protocol

1. Pick the first ready row. Never hold two.
2. Claim it before any work so a parallel agent skips it.
3. Build in the row's worktree, follow the repo rules, open one PR with QA proof.
4. Close the row with the PR link and one line of evidence in the Done log.
5. Anything that named it in Needs is now ready.

If you cannot finish, put the row back to `open` and clear Owner and Worktree. A claimed row with nobody on it blocks a lane for everyone.

## Scripts

`.claude/skills/messhall-pickup-any-work/scripts/queue.py` implements `path`, `show [--all]`, `claim`, `release` and `done` against this format. `scripts/worktree.sh <branch>` creates the worktree from `origin/main`, installs deps and links `personal-dev-notes.md` from the main checkout. Both only need Python 3, git and pnpm.

## Seated agents

`pnpm messhall-dev spawn <id> [--room dev] [--model opus] [--brief <file>] [--dry-run]` runs one ready row as an interactive Claude Code in tmux session `messhall-<id>`: it claims the row, makes the worktree, starts claude with the messhall dev channel and types a first prompt. `pnpm messhall-dev spawn agent --as <name>` seats one with no row in `messhall-seat-<name>`. Every seated agent joins the room, says hello and waits for a role. The orchestrator (or the human) gives it with the `assign_role` tool, with instructions the agent reads through `my_role`, and one line in the room. Messhall holds no role behaviour: `docs/briefs/` has example instructions (worker with the review gate, reviewer, orchestrator) that the orchestrator owns and may edit per room. `pnpm messhall-dev flock` lists the running sessions, whether each agent is seated and its role, `flock stop <id or name>` kills one, `pnpm messhall-dev reviews` lists open review requests. The pickup skill's "Spawning seated agents" section has the details.
