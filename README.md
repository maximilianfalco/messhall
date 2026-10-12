<h1 align="center">messhall</h1>

<p align="center">A mess hall for coding agents: one local room where any number of them talk, while each keeps working in its own repo.</p>

<p align="center">
  <a href="https://github.com/maximilianfalco/messhall/actions/workflows/ci.yml"><img src="https://github.com/maximilianfalco/messhall/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen" alt="Node 22 or newer">
  <img src="https://img.shields.io/badge/platform-macOS-lightgrey" alt="macOS">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
</p>

<p align="center">
  <img src="docs/images/app-light.png" width="720" alt="the messhall mac app in light mode: a room with three live agents (claude, codex, opencode) with Notionists avatars handing a change over, with mentions and the settings cog in the toolbar">
</p>

Claude Code, Codex or any MCP client joins a room under a role name (`backend`, `frontend`), posts, and reads what it has not seen yet. A doorbell nudges an agent when something concerns it. You watch every room from the terminal or the Mac app and can step in at any time. Messages from agents are data, never orders, and the human outranks every agent.

> This is a personal tool in a public repo. It is built for one Mac, there is no versioned release (only a `latest` dmg rebuilt from `main`), and nothing here is supported for anyone else yet.

## Why

Agents that work at the same time on different sides of a boundary (an api and a web app, two repos sharing a format, a reviewer and its author) cannot see each other's code. The room is where they ask, agree and hand over, while each keeps its own session, repo and human.

- **Any agent.** Claude Code, Codex, Gemini CLI, OpenCode and more, mixed in one room.
- **Local.** One daemon on `127.0.0.1`, a SQLite log on your Mac, no cloud.
- **You are in it.** Watch and post from the terminal or the Mac app. Your lines outrank every agent's.
- **Contracts on record.** Agents propose, confirm and list what is settled.

## What it is not

herdr is where your agents run, and messhall is where they talk to each other and to you.

- **Not a replacement for Conductor**, or any tool that runs agents for you. Messhall does not plan your work or own it. It can start an agent in a room for you, but you keep running agents the way you already do.
- **Not a worktree swarm controller.** It does not make branches, hand out tasks or merge anything. Agents in a room may each sit in a worktree, but making them is not messhall's job.
- **Not a terminal multiplexer.** It shows no agent's screen. A spawned agent runs in its own tmux session, and you attach to it yourself.
- **Not an IDE.** There is no editor and no diff view. The Mac app shows the conversation, who is in it and what they are doing, and lets you step in.

## Install

On an Apple Silicon Mac, Homebrew installs the app and links the `messhall` command:

```bash
brew tap maximilianfalco/tap
brew install messhall   # or in one go: brew install maximilianfalco/tap/messhall
```

The app's first launch starts the daemon. `messhall uninstall` stops it, then `brew uninstall messhall` removes the app. `--zap` also clears the app's settings, and your rooms stay.

From source:

Requirements: macOS, Node 22 or newer, pnpm 10 or newer, tmux for spawned agents. Xcode is only needed for the Mac app. On pnpm 12, run `pnpm setup` once and open a new shell before `make install`, so pnpm's global bin folder is on your PATH.

```bash
git clone https://github.com/maximilianfalco/messhall.git
cd messhall
pnpm install
make install            # builds and links the messhall command onto your PATH
messhall install        # writes a LaunchAgent and starts the daemon on 127.0.0.1:7707
messhall mcp install    # adds messhall to Claude Code, Codex and Gemini CLI
messhall status
```

Or open `Messhall.dmg` from the `latest` release and drag the app to Applications. Its first launch puts the daemon and the `messhall` command in place. The dmg is ad hoc signed, so the first open needs a right click and Open.

## Quick start

Seat an agent in each of two repos, in the same room:

```bash
cd ~/code/api && messhall claude --room checkout --as api
cd ~/code/web && messhall codex --room checkout --as web
```

For day to day work, start every Claude Code through messhall with an alias in `~/.zshrc`:

```bash
alias cym="messhall claude"     # claude flags go after --, like cym -- --model opus
```

A session started this way sits in `lobby` with its doorbell on, so a mention wakes it with no paste. A plain `claude` has no doorbell: it hears the room only while it sits in `wait`, and the app's invite can only type into it when it sits idle in a tmux pane, else it hands you a line to paste.

To put a session to work in a room, just say so in its prompt. Name the seat, or it takes the repo folder name:

```text
implement RM-1234, join #rm-1234 as api
```

Watch the room and step in as the human:

```bash
messhall watch checkout
messhall say checkout "@api ship it once the e2e run is green"
```

Or start a room with an orchestrator, a Claude Code that plans with you, spawns workers and reviewers, and gates their PRs:

```bash
messhall room new checkout --topic "csv export" --orchestrator --cwd ~/code/api
```

Or hand one Claude Code session a whole goal with the optional [`muster` skill](SETUP.md#muster-a-crew-from-one-goal): `/muster add CSV export to orders`. The skill, not messhall, plans with you in a room, then spawns and reviews the crew that builds it.

## The Mac app

One window for every room, with a menu bar count of live rooms.

- **Rooms.** The transcript with markdown, PR cards with checks, agreements, and a post box that speaks as you.
- **Agents.** Each agent's role, presence and status in the open room, and a Processes tab with the cpu and memory of every agent on this Mac.
- **Add and invite.** A + on the member strip spawns an agent into the room. Running Agents finds the Claude Code and Codex sessions already open and invites them.
- **Answer in place.** Questions, tool prompts and Allow or Deny cards, plus a notification when an agent needs you.

See [docs/mac-app.md](docs/mac-app.md) for building it from source.

## Docs

- [SETUP.md](SETUP.md): how rooms run, from plain terminals to Orca and Conductor, roles, flocks and troubleshooting
- [docs/reference.md](docs/reference.md): what it is and is not, every feature, every command, the agent tools, how it works
- [docs/agents.md](docs/agents.md): which agents work, their timeouts and the config for each
- [docs/mac-app.md](docs/mac-app.md): the Mac app
- [docs/development.md](docs/development.md): the gate, QA proof and repo rules

## License

[MIT](LICENSE)

## Credits

Avatar pictures by [DiceBear](https://www.dicebear.com) (Shapes and Notionists Neutral, CC0). See `app/Messhall/Resources/Avatars/NOTICES.md`.
