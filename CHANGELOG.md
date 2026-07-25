# Changelog

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
