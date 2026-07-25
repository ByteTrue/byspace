---
id: sync-paseo-v0.2.0
title: 同步 Paseo v0.2.0 release delta
type: change
status: closed
created: 2026-07-24
closed: 2026-07-25
---

## Goal

从当前 BySpace `main` 移植 Paseo `v0.2.0-beta.1..v0.2.0` 的适用聚合差异，不导入上游历史，不重做身份、客户端裁剪或发布设施。

## Frozen evidence

- BySpace base: `559854c3d`
- Baseline: `v0.2.0-beta.1`, commit `0bec06c2db7d3ee071416cde80229eabd682b03e`, tree `bb00a77858523a24ff3de173c5197bb0f6cb0488`
- Target: `v0.2.0`, commit `d98c5e77f77fbf386553eeeaf85177a3d374ef90`, tree `46a01d6c6e3533dbd65d4819d498b9452d6146a7`
- Delta: 130 commits, 685 paths
- Unmodified target: clean install, server build, typecheck, and Web export passed before porting

## Dispositions

### Port

- Timeline selective synchronization and optimistic prompt identity
- Conflict-safe Web file editing, attachments, BOM/CRLF preservation, Vim mode, and live file updates
- Stable Project/workspace identity, lifecycle recovery/reconciliation, Git/Forge/worktree improvements, and CLI workspace automation
- Provider/ACP/OpenCode/Pi/OMP lifecycle fixes, idle reclamation, max thinking, and CLI heartbeat
- Web Changes/commit history, deep links, Command Center, compact/sidebar behavior, pasted PR/MR workspace sources, and persisted-theme startup safety
- MCP workspace and schedule automation, scoped cwd/path/ref trust boundaries, and required dependency closure

### Already present / superseded by BySpace

- BySpace Terminal hot-path, paste semantics, provider Terminal tabs, theme/font simplification, orchestration skills, and Stable/Beta release-channel behavior remain authoritative
- Existing BySpace security hardening was retained where it was stronger than the upstream implementation

### Excluded surface

- Electron and Desktop authority
- Native iOS/Android and `expo-two-way-audio`
- Marketing website
- Electron Browser automation
- Paseo Hub remote authority
- Upstream branding, package namespace, home/config names, port, versioning, and release pipeline

### Deferred

None. The baseline may advance to `v0.2.0`.

## Verification

- Focused protocol/client/server/app/CLI/Provider/workspace/MCP tests passed throughout the vertical slices
- Real Chromium checks covered Web file editing, pasted PR/MR workspace creation, Vim, Changes, root font application, and tool shimmer
- Typecheck, lint, format, Web export, branding, release checks, and global package smoke passed
- Five review rounds closed lifecycle, archive/recovery, optimistic settlement, path/ref, MCP, Provider, and Web completeness blockers
- Final independent reviews returned `CLEAR`; no production daemon, npm package, tag, or Cloudflare deployment was changed
