---
name: messhall-tape-qa
description: Record QA proof for Messhall's CLI, daemon and MCP work with vhs, one tape per QA case. Tapes are committed under demo/tapes/, gifs and mp4s render to the gitignored demo/out/, the gif goes to the qa-assets branch with pnpm messhall-dev qa-upload and into the PR's "QA and Testing" section as a 2-column table (case plus exit code extras, recording). Use when the user says "tape qa", "record the cli", "add a recording to the PR", "vhs the cli", "show the command in the PR", or invokes /messhall-tape-qa.
---

# messhall-tape-qa

Turn each case a PR adds into a vhs recording, upload the gif to the `qa-assets` branch, and put a proof table in the PR's QA section. Scripts live in `.claude/skills/messhall-tape-qa/scripts/`.

## Before you start

- `vhs` on PATH (`brew install vhs`, pulls ttyd and ffmpeg).
- Run tapes from the worktree you are proving, with `pnpm dev <command>` or `pnpm messhall-dev <command>`, so the recording shows the branch and not a global `messhall`.
- A scratch messhall home, never the real data dir (`~/Library/Application Support/messhall`). Every tape carries `Env MESSHALL_HOME "/tmp/messhall-tape-home-<name>"`, and any tape that touches a daemon also `Env MESSHALL_PORT "7797"`. No accounts, no login step.

## 1. Plan the shots

Read the PR's description (`gh pr view <n> -R maximilianfalco/messhall --json body -q .body`). Its "✅ QA and Testing" section and the feature map row's Verify command (`.claude/skills/messhall-control/references/feature-map.md`) list the cases. One tape per case: the command, the directory it runs in, any state it needs.

## 2. Take the shots

Tapes are code: `demo/tapes/<slice>-<case>.tape`, committed. Renders go to `demo/out/`, never committed. The rules are in `demo/tapes/README.md`:

- Keep the `Set` block (zsh, FontSize 18, Width 1400, Height 820, Padding 24, Catppuccin Mocha, TypingSpeed 40ms) so every recording looks the same.
- `Output` both `demo/out/<name>.gif` and `.mp4`.
- `Env MESSHALL_HOME "/tmp/messhall-tape-home-<name>"`, named after the tape. `render.sh` reads this line, so it is required.
- Open with `Hide` / `Type "clear"` / `Enter` / `Show`. End with `; echo exit $?` on the command and a `Sleep` long enough to read the last frame.
- Gifs must stay under 10MB for GitHub. For long takes, `Set Framerate 20` or drop `Height`.

Render from the directory the tape expects (the repo root or worktree unless it says otherwise):

```bash
bash .claude/skills/messhall-tape-qa/scripts/render.sh demo/tapes/<name>.tape
```

It refuses to run unless vhs is on PATH and the tape's `MESSHALL_HOME` is set and is not the real data dir. Then it prints each output with its size. Pull the last frame (`ffmpeg -sseof -0.3 -i demo/out/<name>.mp4 -frames:v 1 "$(mktemp -t last).png"`) and look at it before you upload.

Never record a key file, a real room transcript or anything from the real data dir.

## 3. Upload to GitHub

Push the gifs to the `qa-assets` branch from the repo:

```bash
pnpm -s messhall-dev qa-upload <pr> demo/out/<name>.gif ... >> urls.txt
```

It commits under `pr-<n>/` with git plumbing (your branch and index stay as they are), pushes without force, and prints one `![name](https://github.com/maximilianfalco/messhall/blob/qa-assets/pr-<n>/<file>?raw=true)` per file. `build_qa.py` reads those lines as they are. Never force-push `qa-assets`, it only grows.

## 4. Write the table

Back up the body first (`gh pr view <n> -R maximilianfalco/messhall --json body -q .body > before.md`). Then:

```bash
python3 .claude/skills/messhall-tape-qa/scripts/build_qa.py before.md rows.json urls.txt new.md
gh pr edit <n> -R maximilianfalco/messhall --body-file new.md
```

`rows.json` is `[{"case": "...", "img": "<gif name without .gif>", "extras": ["exit 0", "all checks passed"]}]`. `img` can be a list for side by side images, and `width` sets their size (720 by default). The script writes `| case | recording |` at the end of `# ✅ QA and Testing` (heading lines inside code blocks do not end the section), keeps the section's text, and replaces its own table on a rerun. A row with no url gets `drag demo/out/<img>.gif here`. It escapes `<` / `>` in extras and refuses em dashes.

`--column screenshot` writes a `| case | screenshot |` table for Mac app shots instead.

- Always pass `-R maximilianfalco/messhall`. A `cd` into the scratchpad makes plain `gh` fail.
- Write in the owner's voice: lowercase starts, plain words.

## 5. Check and hand off

Check the rendered body: `gh api repos/maximilianfalco/messhall/issues/<n> -H 'Accept: application/vnd.github.full+json' --jq .body_html | grep -o '<img[^>]*>'` shows each `qa-assets` src inside an `<img>`, not inside a code block. Report the rows, and any case with no recording and why.
