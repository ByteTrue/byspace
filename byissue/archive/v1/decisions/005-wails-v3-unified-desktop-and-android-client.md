---
kind: decision
title: "Wails v3 同构延伸桌面端与 Android 客户端（-tags nogui 编译期分离）"
created: 2026-10-29
---

# Decision 005: Wails v3 同构延伸桌面端与 Android 客户端（-tags nogui 编译期分离）

状态：**已确认**（2026-10-29，修订并扩展 [Decision 004](004-go-single-binary-architecture.md)）

## 背景

[Decision 004](004-go-single-binary-architecture.md) 将 Go 后端、CLI、Relay 和内嵌 Web UI 收束为单二进制，但当时暂缓了 Wails 桌面宿主与 `-tags nogui` 编译期分离；而更早的 [Issue 025](../issues/025-x-architecture-retention-audit.md) 退出了沉重的 Electron 包装器与独立 React Native iOS/Android 原生工程。

参照 `magpie` 的单二进制延伸架构与 `wails/v3@v3.0.0` 的桌面 + Android 能力，我们可以在**不引入独立客户端代码库**的前提下，从同一份 Go 入口与内嵌 `internal/webui/dist` 资产直接长出桌面客户端（macOS / Windows / Linux）与 Android 客户端（APK），同时让纯 CLI 与 Docker 容器继续通过 `-tags nogui` 保持 `CGO_ENABLED=0` 零依赖。

## 决策

### 1. 全仓唯一根 `main.go` + `-tags nogui` 编译期一刀切

- 仓库根目录提供统一入口 `main.go`（保留 `cmd/byspace/main.go` 薄入口兼容现有脚本），调用 `cli.Main(version, os.Args[1:], os.Stdout, os.Stderr)`。
- `internal/cli/gui_on.go`（`//go:build !nogui`）与 `internal/cli/gui_off.go`（`//go:build nogui`）隔离 `internal/gui` 依赖：
  - **带 GUI 构建（默认 / Wails 桌面与 Android）**：无参数运行 `byspace`，或显式运行 `byspace app` / `byspace gui` / `byspace tray` 时进入 `gui.Run`。
  - **无头构建（`-tags nogui`）**：`CGO_ENABLED=0 go build -tags nogui` 完全不引入 Wails 与 CGO，用于跨平台 CLI 发布、开发态后台 daemon 与 `docker/Dockerfile` 镜像构建。

### 2. 桌面端：单主窗口 + 系统托盘驻留 + 主从自愈接管

- 桌面端使用 Wails v3（`github.com/wailsapp/wails/v3/pkg/application`）承载单主窗口与系统托盘图标/菜单，不额外开发第二套小面板前端。
- **静态资产与 WebSocket 分工**：
  - 静态前端由 `webui.Handler` 塞入 `application.AssetOptions{Handler: ...}` 进程内直出；
  - 由于 Wails `AssetServer` 是内存伪 HTTP 通道、不支持 WebSocket Hijack，桌面端的 `webui.Handler` 显式将本机 daemon 监听地址（如 `127.0.0.1:6777`）注入 `window.__BYSPACE_INITIAL_DAEMON_CONNECTION__`，前端 `/ws` 直连本机 loopback。
- **主从自愈生命周期**：
  - 启动时探测本机默认 daemon 地址（`127.0.0.1:6777` 或 `BYSPACE_LISTEN`）：若已有 daemon 在跑，桌面端作为纯 UI 附着其上，并后台每 15 秒探测 `/health`，一旦原 daemon 退出则自动在进程内启动 `server.Server` 接管；若未运行则直接在进程内启动。
  - 关闭主窗口时隐藏窗口并保留托盘驻留（不中断运行中的 Agent），通过托盘菜单 `Quit` 或应用退出事件才真正关闭进程内 daemon。

### 3. Android 端：内置完整前端的远程客户端壳 + 局域网明文 `ws://` 直连 + 直接侧载分发

- 只支持 Android（不维护 iOS 原生壳），且只走直接侧载安装（APK），不上架应用商店。
- 使用仓库内置的固定侧载签名证书（`build/android/byspace-sideload.jks`，可通过 `ANDROID_KEYSTORE_*` 覆盖）签名 APK，保证跨机器与 CI 构建出的 APK 签名指纹一致，用户侧载新版本时可直接覆盖升级而不丢失已配对主机数据。
- `runtime.GOOS == "android"` 时，Go 层通过 `libwails.so`（`-buildmode=c-shared`）仅将内嵌的 `internal/webui/dist` 交给 Wails `WebViewAssetLoader`（`https://wails.localhost`）进程内渲染，**不在手机本地启动 `internal/server` daemon、PTY 或 Agent 子进程**，也不注入 localhost 连接提示。
- `build/android` 宿主开启 `WebSettings.MIXED_CONTENT_ALWAYS_ALLOW` 与 `android:usesCleartextTraffic="true"`，使手机 APK 除了支持 Relay（`wss://`）外，还能在局域网 / Tailscale 下直连明文 `ws://` 开发机 daemon（解决浏览器 PWA 的 Mixed Content 死结）。

### 4. 退出 npm 分发，改走 Magpie 式二进制直发与自更新

- **停止 npm 包分发**：不再发布 `@bytetrue/byspace` 到 npm，所有产物（各平台 CLI 无头二进制 `byspace-cli-<os>-<arch>`、macOS `BySpace.app` 压缩包 `byspace-darwin-<arch>.zip`、Windows/Linux 桌面客户端 `byspace-<os>-<arch>`、Android `byspace-android-arm64.apk` 以及汇总的 `SHA256SUMS`）直接发布到 GitHub Releases。
- **一行命令安装脚本（全平台默认统一只装 CLI）**：
  - Unix / macOS / Linux / Termux：`curl -fsSL https://app.byspace.cc.cd/install.sh | sh`，Windows PowerShell：`irm https://app.byspace.cc.cd/install.ps1 | iex`。
  - **跨平台行为统一**：与 Magpie 在 macOS 默认装 `.app`、在其它平台装 CLI 的不一致做法不同，BySpace 的 `install.sh` 与 `install.ps1` 在所有平台上**默认只安装纯 CLI 二进制**（`byspace-cli-<os>-<arch>`）到 `~/.local/bin`；显式传 `--app` / `--desktop`（或 `BYSPACE_APP=1`）时才安装桌面客户端。桌面与移动端用户常规从 GitHub Releases 直接下载安装包（macOS `.dmg`、Windows `.exe`、Linux 桌面二进制、Android `.apk`）。
- **Magpie 式 CLI 与客户端自更新（`internal/selfupdate` + `byspace update` + GUI 后台更新）**：
  - `byspace update [check] [--proxy <url>] [--mirror <prefix>]`：直接查询最新 Release 与 `SHA256SUMS`，校验哈希后原子替换当前二进制或 macOS `BySpace.app` bundle（Windows 下先将运行中的 `.exe` `moveAside` 为 `.old` 再移入新版）。
  - 桌面客户端启动后自动定时检查更新并在后台静默下载校验（staging），就绪后在系统托盘菜单展示 `Restart to update to vX.Y.Z` 一键重启切换，或在退出应用时自动完成替换；Android 客户端检测到新版 APK 时支持一键打开下载侧载覆盖安装。
