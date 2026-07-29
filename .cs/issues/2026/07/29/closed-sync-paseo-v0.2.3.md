---
id: sync-paseo-v0.2.3
title: 同步 Paseo v0.2.3 release delta
type: change
status: closed
created: 2026-07-29
closed: 2026-07-29
---

## Goal

从当前 BySpace `main` 移植 Paseo `v0.2.0..v0.2.3` 的适用聚合差异，不导入上游历史，不重做身份、客户端裁剪或发布设施。

## Frozen evidence

- BySpace base: `fddef5a676d53261e27d41b57d7686dfedf5628a`
- Baseline: `v0.2.0`, commit `d98c5e77f77fbf386553eeeaf85177a3d374ef90`, tree `46a01d6c6e3533dbd65d4819d498b9452d6146a7`
- Target: `v0.2.3`, commit `43cf858c3760679ec9be805ba8b903cdf20f7103`, tree `54f51bd995bccf77d77ea3e33df4c39d37c033b2`
- Delta: 39 commits, 211 paths, +8,605/-1,333
- Unmodified target: clean install, server build, typecheck, and Web export passed before porting

## Dispositions

### Port

- Physical-socket application lease, 8 MiB outbound high-water limit, and source-scoped file transfer
- 256 KiB stable-handle file streaming with backpressure and content-sensitive revision compatibility
- Binary-preserving E2EE capability negotiation for direct/relay parity
- Workspace script CLI and MCP automation through the shared WorkspaceScriptsService
- Service proxy port/forwarded-authority handling and Git base-ref diagnostics
- Claude Opus 5/context variants/model-scoped weekly usage, OMP model-scoped thinking levels, Pi-native cleanup
- Parent runtime retention while managed children run and background-agent permission-mode safety
- Complete timeline pagination, Command Center project search, collapsed-sidebar pinning, terminal-ID copy, Markdown wrapping, pane focus, and overlay-layer fixes
- Image attachment format preservation

### Already present / superseded by BySpace

- Pi already uses the native BySpace integration; only regression coverage and stale icon cleanup are relevant
- BySpace Terminal hot path, Provider Terminal tabs, theme/font simplification, orchestration skills, and Stable/Beta release-channel behavior remain authoritative
- Existing BySpace content-sensitive file revisions, path/ref hardening, lifecycle transactions, and single-package packaging remain authoritative where stronger than upstream

### Excluded surface

- Paseo Hub remote authority and Hub-only CLI dependencies
- Electron/Desktop daemon authority
- Native iOS/Android and native picker changes
- Marketing website
- Official Paseo Relay infrastructure and documentation
- Upstream branding, package namespace, home/config names, versioning, release commits, and CI/CD

### Deferred

None. The integrated baseline advanced to `v0.2.3` only after every retained slice and review blocker was complete.

## Verification

- Verified the exact unmodified Paseo `v0.2.3` target with clean install, server build, typecheck, and Web export.
- Focused protocol/client/Relay/server/app/CLI tests passed; a broad changed-file run completed 693 tests before two local environment gates, then the Relay E2E passed separately. The updated Claude catalog path passed against an isolated clean CLI; unchanged Codex checks remained locally version-sensitive and are covered by the required exact-SHA remote CI after merge.
- Real Chromium checks passed 23 targeted scenarios across timeline pagination, project search, file editing and pane focus, image-picker failure handling, Provider refresh, collapsed-sidebar pinning, and terminal tab actions.
- Build, typecheck, lint, format, branding, Web export, Nix dependency hash computation, package staging, global package smoke, and release artifact verification passed.
- Five independent review directions found three blockers: an unbounded pre-open E2EE queue, an unsettled unsupported-image picker promise, and a stale Nix dependency hash. All were fixed with regression coverage and focused re-review returned `CLEAR`.
- No production daemon, npm package, release tag, Cloudflare deployment, or upstream Git ancestry was changed.
