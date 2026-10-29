---
kind: note
title: "Wails v3 进程内 AssetServer 的两处隐性限制与 Android 局域网 ws:// 放行"
created: 2026-10-29
---

# Wails v3 进程内 AssetServer 的两处隐性限制与 Android 局域网 ws:// 放行

在将 Go 单二进制通过 `github.com/wailsapp/wails/v3`（`v3.0.0`）延伸为桌面端与 Android 客户端时，Wails 进程内 `AssetOptions.Handler` 与 Android WebView 默认模板有两处容易导致白屏或断连的底层行为：

## 1. 自定义 Scheme 拦截器不解压 `Content-Encoding` 且不支持 WebSocket Hijack

- **不解压 `br`/`gzip`**：Wails 在桌面端（macOS `WKURLSchemeTask`、Linux `WebKitURISchemeRequest`）与 Android 端（`WebViewAssetLoader` 的 `WailsPathHandler.shouldInterceptRequest`）通过内存直接把 `http.ResponseWriter` 写出的字节塞给 WebView，**不经过系统 HTTP 网络栈的 `Content-Encoding` 解压层**。若 `webui.Handler` 按 `Accept-Encoding` 直接返回 `.js.br` 或 `.js.gz` 原始压缩字节，WebView 会把压缩流当成 JS 源码解析并直接白屏。
  - **解法**：传给 Wails `AssetOptions.Handler` 的静态处理器必须启用 `WithoutPrecompression()`（忽略预压缩直出，若磁盘上大于 1MB 的未压缩 `.js` 已被构建脚本删除，则在 Go 内存里用 `gzip.NewReader` 解压 `.js.gz` 后返回未压缩字节流）。
- **不支持 WebSocket Upgrade**：`AssetOptions.Handler` 是无 TCP 连接的内存请求通道，未实现 `http.Hijacker`，前端不能向 `ws://wails.localhost/ws` 发起 WebSocket 握手。
  - **解法**：桌面端渲染 `index.html` 时通过 `WithExplicitConnectionHint(listenAddr, "BySpace")` 注入本机 daemon 的真实 loopback 地址（如 `127.0.0.1:6777`），让静态资源走 Wails 内存直出、`/ws` 走本机 TCP loopback。

## 2. Android `https://wails.localhost` 的 Mixed Content 拦截与深链透传

- Wails v3 的 Android 宿主默认在 `https://wails.localhost` 下加载页面，且 `MainActivity.java` 默认设置 `WebSettings.MIXED_CONTENT_NEVER_ALLOW`。这会同时触发两层拦截：
  1. Android 系统 WebView 拦截从 `https://wails.localhost` 连往局域网明文 `ws://192.168.x.x:6777/ws` 的请求；
  2. 前端 `assertDirectTcpConnectionAllowed` 看到 `window.location.protocol === "https:"` 会误判当前处于远端托管的 HTTPS 网页而主动抛错。
- **解法**：
  1. `build/android/app/src/main/java/com/wails/app/MainActivity.java` 设为 `WebSettings.MIXED_CONTENT_ALWAYS_ALLOW`，并在 `loadApplication()` 与 `onNewIntent()` 中解析 `byspace://` Intent URI 映射为 `https://wails.localhost/#offer=...`；
  2. `build/android/app/src/main/AndroidManifest.xml` 开启 `android:usesCleartextTraffic="true"`；
  3. 前端 `readBrowserConnectionContext()` 识别 `window.location.hostname === "wails.localhost"`（或 `"wails" in window`）为原生 WebView 容器，放行非 TLS 局域网 Direct TCP。
