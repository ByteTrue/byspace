---
kind: issue
title: "桌面客户端本机 Host 默认名称恢复使用主机名 (hostname)"
type: ff
status: closed
created: 2026-10-30
closed: 2026-10-30
---

# 桌面客户端本机 Host 默认名称恢复使用主机名 (hostname)

- **做了什么**：
  1. 在 `internal/gui/app.go` 中，将 `WithExplicitConnectionHint(sup.Addr, "BySpace")` 改为传入 `os.Hostname()`（`internal/webui/webui.go` 在 `label` 为空时不注入硬编码标签，交由前端从 `server_info.hostname` 获取）。
  2. 在 `packages/app/src/runtime/host-runtime.ts` 的 `bootstrapInitialConnectionHint` 中，若本机连接已存在于 `this.hosts` 且此前被硬编码保存为 `"BySpace"`，自动将其重命名为真实主机名 `hint.label`。
- **改了哪些**：
  - `internal/gui/app.go`、`internal/webui/webui.go`
  - `packages/app/src/runtime/host-runtime.ts`
- **怎么验证的**：
  - `go test ./internal/webui/... ./internal/gui/...` 通过；
  - `npm run lint -- packages/app/src/runtime/host-runtime.ts`、`npm run typecheck`、`npm run format:check` 全绿。
- **对 `byissue/` 的影响**：无架构/规格变更，属于默认命名体验修正。
