# 桌面与 Android 壳：Wails v3 约束与分发

## 结论

- 根 `main.go` + `-tags nogui` 编译期切分（`internal/cli/gui_on.go` !nogui / `gui_off.go` nogui）。GUI 构建：无参数或 app/gui/tray → gui.Run；nogui：CGO_ENABLED=0、无 Wails，供 CLI 发布/dev daemon/docker。
- 桌面：Wails v3 单窗口 + 托盘。assets 走 `application.AssetOptions{Handler: webui.Handler}` 进程内服务；AssetServer 是内存伪 HTTP，不解压 Content-Encoding、不能 WebSocket hijack → 注入 `window.__BYSPACE_INITIAL_DAEMON_CONNECTION__`（127.0.0.1:6777 或 BYSPACE_LISTEN），前端 /ws 直连 loopback。
- 主从自愈：每 15s 探 /health，daemon 在跑就 attach，死了就进程内自启。关窗口 = 隐藏 + 托盘常驻（agents 继续跑），Quit 才真关。
- Android：纯远程客户端壳，无本地 daemon/PTY/agent 进程。`runtime.GOOS=="android"` → libwails.so（-buildmode=c-shared）经 WebViewAssetLoader 以 https://wails.localhost 服务 `internal/webui/dist`；必须 MIXED*CONTENT_ALWAYS_ALLOW + usesCleartextTraffic 才能连 LAN ws://（解 PWA 混合内容死锁）。固定 sideload keystore `build/android/byspace-sideload.jks`（ANDROID_KEYSTORE*\* 可覆盖），CI/各机器同指纹 → 覆盖安装保留已配对 host。APK 仅 sideload，不上应用商店，无 iOS。
- 分发：npm 已退役；GitHub Releases 二进制（byspace-cli-<os>-<arch>、BySpace.app zip、桌面二进制、android apk、SHA256SUMS）。install.sh/install.ps1 全平台默认只装 CLI 到 ~/.local/bin（--app/--desktop/BYSPACE_APP=1 才装桌面）——刻意不同于 magpie 的 macOS 默认 .app。自更新 `internal/selfupdate` + `byspace update [check] [--proxy] [--mirror]`，原子替换（Windows moveAside .old），GUI 托盘 "Restart to update to vX.Y.Z"，Android 打开 APK 下载。
- Wails 无边框拖拽只检查直接命中元素的 computed `--wails-draggable`，不爬祖先；属性必须 DOM 字面量 `data-wails-drag`（React 写 {wailsDrag:"true"} 渲染成 wailsdrag → 静默失效）；边缘 resize 需要 `window._wails.setResizable(true)`。
- WebView2 在真实拖拽 resize 或 alt-tab 后丢 TSF caret，IME 候选窗跳到屏幕原点，不自愈；上游 MicrosoftEdge/WebView2Feedback#5675。守卫监听 Go 转发的 `byspace:window-focus`，不能用 DOM focus。此约束常驻直到上游修复。
- daemon 控制 RPC（restart/shutdown）只把 ControlRequest 排给进程 owner；ack 必须先于断连；restart 分支必须占住 main goroutine；teardown 顺序 httpSrv.Shutdown → daemon.RemovePID → srv.Close → StartBackgroundArgs（原 argv）。CLI 必须先走 RPC：StopRunning 按 `serve` 命令行匹配，桌面进程是 `tray`，匹配不到。

## 依据

- 类型：用户决定（2026-10-29 确认，扩展 004）+ 外部观察（Wails/WebView2/Android 平台行为，实测）。
- 被否决的相关方案：Electron（已退役）；Android 跑本地 daemon（壳只做远程客户端）；应用商店分发；npm 分发；macOS 安装默认 .app。
- 证据或复核方式：`bywork/archive/v1/decisions/005-wails-v3-unified-desktop-and-android-client.md`；笔记 `bywork/archive/v1/notes/019-wails-v3-in-process-assets-and-android-mixed-content.md`、`2026-11-05-wails-frameless-windows-drag-and-resize.md`、`2026-11-05-webview2-ime-anchor-after-resize.md`、`2026-11-09-daemon-control-owner.md`；代码 `internal/gui`、`internal/selfupdate`、`build/android/`。
- 适用条件：Wails v3（alpha 阶段 API 可能变）；WebView2 IME 结论基于上游 issue #5675 未修复期间。

## 重访条件

- Wails v3 正式版改变 AssetServer/drag 行为。
- WebView2 上游修复 #5675（届时移除 window-focus 守卫）。
- owner 决定上应用商店或做 iOS。
