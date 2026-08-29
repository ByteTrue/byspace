<p align="center">
  <img src="packages/website/public/logo.svg" width="64" height="64" alt="BySpace logo">
</p>

<h1 align="center">BySpace</h1>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="https://github.com/ByteTrue/byspace/stargazers">
    <img src="https://img.shields.io/github/stars/ByteTrue/byspace?style=flat&logo=github" alt="GitHub stars">
  </a>
  <a href="https://github.com/ByteTrue/byspace/releases">
    <img src="https://img.shields.io/github/v/release/ByteTrue/byspace?style=flat&logo=github" alt="GitHub release">
  </a>
</p>

<p align="center">One interface for Claude Code, Codex, Copilot, OpenCode, and Pi agents.</p>

<p align="center">
  <img src="packages/website/public/hero-mockup.png" alt="BySpace app screenshot" width="100%">
</p>

<p align="center">
  <img src="packages/website/public/mobile-mockup.png" alt="BySpace mobile app" width="100%">
</p>

Run agents in parallel on your own machines. Ship from your phone or your desk.

- **Self-hosted:** Agents run on your machine with your full dev environment. Use your tools, your configs, and your skills.
- **Multi-provider:** Claude Code, Codex, Copilot, OpenCode, and Pi through the same interface. Pick the right model for each job.
- **Voice control:** Dictate tasks or talk through problems in voice mode. Hands-free when you need it.
- **Cross-device:** iOS, Android, desktop, web, and CLI. Start work at your desk, check in from your phone, script it from the terminal.
- **Privacy-first:** BySpace doesn't have any telemetry, tracking, or forced log-ins.

## Getting Started

BySpace runs a local server called the daemon that manages your coding agents. Clients like the desktop app, mobile app, web app, and CLI connect to it.

### Prerequisites

You need at least one agent CLI installed and configured with your credentials:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex](https://github.com/openai/codex)
- [GitHub Copilot](https://github.com/features/copilot/cli/)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Pi](https://pi.dev)

### Desktop app (recommended)

Download it from the [BySpace GitHub releases page](https://github.com/ByteTrue/byspace/releases). Open the app and the daemon starts automatically. Nothing else to install.

To connect from your phone, open **Settings → your host → Pair Device**.

### CLI / headless

Install the CLI and start BySpace:

```bash
npm install -g @bytetrue/byspace@beta
byspace
```

BySpace starts locally on port `6777`, then asks whether to enable the end-to-end encrypted relay for device pairing. If you decline, connect directly over TCP, Tailscale, or another VPN. This path is useful for servers and remote machines.

For full setup and configuration, see:

- [Development and setup](docs/development.md)
- [Architecture](docs/architecture.md)
- [Server and CLI reference](packages/server/README.md)

### Docker

Run the BySpace daemon and self-hosted web UI in Docker:

```bash
docker run -d --name byspace \
  -p 6777:6777 \
  -e PASEO_PASSWORD=change-me \
  -v "$PWD/byspace-home:/home/byspace/.byspace" \
  -v "$PWD:/workspace" \
  ghcr.io/bytetrue/byspace:0.7.0-beta.2
```

Open `http://localhost:6777` after it starts. Extend the base image with the agent CLIs you use, then provide credentials through environment variables or the persistent `/home/byspace/.byspace` volume. See the [Docker documentation](docs/docker.md) for full setup details.

## CLI

Everything you can do in the app, you can do from the terminal.

```bash
byspace run --provider claude/opus-4.6 "implement user authentication"
byspace run --provider codex/gpt-5.5 --worktree feature-x "implement feature X"

byspace ls                           # list running agents
byspace attach abc123                # stream live output
byspace send abc123 "also add tests" # follow-up task

# run on a remote daemon; --cwd is a path on that host
byspace run --host workstation.local:6777 --cwd /workspace "run the full test suite"
```

See the [CLI reference](packages/server/README.md) for more.

## Skills

The upstream Paseo skills remain compatible with BySpace's internal protocol:

```bash
npx skills add getpaseo/paseo
```

Then use them in any agent conversation:

- `/paseo-handoff` — hand off work between agents. I use this to plan with Claude and then handoff to Codex to implement.
- `/paseo-advisor` — spin up a single agent as an advisor for a second opinion, without delegating the work itself.
- `/paseo-committee` — form a committee of two contrasting agents to step back, do root cause analysis, and produce a plan.

## Development

Quick monorepo package map:

- `packages/server`: BySpace daemon (agent process orchestration, WebSocket API, MCP server)
- `packages/app`: Expo client (iOS, Android, web)
- `packages/cli`: `byspace` CLI for daemon and agent workflows
- `packages/desktop`: Electron desktop app
- `packages/relay`: Relay transport and encryption used by the daemon and clients
- `packages/website`: retained upstream marketing source; it is not deployed by this release line

Common commands:

```bash
# run all local dev services
npm run dev

# run individual surfaces
npm run dev:server
npm run dev:app
npm run dev:desktop
npm run dev:website

# build the server stack
npm run build:server

# repo-wide checks
npm run typecheck
```

## Related projects

- [getpaseo/paseo-relay](https://github.com/getpaseo/paseo-relay) — official distributed relay, written in Elixir
- [paseo-vscode](https://marketplace.visualstudio.com/items?itemName=hinnes.paseo-vscode) — VS Code extension

## License

Apache-2.0
