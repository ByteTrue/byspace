---
kind: issue
title: "Windows 子进程 CREATE_NO_WINDOW 防弹黑框、客户端原生通知与 Tunnel 固定本地端口"
type: ff
status: closed
created: 2026-10-29
closed: 2026-10-29
---

# Windows 子进程 CREATE_NO_WINDOW 防弹黑框、客户端原生通知与 Tunnel 固定本地端口

- **做了什么**：
  1. **彻底消除 Windows 客户端子进程弹黑框（对齐 Magpie `internal/proc`）**：Windows 桌面端以 `-H windowsgui` 编译无自身控制台，此前业务包直接调用 `exec.Command` 探测 `pi --version`、运行 `git` 或 `powershell` 时 Windows 会为每个子进程新建并闪烁黑框。在 `internal/proc` 新增 `proc.Command` / `proc.CommandContext` / `proc.HideWindow`（无控制台时自动设置 `CREATE_NO_WINDOW = 0x08000000`），替换全仓 15 个业务包中的 `exec.Command` 并加上静态守卫测试 `TestNoRawExecCommandInWindowsCompiledPackages`。
  2. **通知（Notifications）在 Web 与客户端统一可用**：桌面/Android 客户端的嵌入式 WebView 不接入浏览器 FCM Web Push 服务，此前调用 `serviceWorker.register` + `pushManager.subscribe` 会导致按钮卡在 `Enabling...`。在 `web-subscription.ts` 中识别 Wails 原生容器，直接开启/关闭本地原生通知并在后台 Agent 完成任务且窗口未聚焦时触发系统通知。
  3. **Tunnel 支持固定本地端口（`localPort`）与同 Peer 多端口合并**：在协议、SDK、`internal/tunnel` 与前端新建 Tunnel 弹窗中支持指定固定 `localPort`；未显式填写时自动将首次分配的端口持久化回 `tunnels.json`，后续重连与重启固定绑定同一本地端口；同时修复 `Registry.Add` 向同一 Peer 添加第二个端口（如 `3425` 后再加 `3430`）时覆盖已有端口的问题。
- **改了哪些**：
  - `internal/proc/proc.go`、`proc_windows.go`、`proc_other.go`、`no_raw_exec_test.go` 及 `internal/` 下 15 个业务文件
  - `packages/app/src/push-notifications/internal/web-subscription.ts`
  - `packages/protocol/src/messages.ts`、`packages/client/src/daemon-client.ts`、`internal/tunnel/manager.go`、`internal/tunnel/registry.go`、`internal/tunnel/registry_test.go`、`internal/server/tunnels.go`、`packages/app/src/screens/tunnels-screen.tsx`
- **怎么验证的**：
  - `go test -v ./internal/proc/... ./internal/tunnel/...` 全部通过（含 `TestNoRawExecCommandInWindowsCompiledPackages` 与 `TestRegistryPinsLocalPortAcrossRestartsAndMergesForwards`）；
  - `CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build`、`npm run build:client`、`npm run typecheck`、`npm run lint` 全绿。
- **对 `byissue/` 的影响**：已同步记录至 [`byissue/notes/019-wails-v3-in-process-assets-and-android-mixed-content.md`](../notes/019-wails-v3-in-process-assets-and-android-mixed-content.md) 第 5 节。
