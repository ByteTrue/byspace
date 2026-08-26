# Product

What BySpace is, who it's for, and where it's going.

## What is BySpace

BySpace is a self-hosted personal compute control plane built around agents. Stable/Beta releases publish the Web/PWA, local CLI/daemon, Relay, Electron Desktop clients for macOS/Linux/Windows, and a signed Android APK from one immutable tag. The iOS host remains maintained source/prebuild/test surface but active CD intentionally never publishes it.

The development workflow is shifting from manually editing files to orchestrating agents and user-owned devices that do the work. BySpace is built for that workflow.

## Core philosophy

Freedom and flexibility. Every design decision follows from this:

- **Multi-provider** — Use any coding agent harness. Pick the right model for each job, switch freely as the landscape shifts. No vendor-lock in.
- **Full clients + CLI** — Use the same local daemon from Web/PWA, published Android and Electron Desktop clients, or terminal automation. iOS implementation remains maintained without entering the distribution train.
- **Self-hosted** — The daemon runs on your machine. Your code, your keys, your environment. No inference markup, no cloud dependency.
- **Respectful** - No telemetry, no forced cloud, no forced accounts
- **Open source** — AGPL-3.0. Users can inspect, fork, and contribute.
- **BYOK** — Bring your own keys. Use your subsidized plans and first-party provider pricing. BySpace adds zero cost on top.

## How it works

### Projects and workspaces

Projects are grouped in the sidebar, detected automatically from your filesystem and tagged by git remote when available.

The sidebar has one Project-based hierarchy with two attention regions: **Needs attention** first, then **Other projects**. Projects appear once, empty projects stay visible at the end, workspace rows show only actionable/active agent counts, and desktop hover reveals every agent status in that workspace. A `+` in the Workspaces header is the always-visible global creation entry, each project row has its contextual `+`, and `Cmd/Ctrl+N` remains the global accelerator; there is no separate full-width creation row consuming list space. All three open the same Project-first composer: reliable current context is prefilled, otherwise the Project picker opens first. A current Workspace provides its explicit Host, a single usable location is automatic, and multiple locations always require a Host choice; isolation and base branch remain secondary inline choices.

Each project opens as a workspace. For git projects, the default workspace is the main checkout. Users can create additional workspaces, which are isolated copies (git worktrees) where agents work without affecting main.

### Inside a workspace

A workspace is a flexible canvas:

- Launch multiple agents side by side in split panes
- Open terminals alongside agents
- Mix and match providers within the same workspace

### The daemon

BySpace is a client-server system. The daemon (Node.js) runs on your machine, manages agent processes, and streams output in real time over WebSocket or local Desktop transport to Web, mobile, Desktop, and CLI clients.

This architecture means:

- The daemon can run on any machine: laptop, VM, remote server
- Multiple Web, mobile, Desktop, and CLI clients can connect simultaneously
- Agents keep running when you close any client

## Target user

Anyone who builds software:

- Care about owning their tools and their data
- Use multiple AI providers and want to switch freely
- Run agents on real tasks across real projects
- Want access from browsers, desktops, and mobile devices to agents running on their own machines

## What compounds over time

- **Trust** — Showing up daily, shipping in public, being open source. Earned slowly, lost quickly.
- **Community contributions** — Code, packaging, skills, agent configs. Contributors become advocates.
- **Ecosystem** — Skills, integrations, shared configs. Community-built content that makes the platform more valuable.

## Strategic bets

1. **Models commoditize.** Value moves to the orchestration layer. The best model changes monthly — the workflow layer stays.
2. **Multi-provider wins.** No single provider stays on top. Developers want the best model for each task.
3. **The daemon as infrastructure.** Server/client architecture enables deployment anywhere.
4. **Open source outlasts funding.** Open source communities are resilient. Contributors become advocates.

## Current state (August 2026)

- Public Hosted Web/PWA and CLI backed by a local daemon and optional E2EE Relay
- Public signed Android APK distributed from GitHub Releases with permanent update identity
- Public checksummed Electron Desktop artifacts for macOS, Linux, and Windows, with packaged Browser automation and updater metadata
- Maintained iOS source, prebuild, native modules, and tests; active CD never builds or submits iOS
- Built-in providers: Claude Code (Agent SDK), Codex (app-server), GitHub Copilot (ACP), OpenCode, Pi, OMP
- One-click ACP provider catalog: CodeWhale, Cursor, Hermes, Qwen Coder, Kimi Code, and others — plus custom ACP providers
- Local dictation with Host-managed multilingual speech models and optional text-only refinement through the current Agent provider
- MCP server exposes the daemon to other agents (create_agent, send_agent_prompt, schedules, terminals, worktrees, workspace renaming)
- Scheduled agents (cron-style triggers) via app, CLI, and MCP
- Frequent releases (multiple per week)
- Community contributions across packaging, providers, and bug fixes
- Key UX: split panes, keybinding customization, workspaces, terminals, files, and Agent timelines
