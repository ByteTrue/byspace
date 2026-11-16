---
kind: talk
title: "学习 Magpie 同构架构：用 Wails v3 延伸桌面端与 Android 客户端"
created: 2026-10-29
---

# 学习 Magpie 同构架构：用 Wails v3 延伸桌面端与 Android 客户端

## 背景

Go 核心重写（[Decision 004](../decisions/004-go-single-binary-architecture.md)）已完成 CLI、Daemon、内嵌 Web UI 与 Relay 的单二进制合一，但当时将 Wails 桌面壳与 `-tags nogui` 编译期分离暂缓在外。

重新对照 `~/workspace/refs/magpie` 源码后，Magpie 之所以能让 CLI、后台服务、Docker 镜像、桌面客户端看起来全都是同一套代码的自然延伸，靠的是四个机关：

1. **全仓唯一根 `main.go` + `internal/cli` 统一分发**：无参或 `app`/`gui`/`tray` 走桌面窗口，其余子命令走 `serve`/`web`/`relay`/`healthcheck` 与 CLI。
2. **同一个静态/API `http.Handler` 换壳复用**：浏览器模式挂在 `net.Listen` 上；桌面与移动模式直接塞进 Wails v3 的 `application.AssetOptions{Handler: ...}` 内存直出。
3. **`//go:build !nogui` 与 `-tags nogui` 编译期一刀切**：桌面与移动端编译带 Wails GUI；纯 CLI 交叉编译与 Docker 镜像用 `CGO_ENABLED=0 go build -tags nogui` 剥离 CGO/GUI 依赖。
4. **主从自愈接管（`startBackend` + `watchBackend`）**：桌面端启动时若检测到本机后台已有 daemon 在跑，自动退化为附着其上的 UI 窗口并持续探测；一旦后台 daemon 退出，桌面端在进程内无缝接管。

同时，`github.com/wailsapp/wails/v3`（`v3.0.0`）已提供实验性但完整的 Android 支持：同一份根 `main.go` 与内嵌前端通过 `GOOS=android` + NDK 编译为 `libwails.so`（`-buildmode=c-shared`），由生成的 Gradle 宿主（`MainActivity` + `WebViewAssetLoader`）在进程内加载。

## 确认的 4 项决策

1. **桌面端与后台 Daemon 共生方式**：采用 Magpie 式「主从自愈 + 托盘驻留」——本机 `127.0.0.1:6777` 已有 daemon 时桌面端直接附着并后台监测（退出则自动接管）；未运行时桌面端在进程内拉起 daemon。点窗口关闭按钮隐藏至托盘保活 Agent，从托盘菜单 Quit 才真正退出。
2. **桌面端窗口形态**：采用「单主窗口 + 系统托盘图标/菜单」，复用现有响应式前端（`packages/app`），不额外开发第二套托盘下拉小面板 UI。
3. **Android 端运行模式与连接能力**：`GOOS == "android"` 时只做 Wails WebView 内存静态资源宿主（直出 `internal/webui/dist`，不在手机本地起 `internal/server` daemon/PTY/Agent），并在 `build/android` 的 `MainActivity.java` 与 `AndroidManifest.xml` 中开启 `MIXED_CONTENT_ALWAYS_ALLOW` 与 `usesCleartextTraffic="true"`，解除浏览器 PWA 无法直连局域网明文 `ws://` 的限制，同时支持深链配对透传。
4. **仓库入口与构建标签对齐 Magpie**：根 `main.go` + `internal/gui` + `internal/cli/gui_on.go` / `gui_off.go`（`-tags nogui`），修订 [Decision 004](../decisions/004-go-single-binary-architecture.md) 中「不做桌面壳」的旧边界，形成 [Decision 005](../decisions/005-wails-v3-unified-desktop-and-android-client.md)。

## 落地路径

见 [Epic: Wails v3 桌面端与 Android 客户端同构延伸](../epics/2026-10-29-x-wails-v3-desktop-and-android/spec.md)。
