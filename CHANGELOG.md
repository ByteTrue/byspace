# Changelog

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
