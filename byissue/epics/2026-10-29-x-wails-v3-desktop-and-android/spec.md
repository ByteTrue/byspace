---
kind: epic
title: "Wails v3 同构延伸：从单二进制长出桌面端与 Android 客户端"
type: feature
created: 2026-10-29
---

# Wails v3 同构延伸：从单二进制长出桌面端与 Android 客户端

状态：**已交付关闭**（2026-10-29，核心结论已毕业合并至 [spec/index.md](../../spec/index.md)、[spec/connection.md](../../spec/connection.md) 与 [notes/019](../../notes/019-wails-v3-in-process-assets-and-android-mixed-content.md)）

> **读者：** 实现与维护 BySpace 单二进制跨形态延伸（CLI / Daemon / Docker / Wails v3 Desktop / Wails v3 Android）的人。
>
> **依据：** [Talk 009](../../talks/009-wails-v3-desktop-and-android-extension.md) · [Decision 005](../../decisions/005-wails-v3-unified-desktop-and-android-client.md) · 参考实现 `~/workspace/refs/magpie`

## 目标与架构全景

将 BySpace 打造为与 `magpie` 同构的单一代码库延伸架构：全仓共用同一个根 `main.go`、同一个 `internal/cli` 分发器、同一份 `//go:embed` 前端资产（`internal/webui/dist`），根据编译标签与运行目标自然生长出五种形态：

```text
                        main.go → internal/cli.Main()
                                      │
          ┌───────────────────────────┴───────────────────────────┐
          ▼ (-tags nogui, CGO_ENABLED=0)                          ▼ (!nogui, Wails v3 + CGO)
   ┌─────────────────────────────┐                         ┌─────────────────────────────┐
   │ 纯静态无头单二进制           │                         │ Wails v3 原生宿主 (internal/gui) │
   │  • byspace serve (Daemon)   │                         │  • Desktop (macOS/Win/Linux)│
   │  • byspace web (Browser)    │                         │    单主窗口 + 托盘驻留 +    │
   │  • byspace relay (Docker)   │                         │    后台 Daemon 主从自愈接管  │
   │  • byspace <cli-subcommands>│                         │  • Android (libwails.so+APK)│
   └─────────────────────────────┘                         │    内存直出前端 + 局域网明文 │
                                                           │    ws:// 与 Relay 远程连接   │
                                                           └─────────────────────────────┘
```

## 核心不变量

1. **`-tags nogui` 零 CGO 守卫**：无头构建（CLI、后台 Daemon、E2E 测试二进制、Docker 镜像）使用 `CGO_ENABLED=0 go build -tags nogui`，绝不混入 Wails 或平台 GUI 依赖。
2. **桌面端 WebSocket 与静态资源解耦**：Wails `AssetOptions.Handler` 负责内存直出静态资源；桌面端通过 `webui.Handler.WithExplicitConnectionHint(listenAddr, "BySpace")` 将真实 loopback daemon 地址写入 `window.__BYSPACE_INITIAL_DAEMON_CONNECTION__`，避开 `wails://localhost` 不支持 WebSocket Hijack 的限制。
3. **桌面端与后台 Daemon 共生不冲突**：桌面端启动时若 `127.0.0.1:6777`（或配置的监听地址）已有 daemon 响应 `/health`，直接附着并每 15 秒巡检，原 daemon 退出后自动在进程内拉起 `server.Server` 接管；若未运行则在进程内拉起并写入 PID 锁。
4. **Android 端纯粹性**：`runtime.GOOS == "android"` 下只通过 `WebViewAssetLoader` 提供内嵌前端与深链（`byspace://` / `#offer=`）转发，不在手机端启动本地 `server.Server`；Android WebView 开启 `MIXED_CONTENT_ALWAYS_ALLOW` 与 `usesCleartextTraffic="true"` 支持局域网 `ws://` 直连。

## 纵向切片（Issues）

1. [001-x-magpie-entry-and-nogui-split.md](issues/001-x-magpie-entry-and-nogui-split.md) — 根 `main.go` 统一入口、`gui_on.go`/`gui_off.go`（`-tags nogui`）分离与构建链对齐
2. [002-x-wails-v3-desktop-host-and-daemon-takeover.md](issues/002-x-wails-v3-desktop-host-and-daemon-takeover.md) — `internal/gui` Wails v3 桌面客户端（主窗口、托盘驻留、显式连接注入、后台 Daemon 主从自愈接管）
3. [003-x-wails-v3-android-client.md](issues/003-x-wails-v3-android-client.md) — Wails v3 Android 客户端（`build/android` 工程、JNI `libwails.so` 构建链、局域网明文 `ws://` 放行与 APK 打包验证）
4. [004-x-magpie-style-self-update-cli-and-app.md](issues/004-x-magpie-style-self-update-cli-and-app.md) — Magpie 式 CLI（`byspace update`）与客户端（桌面端后台预下载+托盘重启更新 / Android APK 更新）自更新体系
5. [005-x-direct-binary-distribution-and-installers.md](issues/005-x-direct-binary-distribution-and-installers.md) — 退出 npm 分发：`install.sh`（curl）与 `install.ps1`（pwsh）安装脚本、macOS `.app` 打包、Android 固定侧载签名与 GitHub Releases 二进制直发工作流
