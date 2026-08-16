---
kind: issue
title: "刷新后自动发布 Forge PR/MR 状态"
type: ff
status: closed
created: 2026-08-16
---

# 刷新后自动发布 Forge PR/MR 状态

- 改动：`packages/server/src/server/session/checkout/checkout-session.ts` - 后台 Forge 刷新完成后立即发送已有的 `checkout_status_update` 投影，首次刷新也会更新 PR/MR 与 forge 标识。
- 改动：快速本地快照在 Forge 尚未解析时不再发送 `prStatus`，因此不会把已缓存的 GitLab MR 标识临时回退为 GitHub。
- 改动：`packages/server/src/server/session/checkout/checkout-session.test.ts` 与 `packages/app/src/git/checkout-status-cache.test.ts` 覆盖两阶段 GitLab MR 缓存保留。
- 验证：`npx vitest run packages/server/src/server/session/checkout/checkout-session.test.ts packages/app/src/git/checkout-status-cache.test.ts --bail=1`（49/49）；`npm run typecheck`；`npm run lint`。
- codestable：无影响；恢复 `codestable/spec/index.md` 已记录的既有行为。
