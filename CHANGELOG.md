# Changelog

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
