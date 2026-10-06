# Sample job queue

A made-up queue for tests and tapes. None of these jobs are real.

## Research

| Id  | Job                        | Needs | Status | Owner                     | Worktree | Links |
| --- | -------------------------- | ----- | ------ | ------------------------- | -------- | ----- |
| R91 | How kettles boil water     | none  | done   | agent 2026-01-01 research |          |       |
| R92 | Which teapots pour cleanly | none  | open   |                           |          |       |

## Decisions

| Id  | Job              | Needs | Status | Owner | Worktree | Links |
| --- | ---------------- | ----- | ------ | ----- | -------- | ----- |
| D91 | Pick a tea brand | R91   | open   |       |          |       |
| D92 | Pick a mug size  | R92   | open   |       |          |       |

## Builds

| Id  | Job          | Lane | Branch      | Needs | Status  | Owner                           | Worktree              | Links |
| --- | ------------ | ---- | ----------- | ----- | ------- | ------------------------------- | --------------------- | ----- |
| B91 | Kettle timer | A    | `f1/kettle` | R91   | open    |                                 |                       |       |
| B92 | Mug rack     | B    | `f2/mugs`   | D92   | open    |                                 |                       |       |
| B93 | Tea shelf    | A    | `f1/shelf`  | none  | claimed | agent 2026-01-01 09:00 f1/shelf | `.worktrees/f1-shelf` |       |

## Done log

- 2026-01-01: R91 done, kettles boil at 100C.
