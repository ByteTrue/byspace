<p align="center">
  <img src="packages/app/assets/images/icon.png" width="64" height="64" alt="BySpace logo">
</p>

<h1 align="center">BySpace</h1>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a>
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

---

Run agents in parallel on your own machines from a hosted Web interface or the CLI.

- **Self-hosted:** Agents run on your machine with your full dev environment. Use your tools, your configs, and your skills.
- **Multi-provider:** Claude Code, Codex, Copilot, OpenCode, and Pi through the same interface. Pick the right model for each job.
- **Voice control:** Dictate tasks or talk through problems in voice mode. Hands-free when you need it.
- **Web + CLI:** Use the hosted browser interface from any device, or script the same local daemon from the terminal.
- **Privacy-first:** BySpace doesn't have any telemetry, tracking, or forced log-ins.

## Getting Started

BySpace runs a local daemon that manages your coding agents. The hosted Web app and CLI connect directly or through the E2EE relay.

### Prerequisites

You need at least one agent CLI installed and configured with your credentials:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex](https://github.com/openai/codex)
- [GitHub Copilot](https://github.com/features/copilot/cli/)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Pi](https://pi.dev)

### CLI / headless

Install or upgrade the Stable channel:

```bash
npm install -g @bytetrue/byspace@latest
byspace
```

Install or upgrade the newest Beta channel:

```bash
npm install -g @bytetrue/byspace@beta
byspace
```

If a daemon is already running, restart it after switching or upgrading channels:

```bash
byspace daemon restart
byspace daemon status
```

The daemon prints a pairing link for its matching hosted Web app and keeps agents running after the browser closes. Stable uses npm `latest`, [byspace.pages.dev](https://byspace.pages.dev), and `byspace-relay`; Beta uses npm `beta`, [byspace-beta.pages.dev](https://byspace-beta.pages.dev), and `byspace-relay-beta`.

For full setup and configuration, see:

- [Docs](https://byspace.pages.dev/docs)
- [Configuration reference](https://byspace.pages.dev/docs/configuration)

## CLI

Everything you can do in the app, you can do from the terminal.

```bash
byspace run --provider claude/opus-4.6 "implement user authentication"
byspace run --provider codex/gpt-5.4 --worktree feature-x "implement feature X"

byspace ls                           # list running agents
byspace attach abc123                # stream live output
byspace send abc123 "also add tests" # follow-up task

# run on a remote daemon
byspace --host workstation.local:6777 run "run the full test suite"
```

See the [full CLI reference](https://byspace.pages.dev/docs/cli) for more.

## Skills

Skills teach your agent to use BySpace to orchestrate other agents.

```bash
npx skills add ByteTrue/byspace
```

Then use them in any agent conversation:

- `/byspace-handoff` — hand off work between agents. I use this to plan with Claude and then handoff to Codex to implement.
- `/byspace-loop` — loop an agent against clear acceptance criteria (aka Ralph loops), optionally with a verifier.
- `/byspace-advisor` — spin up a single agent as an advisor for a second opinion, without delegating the work itself.
- `/byspace-committee` — form a committee of two contrasting agents to step back, do root cause analysis, and produce a plan.

## Development

Quick monorepo package map:

- `packages/server`: BySpace daemon (agent process orchestration, WebSocket API, MCP server)
- `packages/app`: Expo/React Native Web client
- `packages/cli`: `byspace` CLI for daemon and agent workflows
- `packages/relay`: Relay package for remote connectivity

Maintainer workflows are encoded as repo-local skills:

- `upstream-sync` — rebuild from a frozen Paseo release snapshot.
- `release-beta` — ship npm/Web/Relay Beta as one channel.
- `release-stable` — ship or promote the Stable channel.
- `harden-byspace-release` — audit packaging, CI/CD, channel isolation, or recovery.

Common commands:

```bash
# run all local dev services
npm run dev

# run individual surfaces
npm run dev:server
npm run dev:app

# build the server stack
npm run build:server

# repo-wide checks
npm run typecheck
```

---

<p align="center">
  <a href="https://star-history.com/#ByteTrue/byspace&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=ByteTrue/byspace&type=Date&theme=dark">
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=ByteTrue/byspace&type=Date">
      <img src="https://api.star-history.com/svg?repos=ByteTrue/byspace&type=Date" alt="Star history chart for ByteTrue/byspace" width="600" style="max-width: 100%;">
    </picture>
  </a>
</p>

## License

AGPL-3.0

BySpace is forked from [Paseo](https://github.com/getpaseo/paseo).
