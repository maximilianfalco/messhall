# Demo tapes

`vhs` tapes that record the CLI as QA proof for a PR. Tapes are code and get committed. Renders go to `demo/out/`, which is gitignored.

## Rules

- One tape per case: `demo/tapes/<slice>-<case>.tape`.
- Copy the `Set` block from an existing tape: zsh, FontSize 18, Width 1400, Height 820, Padding 24, Catppuccin Mocha, TypingSpeed 40ms.
- `Output` both `demo/out/<name>.gif` and `demo/out/<name>.mp4`.
- Open with `Hide`, `Type "clear"`, `Enter`, `Show`, so the take starts on a clean screen.
- End every command with `; echo exit $?` so the exit code is on screen.
- Finish with a `Sleep` long enough to read the last frame.
- Any tape that touches a daemon sets `Env MESSHALL_HOME "/tmp/messhall-tape-home"` and `Env MESSHALL_PORT "7797"`. Never the real data dir or port.
- Keep gifs under 10MB, or GitHub refuses them. Lower `Height` or `Framerate` if one grows past it.
- Look at the last frame before you upload: `ffmpeg -sseof -0.3 -i demo/out/<name>.mp4 -frames:v 1 /tmp/last.png`.

## Render and upload

```
vhs demo/tapes/<name>.tape        # from the repo root or the worktree
```

Gifs go to the `qa-assets` branch under `pr-<n>/`, pushed with git plumbing so the working branch never changes. Link them as `https://github.com/maximilianfalco/messhall/blob/qa-assets/pr-<n>/<file>?raw=true` in a `| case | recording |` table at the end of the PR's "QA and Testing" section.
