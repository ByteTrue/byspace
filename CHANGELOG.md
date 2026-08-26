# Changelog

## 0.7.2 - 2026-08-27

- Completes the multi-client release tuple in public artifacts: every Stable/Beta tag publishes checksummed Electron Desktop packages for macOS, Linux, and Windows plus a BySpace release-key-signed Android APK alongside npm, Web/PWA, and Relay.
- Repairs the first client matrix by centralizing Electron Web export in `build:desktop:web` across local, macOS, Linux, and Windows builds and by preserving npm's default Windows lifecycle shell for transitive package scripts.
- Publishes immutable exact-tag client manifests, SHA-256 checksums, updater metadata, actual macOS/Windows signing state, public re-download verification, and Android certificate identity; iOS source and validation remain maintained while active CD builds and uploads no iOS artifact.

## 0.7.1 - 2026-08-27

- Adds the unified Desktop/Android release infrastructure, long-term Android signing identity, release manifest/checksum tooling, iOS no-CD boundary, and matching release skills, documentation, website downloads, and CodeStable contract.
- Publishes npm, Stable Web, and Stable Relay successfully. The first Desktop/Android client matrix stopped before uploading any GitHub Release asset because Electron Web export targeted the wrong workspace and Windows npm lifecycle scripts were forced through Windows PowerShell; client publication is fixed forward in 0.7.2 without moving or rebuilding the 0.7.1 tag.

## 0.7.0 - 2026-08-27

- Restores the maintained Android, iOS, and Electron Desktop source and build surfaces around the shared product, with native terminal, attachments, audio, push-notification lifecycle, Desktop daemon management, updates, CLI integration, and verified local packaging paths.
- Adds Desktop Browser panes and Browser Automation for tab management, accessibility snapshots, trusted input, navigation, screenshots, uploads, logs, evaluation, responsive sizing, and daemon-exposed Browser tools.
- Adds the experimental trusted-local Plugin platform across daemon, CLI, Web, Command Center, workspace and agent panels, composer attachments, themes, settings, and bounded logs.
- Reworks workspaces around split panes, side panels, labels, sortable pinned workspaces, browser and editor targets, richer Command Center actions, and more consistent compact and Desktop navigation.
- Adds active-turn steering, agent tracks, sequenced directory synchronization, IndexedDB-backed timeline and provider caches, faster resume and catch-up behavior, and clearer running-turn and diff status.
- Expands provider and orchestration support with MiniMax Code ACP, host-managed orchestration skills, live Pi usage, safer task resume identity, config reload without daemon restart, and stronger provider recovery and catalog behavior.
- Improves Git and review workflows with durable PR identity and status, check summaries, broader valid branch names, complete-path search, canvas diff rendering, richer syntax highlighting, and retained file and project state.
- Refreshes the interface with a unified typography scale, keyboard-first menus, IME-safe editing, model and profile creation, Russian localization, and more polished composer, sidebar, settings, and workspace controls.
- Hardens Relay and pairing key validation, Desktop and Native build ordering, daemon supervision and packaging, push token revocation, browser isolation, and multi-client compatibility and smoke coverage.

## 0.6.0 - 2026-08-21

- Adds Private Remote Web Services for securely exposing loopback HTTP, SSE, and WebSocket services between trusted daemons through an optional standalone E2EE Data Relay and `*.remote.localhost` routes.
- Adds reusable Agent Profiles that apply provider, model, mode, thinking, and feature settings together, with new profile appearance controls and a streamlined model browser and composer.
- Expands the File Explorer with daemon-backed create, rename, duplicate, delete, and search actions; richer Material file icons; Markdown and HTML previews; and sandboxed Mermaid rendering.
- Reworks Git Changes around incremental file observation, batched diff highlighting, discard actions, scheduling, and cross-platform watcher recovery for faster and more reliable updates.
- Extends Claude, Codex, OpenCode, OMP, Pi, and generic ACP runtimes with stronger task-state mapping, diagnostics, catalog-refresh deadlines, JSONL process handling, and model and tool translation.
- Expands the TypeScript SDK and CLI with broader agent, provider, workspace, event, diagnostic, and workspace-renaming APIs and examples.
- Improves project and workspace navigation with a compact sidebar page menu, persistent section state, drag-and-drop ordering, automatic shared-host labels, schedule access, and full worktree paths in hover details.
- Removes the legacy Chat room and Loop command/service surfaces while preserving wire parsing compatibility; recurring automation continues through Schedules.
- Adds the official BySpace landing site and moves the hosted App, Docs, and Relay channels to the `byspace.cc.cd` domain.
- Hardens Windows Forge command execution and Git metadata casing, provider status refresh, daemon supervision, Relay framing, session recovery, and workspace observation under load.

## 0.5.0 - 2026-08-12

- Adds project-first workspace navigation, attention ordering, project icons, worktree labels, unified workspace creation, agent-guided project setup, and safe agent-guided workspace and branch renaming.
- Expands Agent Timeline and History with durable synchronization, outline navigation, bounded cross-host search and jumps, duplicate-free pagination, and formatting-preserving copy.
- Replaces legacy voice mode with local push-to-talk dictation, including model download progress and running-turn fork submission.
- Adds sandboxed HTML preview, an expanded Command Center, Korean localization, and shared AI-operations settings.
- Extends terminal launch profiles into unified workspace creation and tightens terminal, workspace setup, Provider lifecycle, and reconnect ownership behavior.
- Restores Host appearance controls, returns Git Changes refresh before Forge network work, and shortens CI and release artifact promotion.
- Adds native Provider options for Claude, Codex, and OpenCode, with improved Codex skill filtering and Kimi authentication, usage, and reasoning support.
- Improves Browser crash recovery, compact workspace controls, shortcut customization, Markdown copying, inline code rendering, and running-status animation.
- Hardens daemon supervision, ignored-path resolution, agent and workspace archival races, and restart ownership behavior.

## 0.4.0 - 2026-08-04

- Adds QR-code device pairing to Host settings.
- Reworks Agent Timeline synchronization and recovery to avoid stale views and expose sync progress.
- Retains terminal sessions across workspace switches and improves restore, resize, backlog, and PTY sizing behavior.
- Adds visible remote-session loading state and bridges Pi questionnaire answers in the Web UI.
- Hardens service-proxy WebSocket upgrade routing and Git upstream status reporting.

## 0.3.0 - 2026-08-01

- Adds bounded high-water-mark handling, binary E2EE Relay frames, and backpressured large-file transfer with preserved image formats.
- Updates Claude, OMP, and child-agent lifecycle behavior, including Opus 5 context variants and parent retention while child agents run.
- Adds workspace script management to the daemon, CLI, and MCP, and preserves public service-proxy ports across restarts.
- Improves Web history pagination, project search, sidebar shortcuts, terminal tab actions, file-editor focus, and Provider overlays.
- Groups the same remote-backed project across Hosts while keeping Host-local project IDs as the sole mutation authority.
- Supports large structured diffs through a 64 MiB transport backstop and an explicit oversized-diff state instead of disconnecting.
- Hardens PR comment Markdown conversion, self-hosted Forge ports, file-tree restoration, older GitHub CLI search, and Provider interruption/model behavior.
- Makes BySpace-created worktree setup portable across PowerShell and POSIX shells without copying runtime state or symlinks.
- Moves the hosted Web and relay endpoints of both channels to dedicated domains and stops serving the relay over `*.workers.dev`.

## 0.2.1 - 2026-07-25

- Adds conflict-safe Web file editing with BOM/CRLF preservation, live updates, attachments, and optional Vim keybindings.
- Gives every selected project root a stable opaque identity and serializes workspace, agent, archive, recovery, and reconciliation lifecycle mutations.
- Expands workspace creation with pasted PR/MR checkout sources, searchable refs, commit history, and safer Forge/Git operations.
- Aligns Provider lifecycle, idle reclamation, OpenCode interruption, OMP max thinking, CLI heartbeat, and MCP workspace/schedule automation with Paseo v0.2.0.
- Preserves persisted Web theme styles at startup and tightens optimistic timeline, checkout cache, and tool-rendering behavior.

## 0.2.0 - 2026-07-24

- Restores native terminal paste behavior, including bracketed multiline paste, clipboard image upload, and Windows ConPTY framing.
- Integrates terminal launch profiles and activity hooks into provider settings for Claude, Codex, OpenCode, and Pi.
- Adds persistent conversation controls for jumping to the latest message and collapsing all tool calls.
- Surfaces terminal settings failures and prevents isolated daemon cleanup from stopping a daemon it does not own.
