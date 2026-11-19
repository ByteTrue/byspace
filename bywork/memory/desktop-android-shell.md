# 桌面与移动端壳：托盘宿主 + Local Web / PWA（退役 Wails v3）

## 结论

- 根 `main.go` + `-tags nogui` 编译期切分（`internal/cli/gui_on.go` !nogui / `gui_off.go` nogui）。GUI 构建：无参数或 `app`/`gui` 启动或复用单实例托盘进程并立即打开前端（优先唤醒本机已安装的 BySpace PWA 独立窗口，未安装时用系统默认浏览器打开 `http://127.0.0.1:6777`）；`tray`（开机自启入口）仅后台驻留托盘并看护 Daemon，不主动弹浏览器。`nogui`：CGO_ENABLED=0，供 CLI 发布/dev daemon/docker。
- 全仓不依赖 `wails/v3`，桌面端无内置 WebView 窗口，所有 UI 统一由 Daemon 托管的 Local Web（`internal/webui`）在系统浏览器或已安装 PWA 中渲染。macOS 下托盘进程固定以菜单栏模式（`NSApplicationActivationPolicyAccessory`）运行，不占 Dock 图标。
- 本机免密自动登录：当 HTTP 请求直接来自本机回环地址（`127.0.0.1` / `[::1]`）时，`internal/webui` 自动向 HTML 注入本机 `cli-credential` 到 `window.__BYSPACE_INITIAL_DAEMON_CONNECTION__.password`，使托盘点开、浏览器访问 `127.0.0.1:6777` 或从桌面 PWA 启动均自动免密连接；非回环地址绝不注入凭证，严格要求密码验证。
- 主从自愈与宿主机设置：`DaemonSupervisor` 每 15s 探 `/health`，daemon 在跑就 attach，死了就进程内自启。宿主机设置（`/_byspace/desktop/settings`：开机自启 `openAtLogin`、防休眠 `keepAwake`、自动更新、添加 CLI 到 PATH、打开配置目录、接管 Daemon）挂载在本机 Daemon / 宿主服务上，供本机回环授权的 Local Web Settings 页面和托盘调用；不保留旧 WebView 窗口专属的 `Lightweight mode` 与 `Show in Dock`。
- 移动端：统一使用浏览器或已安装 PWA 访问（通过 E2EE Relay `wss://` 或局域网 HTTP Local Web `http://<LAN-IP>:6777`），不维护 `build/android` APK。
- 分发：GitHub Releases 二进制（`byspace-cli-<os>-<arch>`、`BySpace.app` zip / dmg、桌面二进制、`SHA256SUMS`）。`install.sh`/`install.ps1` 全平台默认只装 CLI 到 `~/.local/bin`（`--app`/`--desktop`/`BYSPACE_APP=1` 才装桌面）。自更新 `internal/selfupdate` + `byspace update [check] [--proxy] [--mirror]`，原子替换（Windows moveAside `.old`），托盘支持 "Restart to update to vX.Y.Z"。
- daemon 控制 RPC（restart/shutdown）只把 ControlRequest 排给进程 owner；ack 必须先于断连；restart 分支必须占住 main goroutine；teardown 顺序 `httpSrv.Shutdown` → `daemon.RemovePID` → `srv.Close` → `StartBackgroundArgs`（原 argv）。CLI 必须先走 RPC：StopRunning 按 `serve` 命令行匹配，桌面进程是 `tray`，匹配不到。

## 依据

- 类型：用户决定（2026-11-19 确认，更新自 2026-10-29 扩展 004）+ 外部观察（Wails v3 alpha 在三端 WebView 的维护代价与平台缺陷实测）。
- 被否决的相关方案及理由：
  - **Wails v3 桌面内置 WebView 单窗口 + Android `libwails.so` APK**（最强理由：自带独立窗口与标题栏，Android WebView 可配置 `MIXED_CONTENT_ALWAYS_ALLOW` 让 HTTPS 壳直连局域网明文 `ws://`。否决原因：Local Web 已具备 100% 业务能力，而 Wails v3 alpha 迫使仓库维护大量脆弱的三端 WebView 补丁——macOS Objective-C 红绿灯居中与 `WKWebView` 隐藏内存泄漏强拆、Windows 无边框边缘缩放失效/标题栏 Canvas 采样染色/单线程 COM 通知循环/WebView2 `#5675` 输入法候选窗跳原点、Linux Wayland WebKitGTK 闪屏与 CPU 暴涨，客户端体验仍不如系统浏览器及浏览器原生 PWA）。
  - Electron（体积与双运行时负担重，已退役）；Android 跑本地 daemon（移动端只做远程客户端）；应用商店分发；npm 分发；macOS 安装默认 `.app`。
- 证据或复核方式：`internal/gui/`、`internal/server/`、`internal/webui/`、`internal/selfupdate/`；历史记录 `bywork/archive/v1/decisions/005-wails-v3-unified-desktop-and-android-client.md`。
- 适用条件：系统默认浏览器及 Chromium/Safari 的本地 PWA 机制。

## 重访条件

- 需要在无浏览器的嵌入式桌面环境提供独立渲染器。
- owner 决定重新提供原生移动商店包（iOS / Android）。
