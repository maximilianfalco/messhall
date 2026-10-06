#!/usr/bin/env python3
"""Put a case | <column> table at the end of the QA section.

Args: body.md rows.json urls.txt out.md [intro] [--column recording|screenshot] [--before-after].
--before-after writes case | before | after from rows with `before` and `after` alts, the shape the CSS screenshots check wants.
"""
import argparse
import html
import json
import re
import sys

HEADING = "# ✅ QA and Testing"
INTROS = {
    "recording": "recorded with vhs from the tapes in demo/tapes. small text under each case is the exit code and key lines",
    "screenshot": "screenshots of the mac app",
    "before-after": "before is main, after is this branch, same view, size and scheme",
}
# Where a file waits when there is no url yet, so the user knows what to drag.
LOCAL = {"recording": "demo/out/{}.gif", "screenshot": "demo/out/shots/{}.png", "before-after": "demo/out/shots/{}.png"}
MD_IMAGE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)\)")


def markers(column: str) -> tuple:
    # The recording table keeps its first marker so tables written before --column still get replaced.
    name = "messhall-tape-qa" if column == "recording" else f"messhall-qa-{column}"
    return f"<!-- {name} -->", f"<!-- /{name} -->"


def code(s: str) -> str:
    return f"<code>{html.escape(s, quote=False)}</code>"


def read_urls(path: str) -> dict:
    """Lines are `alt url` or the `![alt](url)` that messhall-dev qa-upload prints."""
    urls = {}
    for line in open(path):
        line = line.strip()
        match = MD_IMAGE.search(line)
        if match:
            urls[match[1]] = match[2]
        elif line:
            alt, url = line.split(maxsplit=1)
            urls[alt] = url.strip()
    return urls


def cell(imgs: list, urls: dict, column: str, width: int) -> str:
    def one(img: str) -> str:
        if img not in urls:
            return f"drag `{LOCAL[column].format(img)}` here"
        return f'<img width="{width}" alt="{img}" src="{urls[img]}" />'

    return " ".join(one(img) for img in imgs)


def section_end(body: str, at: int) -> int:
    """Start of the next top level heading after `at`, skipping code blocks, else the end of the body."""
    fenced = False
    pos = at
    for line in body[at:].splitlines(keepends=True):
        if line.startswith("```"):
            fenced = not fenced
        elif not fenced and line.startswith("# "):
            return pos
        pos += len(line)
    return len(body)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("body")
    parser.add_argument("rows")
    parser.add_argument("urls")
    parser.add_argument("out")
    parser.add_argument("intro", nargs="?")
    parser.add_argument("--column", choices=["recording", "screenshot"], default="recording")
    parser.add_argument("--before-after", action="store_true")
    args = parser.parse_args()
    if args.before_after:
        args.column = "before-after"
    start, end = markers(args.column)
    intro = args.intro or INTROS[args.column]
    body = open(args.body).read()
    rows = json.load(open(args.rows))
    urls = read_urls(args.urls)

    sides = ["before", "after"] if args.before_after else ["img"]
    header = " | ".join(sides) if args.before_after else args.column
    lines = [f"| case | {header} |", "|" + " --- |" * (len(sides) + 1)]
    for r in rows:
        missing = [side for side in sides if side not in r]
        if missing:
            sys.exit(f"row {r['case']!r} has no {' or '.join(missing)}")
        extras = "<br>".join(code(e) for e in r.get("extras", []))
        case = r["case"] + (f"<br><br><sub>{extras}</sub>" if extras else "")
        width = r.get("width", 720)
        shots = [r[side] if isinstance(r[side], list) else [r[side]] for side in sides]
        lines.append(f"| {case} | " + " | ".join(cell(imgs, urls, args.column, width) for imgs in shots) + " |")
    block = f"{start}\n{intro}\n\n" + "\n".join(lines) + f"\n{end}"
    if "—" in block:
        sys.exit("em dash in the table, rewrite it")

    if start in body and end in body:
        a, b = body.index(start), body.index(end) + len(end)
        body = body[:a].rstrip() + "\n" + body[b:].lstrip("\n")
    if HEADING not in body:
        body = body.rstrip() + f"\n\n{HEADING}\n"

    cut = section_end(body, body.index(HEADING) + len(HEADING))
    head, tail = body[:cut].rstrip(), body[cut:]
    new = f"{head}\n\n{block}\n" + (f"\n{tail}" if tail else "")

    open(args.out, "w").write(new)
    print(f"{len(rows)} rows -> {args.out}")


if __name__ == "__main__":
    main()
