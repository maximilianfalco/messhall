#!/usr/bin/env bash
# Create or reuse the worktree for a branch, install deps, link the plan in.
# Prints the worktree path on the last line.
set -euo pipefail

BRANCH="${1:?usage: worktree.sh <branch>}"
# The first worktree git lists is the main checkout, even when run from another worktree.
ROOT="$(git -C "$(dirname "$0")" worktree list --porcelain | head -1 | sed "s/^worktree //")"
DIR="$ROOT/.worktrees/${BRANCH//\//-}"

cd "$ROOT"
if [ ! -d "$DIR" ]; then
  if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git worktree add "$DIR" "$BRANCH" >&2
  else
    git fetch --quiet origin main >&2
    git worktree add "$DIR" -b "$BRANCH" --no-track origin/main >&2
  fi
fi

# The plan is gitignored, so every worktree links the main checkout's copy.
NOTES="$ROOT/personal-dev-notes.md"
if [ -f "$NOTES" ] && [ ! -e "$DIR/personal-dev-notes.md" ]; then
  ln -s "$NOTES" "$DIR/personal-dev-notes.md"
fi

CI=1 pnpm --dir "$DIR" install --silent >&2

echo "$DIR"
