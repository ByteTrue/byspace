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

## 3. 桌面端隐藏标题栏、拖拽光标与本地免密直连

- **本机密码开启时的客户端自动直连**：若 `config.json` 配置了访问密码（`daemon.auth.password`），桌面窗口在 `window.__BYSPACE_INITIAL_DAEMON_CONNECTION__` 中必须附带 `server.EnsureCLICredential(homeDir)`（作为 `password` 令牌），否则窗口首次连接 `ws://127.0.0.1:6777/ws` 会因 401 退回 `Welcome to BySpace`。
- **Wails v3 顶栏拖拽与 WebKit I-beam 光标**：Wails v3 的 `--wails-draggable: drag` 依赖页面引入 `/wails/runtime.js`（`drag.ts`）；且 `drag.ts` 在 `mousedown` 时未调 `preventDefault()`，导致 macOS `WKWebView` 在第一帧 `mousemove` 前误启动文本选择状态机并将光标切为 I 型。必须在顶栏 `mousedown` 捕获阶段同时设置 `-webkit-user-select: none; cursor: default` 并调用 `e.preventDefault()`。
- **macOS Dock 图标网格比例**：Apple macOS Big Sur+ HIG 要求 1024×1024 画布内圆角矩形主体占中央 824×824（四周各 100px 透明边距），零边距满铺图在 Dock 中会比标准应用大 24%。

## 4. 轻量模式释放 WKWebView 与 Wails 主线程调用死锁红线

- **轻量模式销毁窗口前必须先解绑 `WKWebView`**：在 macOS 上仅对 Wails `WebviewWindow` 调用 `Close()` 不会立即释放 `WKWebView` 及其关联的 `com.apple.WebKit.WebContent` 进程（因 delegate 与 `WKUserContentController` 强引用环）。必须在主线程先执行 `dropWebView`（清空 `navigationDelegate`、`UIDelegate`、`removeAllScriptMessageHandlers` 并 `removeFromSuperview`）再调 `Close()`。
- **严禁在 `app.Run()` 启动前或 `InvokeSync` 回调内调用 `application.InvokeSync`**：在 `app.Run()` 启动 Cocoa 主事件循环之前调用 `application.InvokeSync`，或在已经在主线程运行的 `InvokeSync` 闭包内嵌套调用 `InvokeSync`（底层为 GCD `dispatch_sync(dispatch_get_main_queue())`），会直接造成主线程死锁导致应用无法打开窗口。初始原生窗口配置须挂在 `events.Common.ApplicationStarted` 之后，且原生层操作优先使用 `application.InvokeAsync`。

## 5. 跨平台桌面宿主深度适配要点（吸收自 Magpie v0.1.2030）

- **macOS 从 `Accessory` 重新加入 Dock 时的 `Cmd+Tab` 排序（`activateAgain`）**：处于 `NSApplicationActivationPolicyAccessory`（无 Dock 图标）的应用在重新切回 `Regular` 并激活窗口时，macOS 会将其排在 `Cmd+Tab` 列表末尾；必须先短暂激活 `com.apple.dock` 再立即调 `[NSApp activateIgnoringOtherApps:YES]` 才能排到 `Cmd+Tab` 首位。
- **macOS `LaunchAgents` 开机自启的 `AbandonProcessGroup`**：通过 `LaunchAgents` 开机自启的进程在执行自更新退出时，若 plist 未声明 `<key>AbandonProcessGroup</key><true/>`，`launchd` 会在主进程退出瞬间杀死整个进程组，导致负责拉起新版本的重启脚本一并被杀。
- **Linux Wayland 与无 GPU 环境下的 WebKitGTK 合成器保护**：在 Wayland 会话或无法打开 `/dev/dri/renderD*` 硬件渲染节点的 X11 环境（VNC/xrdp）下，WebKitGTK 的默认加速合成会导致点击闪烁或触发 `llvmpipe` 占用 400%+ CPU；需在创建首个窗口前自动设置 `WEBKIT_DISABLE_COMPOSITING_MODE=1`。
- **Windows `-H windowsgui` 双重身份的控制台借用**：Windows 桌面二进制使用 `-H windowsgui` 消除双击黑框后，启动时无标准流；当在 PowerShell/cmd 中带子命令参数运行时自动调用 `kernel32.dll` 的 `AttachConsole(ATTACH_PARENT_PROCESS)` 并重新打开 `CONOUT$`/`CONIN$`，使同一个 `.exe` 兼具无黑框 GUI 与终端 CLI 输出能力。
