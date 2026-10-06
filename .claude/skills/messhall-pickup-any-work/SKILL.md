---
name: messhall-pickup-any-work
description: Pick up the next open job from Messhall's local job queue and work it end to end in its own worktree. Use it when spawned with no other brief, or on "pick up any work", "take a job", "what's open", "work the queue", "claim <id>". Optional argument narrows the pick, a job id, a lane (A, B, C) or a slice (f0, f1). Claims the row before any work, sets up the worktree, builds per the repo rules, opens the PR with QA proof, merges, closes the row.
---

# Messhall: pick up any work

The queue is a markdown note outside the repo. Its path is the **Job queue** line in the gitignored `personal-dev-notes.md` at the repo root. Never write that path into any tracked file. `JOB-QUEUE.md` at the repo root explains the format for anyone setting up their own.

The note has three job tables (Research, Decisions, Builds). The scripts read all of them. Two scripts do the fragile parts. Run them from the main checkout or any worktree; both resolve the main checkout, so every agent edits the same note:

| Script | Does |
|---|---|
| `scripts/queue.py path` | prints the queue note's path |
| `scripts/queue.py show [--all]` | open jobs whose Needs are all done, across every table (or every row) |
| `scripts/queue.py claim <id> "<owner>" <worktree>` | flips the row to `claimed`, refuses if it is not open or still blocked |
| `scripts/queue.py release <id>` | hands a job back if you cannot finish it |
| `scripts/queue.py done <id> <pr-url> "<evidence>"` | flips the row to `done`, clears Worktree, appends a dated line to the end of the Done log |
| `scripts/worktree.sh <branch>` | creates or reuses `.worktrees/<branch with / as ->` from `origin/main` with `--no-track`, runs `pnpm install`, symlinks `personal-dev-notes.md` to the main checkout's, prints the path |

## The loop

1. **Read** `CLAUDE.md`, `personal-dev-notes.md` ("Plan (moved out of the repo)": "Engineering standards" plus the feature's section and every "Decided" line in it) and the feature map in `.claude/skills/messhall-control/references/feature-map.md`.
2. **Pick.** `python3 .claude/skills/messhall-pickup-any-work/scripts/queue.py show`. Take the first ready row that matches the argument, if any. Prefer a build over a decision, and prefer the job that unblocks the most rows (the queue's "Start here today" section says which). Never take two.
3. **Claim.** Owner is `agent <YYYY-MM-DD HH:MM> <branch>`. Worktree is `.worktrees/<branch with / as ->`. A decision with no branch uses the worktree of the first build that names it in Needs.
   ```bash
   python3 .claude/skills/messhall-pickup-any-work/scripts/queue.py claim <id> "agent 2026-10-06 14:10 f1/store" .worktrees/f1-store
   ```
   If `claim` refuses, someone else has it or it is still blocked. Run `show` again and pick another.
4. **Worktree.** `bash .claude/skills/messhall-pickup-any-work/scripts/worktree.sh <branch>`, then `cd` to the path it prints. Everything from here runs inside the worktree.
5. **Decisions.** A decision ticket lives in the tickets folder named in `personal-dev-notes.md`. When the user is in the session, resolve it with them, one question at a time with a recommendation. When spawned alone, take the recommendation already in the ticket, or the simplest option a demo can show. Write the answer into the plan in `personal-dev-notes.md` as plain decision text with no process notes (never a "Decided by agent" line in any tracked file), and into the ticket (`status: done`, a `## Answer` section whose first line is `Decided by agent, veto on the PR`, which stays in the vault). Flag it for veto in the PR body's Key Decisions section only. Close the row with `done` and carry straight on into the build it unblocks, claiming that row too.
6. **Build** per `messhall-control`: feature map row first with status `building`, TDD (`/tdd`), `pnpm messhall-dev check` green, run the row's Verify command and keep the evidence, flip the row to `built`. Commit as often as useful on the branch. Push once (`git push -u origin <branch>`).
7. **PR** with `/my-pr`, filling every section of `.github/pull_request_template.md` (One Liner in plain words, Changes as intent not diff, Impact, Key Decisions & Notes with any `decided by agent, veto here` items, QA and Testing with the `messhall-dev` evidence). Every PR carries QA proof via `messhall-tape-qa`: CLI, daemon and MCP work gets a vhs recording, the Mac app gets screenshots. Upload them with `pnpm -s messhall-dev qa-upload <pr> <files...>`, which prints one url per file, and end "QA and Testing" with a `| case | recording |` (or `| case | screenshot |`) table.
8. **Role instructions win.** A seated agent follows the instructions its role carries (`my_role`). When they hold a review gate (the example `docs/briefs/worker.md` does), it beats the merge step below.
9. **Merge** when CI is green (and approved, when your role instructions say so). First `gh pr view <n> --json labels --jq '.labels[].name'`: if `human veto` is present, STOP, the PR waits for the owner (the `Critical paths` workflow adds it when the diff touches a `CRITICAL.md` tree). Otherwise `gh pr merge <n> --squash --admin` (the `main` ruleset wants a code owner review, and the owner's admin bypass is how a green PR merges), and ONLY if that command succeeded, `git push origin --delete <branch>`. Never chain the delete with `;` or `&&` on one line before checking: a failed merge plus a delete closes the PR for good. `--delete-branch` aborts inside a worktree, so delete by hand. If `main` moved while you built, `git fetch origin && git merge origin/main` into your branch and resolve the conflicts there (never rebase or force-push a pushed branch), because a conflicting PR never gets a CI run.
10. **Close.** `queue.py done <id> <pr-url> "<one line: what shipped and how it was verified>"`. A seated worker runs this itself, it does not wait for the orchestrator. Remove the worktree after the merge with `git worktree remove .worktrees/<name>` from the main checkout. Leave it in place while a PR waits for the owner.

## Spawning seated agents

A subagent with no messhall tools works out of sight. `pnpm messhall-dev spawn` instead runs a real Claude Code session that sits in the room the whole time, so the human sees it, reads its progress and can ring it mid-job.

```bash
pnpm messhall-dev spawn <id> --dry-run                 # print the claim, worktree, claude line and prompt
pnpm messhall-dev spawn <id> --brief <file>            # claim, worktree, claude in tmux session messhall-<id>
pnpm messhall-dev spawn <id> --assign worker --instructions docs/briefs/worker.md  # and give it the role once it joins
pnpm messhall-dev spawn agent --as reviewer-1          # a seat with no row, tmux session messhall-seat-reviewer-1
pnpm messhall-dev flock                                # sessions, panes, rows, branches, pids, seated or not, role
pnpm messhall-dev flock stop <id or name>              # kill one, then queue.py release <id> if a row is unfinished
pnpm messhall-dev agent orchestrator --room dev --say '@reviewer-1 your role: reviewer' \
  --assign reviewer-1=reviewer --instructions docs/briefs/reviewer.md
```

- `spawn <id>` refuses a row that is not `open` or still waits on a need, so it follows the same rules as `claim`. It claims the row and makes the worktree before claude starts, so the agent skips those steps.
- Flags: `--room dev` (where the agent sits), `--model opus`, `--brief <file>` (the row's brief, else the pickup skill), `--dry-run`. A seat takes `--as <name>`.
- **Roles come after the join, with their instructions.** Every seated agent joins as its branch slug (`f8/spawn` sits as `f8-spawn`) or its `--as` name, posts a hello line and waits for a role from `orchestrator` or `human`. It reads the role and its instructions with `my_role` and follows them, asks `@orchestrator what is my role?` after 2 minutes, and calls `my_role` again whenever a role line mentions it. Only the human seat or a member whose role is `orchestrator` can set roles, and a member named `orchestrator` gets that role on join.
- The spawn prompt only seats the agent: no row id, branch or job words. The row, branch and worktree reach it only through its role instructions, which spawn writes to `<data dir>/spawn/<id>-role.md`. With `--assign <role>` spawn sets the role after the join, otherwise it prints the `messhall-dev agent orchestrator --assign` line to run. An agent that has not joined in 2 minutes is reported.
- The spawn prompt holds no role behaviour. `docs/briefs/worker.md` (the review gate), `reviewer.md` and `orchestrator.md` are example instructions the orchestrator owns, may edit per room and passes with `assign_role`.
- It targets the real daemon and room on purpose. Watch one with `tmux attach -t messhall-<id>`. Mention it from the room to steer it.
- If claude never comes up (login screen, timeout), `spawn` kills the session and releases the row.

## Never speak as the human

- Talk in a room only through your own MCP seat (`join`, `post`, `wait`). `messhall post` and `messhall-dev agent` join as a script, so the room shows you as `script`, not `claude`.
- Never post as `human`: no `messhall say`, never read the human key, never call a human-seat route. A `human` line carries the owner's authority, so an agent faking one breaks the trust model.
- To try a surface, use your own name on the real daemon or a scratch daemon (`pnpm messhall-dev daemon`, and `--url` on the command you test).

## Review gate (the example worker and reviewer instructions)

1. Once CI is green the worker posts `ready for review: <PR url> @reviewer-1` and calls `wait`.
2. The reviewer pulls the PR into `.worktrees/review-<n>` (detached), runs `pnpm messhall-dev check`, reads the PR body and its QA proof, reviews against `CLAUDE.md`, `CRITICAL.md`, the plan's engineering standards and the `mock-anand-review` lens, then posts a numbered list (blockers, should-fix, nits, under 1,500 chars) mentioning the worker and files the same as a GitHub review. It never writes code, pushes or merges.
3. The worker fixes, pushes and posts `round N: <PR url> @reviewer-1`. It merges only after `approved @<worker> <PR url>` or a human go.
4. Round 3 without approval: the reviewer posts `@human stuck on <PR url>, round 3` and both stop on that PR.
5. With two reviewers the named one answers. `pnpm messhall-dev reviews` marks a request `stale` after 10 minutes with no answer, and the other reviewer takes it.
6. A PR that touches a `CRITICAL.md` tree still waits for the human after approval.

## Queue ids stay in the queue

Row ids never appear in commits, PR titles or bodies, `CRITICAL.md`, the feature map or any tracked file. Write "the room store" or "the doorbell decision" instead. The queue note and the vault tickets are the only places ids belong.

## Cross-checking another lane

Your job may depend on unmerged code. The queue's Worktree column says where every claimed job lives, and `git worktree list` shows the rest.

- Read files, run `pnpm test` or `git log` in that worktree to learn the real shape (a table, a zod schema, a helper's signature) and adapt to it.
- Never commit, stash or check out in another job's worktree.
- If you build on unmerged work, say which branch in the PR description and merge `origin/main` into your branch once it merges. If it changed under you, adapt on your branch, do not edit theirs.
- If the other job is `done` and merged, `git merge origin/main` in your worktree and take the merged code instead.

## If you get stuck

Release the job (`queue.py release <id>`) with a line in the reply saying why, so the next agent does not repeat the dead end. Never leave a row `claimed` with nobody on it.
