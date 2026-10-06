#!/usr/bin/env python3
"""Read and edit the Messhall job queue note.

The queue path comes from the gitignored personal-dev-notes.md at the repo
root, so the vault is never named in the repo. Every table whose first header
is Id is a job table (Research, Decisions, Builds), and its rows are jobs.

Usage:
  queue.py path
  queue.py show                       open jobs whose Needs are all done
  queue.py show --all                 every row with its status
  queue.py claim <id> <owner> [worktree]
  queue.py release <id>
  queue.py done <id> <link> <evidence>
"""

from __future__ import annotations

import re
import subprocess
import sys
from datetime import date
from pathlib import Path


def main_checkout() -> Path:
    """The first worktree git lists is the main one, even when run from another worktree."""
    here = Path(__file__).resolve().parent
    out = subprocess.run(["git", "-C", str(here), "worktree", "list", "--porcelain"], capture_output=True, text=True)
    first = out.stdout.splitlines()[0] if out.returncode == 0 and out.stdout else ""
    return Path(first.removeprefix("worktree ")) if first.startswith("worktree ") else here.parents[3]


REPO = main_checkout()
NOTES = REPO / "personal-dev-notes.md"


def die(msg: str) -> None:
    print(f"queue: {msg}", file=sys.stderr)
    sys.exit(1)


def queue_path() -> Path:
    if not NOTES.exists():
        die("personal-dev-notes.md is missing at the repo root. Copy personal-dev-notes.example.md and fill it in.")
    for line in NOTES.read_text().splitlines():
        if "job queue" in line.lower():
            match = re.search(r"`([^`]+)`", line)
            if match:
                return Path(match.group(1)).expanduser()
    die("no `Job queue` line with a backticked path in personal-dev-notes.md")
    raise AssertionError


class Row:
    def __init__(self, index: int, headers: list[str], line: str, section: str) -> None:
        self.index = index
        self.headers = headers
        self.section = section
        self.cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        while len(self.cells) < len(headers):
            self.cells.append("")

    def get(self, name: str) -> str:
        return self.cells[self.headers.index(name)]

    def set(self, name: str, value: str) -> None:
        self.cells[self.headers.index(name)] = value

    def render(self) -> str:
        return "| " + " | ".join(self.cells) + " |"

    @property
    def id(self) -> str:
        return self.get("Id")

    @property
    def needs(self) -> list[str]:
        raw = self.get("Needs")
        if raw.lower() in ("", "none", "-"):
            return []
        return [part.strip() for part in raw.split(",") if part.strip()]


def load() -> tuple[Path, list[str], list[Row]]:
    path = queue_path()
    if not path.exists():
        die(f"queue note not found at {path}")
    lines = path.read_text().splitlines()
    rows: list[Row] = []
    headers: list[str] = []
    section = ""
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("## "):
            section = (stripped[3:].split() or [""])[0].lower()
        if not stripped.startswith("|"):
            headers = []
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        if cells and cells[0] == "Id":
            headers = cells
            continue
        if headers and all(re.fullmatch(r":?-+:?", cell) for cell in cells):
            continue
        if headers and cells[0]:
            rows.append(Row(index, headers, line, section))
    if not rows:
        die("no job tables with an Id column found in the queue note")
    return path, lines, rows


def find(rows: list[Row], job_id: str) -> Row:
    for row in rows:
        if row.id.lower() == job_id.lower():
            return row
    die(f"no job {job_id}")
    raise AssertionError


def save(path: Path, lines: list[str], row: Row) -> None:
    lines[row.index] = row.render()
    path.write_text("\n".join(lines) + "\n")


def show(all_rows: bool) -> None:
    _, _, rows = load()
    status = {row.id: row.get("Status") for row in rows}
    for row in rows:
        blocked = [need for need in row.needs if status.get(need, "") != "done"]
        ready = row.get("Status") == "open" and not blocked
        if not all_rows and not ready:
            continue
        lane = row.get("Lane") if "Lane" in row.headers else row.section
        branch = row.get("Branch") if "Branch" in row.headers else ""
        extra = f" branch={branch}" if branch else ""
        wait = f" waits on {', '.join(blocked)}" if blocked else ""
        owner = f" owner={row.get('Owner')}" if row.get("Owner") else ""
        print(f"{row.id:4} {row.get('Status'):8} [{lane}]{extra}{owner}{wait}  {row.get('Job')}")


def claim(job_id: str, owner: str, worktree: str) -> None:
    path, lines, rows = load()
    row = find(rows, job_id)
    if row.get("Status") != "open":
        die(f"{row.id} is {row.get('Status')} (owner: {row.get('Owner') or 'none'}), not open")
    status = {r.id: r.get("Status") for r in rows}
    blocked = [need for need in row.needs if status.get(need) != "done"]
    if blocked:
        die(f"{row.id} still waits on {', '.join(blocked)}")
    row.set("Status", "claimed")
    row.set("Owner", owner)
    if worktree and "Worktree" in row.headers:
        row.set("Worktree", f"`{worktree}`")
    save(path, lines, row)
    print(f"claimed {row.id} for {owner}" + (f" in {worktree}" if worktree else ""))


def release(job_id: str) -> None:
    path, lines, rows = load()
    row = find(rows, job_id)
    row.set("Status", "open")
    row.set("Owner", "")
    if "Worktree" in row.headers:
        row.set("Worktree", "")
    save(path, lines, row)
    print(f"released {row.id}")


def done(job_id: str, link: str, evidence: str) -> None:
    path, lines, rows = load()
    row = find(rows, job_id)
    row.set("Status", "done")
    links = row.get("Links")
    if link not in links:
        row.set("Links", f"{links} {link}".strip())
    if "Worktree" in row.headers:
        row.set("Worktree", "")
    save(path, lines, row)
    append_done_log(path, f"{date.today().isoformat()}: {evidence}")
    print(f"done {row.id}")


def append_done_log(path: Path, entry: str) -> None:
    """Put the entry at the end of the Done log, so the log reads old to new."""
    lines = path.read_text().splitlines()
    try:
        start = next(i for i, line in enumerate(lines) if line.strip().lower() == "## done log")
    except StopIteration:
        return
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("#")), len(lines))
    last = max(i for i in range(start, end) if lines[i].strip())
    if last == start:
        lines[start + 1 : start + 1] = ["", f"- {entry}"]
    else:
        lines.insert(last + 1, f"- {entry}")
    path.write_text("\n".join(lines) + "\n")


def main(argv: list[str]) -> None:
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__.strip())
        return
    command, args = argv[0], argv[1:]
    if command == "path":
        print(queue_path())
    elif command == "show":
        show("--all" in args)
    elif command == "claim" and len(args) >= 2:
        claim(args[0], args[1], args[2] if len(args) > 2 else "")
    elif command == "release" and len(args) == 1:
        release(args[0])
    elif command == "done" and len(args) == 3:
        done(*args)
    else:
        die("bad arguments. Run with --help.")


if __name__ == "__main__":
    main(sys.argv[1:])
