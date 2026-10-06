# Demo tapes

`vhs` tapes that record the CLI as QA proof for a PR. Tapes are code and get committed. Renders go to `demo/out/`, which is gitignored.

## Rules

- One tape per case: `demo/tapes/<slice>-<case>.tape`.
- Copy the `Set` block from an existing tape: zsh, FontSize 18, Width 1400, Height 820, Padding 24, Catppuccin Mocha, TypingSpeed 40ms.
- `Output` both `demo/out/<name>.gif` and `demo/out/<name>.mp4`.
- Open with `Hide`, `Type "clear"`, `Enter`, `Show`, so the take starts on a clean screen.
- End every command with `; echo exit $?` so the exit code is on screen.
- Finish with a `Sleep` long enough to read the last frame.
- Every tape sets a home of its own, `Env MESSHALL_HOME "/tmp/messhall-tape-home-<name>"`, and any tape that touches a daemon also sets its own `Env MESSHALL_PORT` from 7770 to 7799 (grep `demo/tapes` for a free one first), so parallel jobs never share a take. Never the real data dir or port.
- Keep gifs under 10MB, or GitHub refuses them. Lower `Height` or `Framerate` if one grows past it.
- Look at the last frame before you upload: `ffmpeg -sseof -0.3 -i demo/out/<name>.mp4 -frames:v 1 /tmp/last.png`.

## Render and upload

The `messhall-tape-qa` skill (`.claude/skills/messhall-tape-qa/`) is the full flow. In short, from the repo root or the worktree:

```
bash .claude/skills/messhall-tape-qa/scripts/render.sh demo/tapes/<name>.tape
pnpm -s messhall-dev qa-upload <pr> demo/out/<name>.gif >> urls.txt
python3 .claude/skills/messhall-tape-qa/scripts/build_qa.py before.md rows.json urls.txt new.md
```

`render.sh` refuses a tape without an `Env MESSHALL_HOME` line or one that points at the real data dir. `qa-upload` pushes the gif to the `qa-assets` branch under `pr-<n>/` with git plumbing, so the working branch never changes. `build_qa.py` writes the `| case | recording |` table at the end of the PR's "QA and Testing" section.
