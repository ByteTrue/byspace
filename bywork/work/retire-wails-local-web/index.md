---
kind: work
slug: retire-wails-local-web
title: 退役 Wails v3，改为系统托盘 + Local Web / PWA 架构
status: done
updated_at: 2026-11-19
intent: clarify-and-change
complexity: 3
risk: 2
clarity: 3
change_Wait: false
current_unit: 已完成全仓 Wails v3 与 Android APK 退役、系统托盘 + Local Web / PWA 启动、回环免密登录与宿主设置迁移，并通过全量验证
next_action: 交付最终结果
must_hold:
  - 彻底移除 github.com/wailsapp/wails/v3 与 build/android，桌面与移动端均不再使用 Wails WebView 容器
  - 桌面端常驻系统托盘（macOS 菜单栏 Accessory 模式无 Dock 图标、Windows Win32 托盘），点击优先唤醒/拉起已安装 PWA，未安装则用系统默认浏览器打开 Local Web
  - 仅当直连本机回环（127.0.0.1 / ::1 / localhost 且无代理转发头）请求 Local Web HTML 时自动注入 cli-credential 免密登录，局域网/反代访问绝不注入
  - Local Web Settings 在本机回环访问下继续提供开机自启、防休眠、自动更新、CLI 注入 PATH、打开配置目录、备份与接管 Daemon，移除无意义的 Lightweight mode 与 Show in Dock
  -/_byspace/desktop/settings 仅允许本机回环请求且校验回环 Origin，防止跨站或局域网调用宿主操作
proof_gap: none
---

# 退役 Wails v3，改为系统托盘 + Local Web / PWA 架构

## 目标与边界

- **目标**：彻底退役 Wails v3（含桌面端 WebView 窗口与 Android WebView APK），将桌面客户端收敛为「后台 Daemon 守护 + 原生系统托盘 + 点击打开已安装 PWA 或系统默认浏览器 Local Web」，消除三端 WebView 宿主兼容与性能顽疾。
- **非目标**：不改变 Daemon 与 Web 客户端之间的 WebSocket 协议，不改变 Cloudflare Worker E2EE Relay 与多端同步机制。

## 已定方案与约束

1. **桌面形态**：移除桌面端 Wails WebView 窗口。启动桌面应用（`BySpace.app` / `byspace-windows-*.exe` / `byspace app`）时确保本地 Daemon 运行、驻留原生系统托盘并立即打开 Local Web；开机自启（`byspace tray`）仅静默驻留托盘。
2. **优先拉起已安装 PWA**：
   - `web/public/manifest.json` 声明 `launch_handler: { client_mode: ["navigate-existing", "auto"] }`，重复点击聚焦已有窗口。
   - 托盘打开 Local Web 时（无一次性配对 `#offer=` 参数时）按平台探测浏览器已安装的 BySpace PWA（macOS `~/Applications` 下的 Chrome/Edge/Brave/Safari WebApp、Windows `%APPDATA%\Microsoft\Windows\Start Menu\Programs` 下的 `--app-id=` 快捷方式、Linux `~/.local/share/applications/*.desktop`），命中则直接启动独立 PWA 窗口，未安装则回退系统默认浏览器打开 `http://127.0.0.1:6777`。
3. **本机回环免密登录**：`internal/webui` 在直连回环地址（`RemoteAddr` 为 `127.0.0.1`/`::1`、无 `X-Forwarded-For`/`X-Real-IP`/`Forwarded`/`CF-Connecting-IP`、且 `Host` 为回环域名）请求入口 HTML 时，自动将 `$BYSPACE_HOME/cli-credential` 注入 `window.__BYSPACE_INITIAL_DAEMON_CONNECTION__.password`。
4. **宿主管理设置下沉到 Local Web**：`internal/server` 与 `internal/gui` 共享 `/_byspace/desktop/settings`（限制仅直连回环 IP + 回环 `Origin` 可访问）。前端 `DesktopAppSection` 在回环访问下展示开机自启、防休眠、自动更新、CLI 注入 PATH、配置目录、备份与接管 Daemon；移除 `Lightweight mode` 与 `Show in Dock`。
5. **全仓清理 Wails 与 Android APK**：删除 `build/android`、移动端 Wails 桥接、前端 `web/src/platform/wails.ts` 及所有 WebView 专属兼容补丁（红绿灯 Objective-C swizzling、Windows 自定义标题栏与 WebView2 IME 锚点补丁、Linux WebKitGTK 合成器绕过、隐藏窗口杀 WebView 进程等），并从 `go.mod` 移除 `github.com/wailsapp/wails/v3`。

## 行为证明表

| 行为场景 | 触发条件 | 预期结果 | 验证方式与证据 | 状态 |
| --- | --- | --- | --- | --- |
| 本机回环免密注入 | 直连 `http://127.0.0.1:6778/` vs 带 `X-Forwarded-For` 或局域网 Host 请求 `/` | 仅直连回环响应包含 `cli-credential` 的 `password` 字段；代理或非回环请求绝不注入 | `go test -v ./internal/webui/... ./internal/server/... -run TestWebUILoopback` + 实跑 `curl http://127.0.0.1:6778/` 对比带 `X-Forwarded-For` 输出 | 通过 |
| 宿主设置接口安全与读写 | 直连回环 vs 跨源/非回环请求 `/_byspace/desktop/settings` | 直连回环返回宿主设置 JSON 并可修改防休眠/自启/更新策略；非回环或跨源返回 `403 Forbidden` | `go test -v ./internal/gui/... ./internal/server/... -run TestDesktopSettings` + 实跑 `curl -H "Origin: http://127.0.0.1:6778" http://127.0.0.1:6778/_byspace/desktop/settings` | 通过 |
| 已安装 PWA 跨平台探测 | macOS `~/Applications` / Windows Start Menu `.lnk` / Linux `.desktop` 存在或不存在 PWA | 准确识别浏览器安装的 BySpace PWA（且在 macOS 下排除托盘自身的 `com.bytetrue.byspace`），未安装时回退默认浏览器 | `go test -v ./internal/gui/... -run TestFindInstalledPWA` | 通过 |
| 前端回环宿主设置渲染与 Wails 清零 | 在回环地址渲染 Settings 页面 | 展示 Open at login / Prevent sleep / Updates / CLI / Config folder，不含 Show in Dock 与 Lightweight mode，全仓无 Wails 残留 | `cd web && npx vitest run src/screens/settings/desktop-app-section.test.tsx src/utils/confirm-dialog.test.ts src/utils/test-daemon-connection.test.ts --bail=1` | 通过 |
| 全仓构建与交付前审计 | 执行 `make build-full && make build-app`、`npm run typecheck`、`npm run lint`、`node --test scripts/*.test.mjs`、`npm run audit` | `go.mod` 无 `wails` 依赖，二进制构建通过，静态/单测/字段对账/真实无头 Chromium 11/11 全部通过 | 实跑 `npm run audit -- --no-browser` + 启动 dev daemon 实跑 `node scripts/browser-conformance.mjs --base http://127.0.0.1:6778`（11/11 通过） | 通过 |
| 远程更新、远程重启与自动更新重启 | 远程发 `daemon.update.request` / `restart_server_request`，或本地 `ClientUpdater` 触发自动更新重启 / 点击「Restart to update」 | 远程更新完成文件替换（含 macOS `.app` Bundle）后自动向宿主进程发出 `ControlRequest{Restart: true}` 重启；独立 `byspace serve` 与托盘模式均通过标准重启链路优雅关闭并拉起新进程 | `go test -v ./internal/server -run "TestControlRequest|TestDaemonUpdate"` + `go test -v ./internal/gui -run TestDesktopSettingsRestartToUpdateInvokesAutoRelaunch` | 通过 |

## 证据与决定

- `2026-11-19`：完成多轮需求澄清（m00064、m00153、m00159、m00170），确认移除 Wails v3 与 `build/android`，采用原生系统托盘 + Local Web（优先唤醒已安装 PWA）+ 本机回环免密登录 + Local Web 宿主设置方案。
- `2026-11-19`：删除 21 个 Go 侧 Wails/Android 文件、8 个前端 Wails 专属文件及整个 `build/android` 目录；`go mod tidy` 移除 `github.com/wailsapp/wails/v3` 及约 45 个传递依赖；全部单测、契约测试与 `npm run audit`（含 11/11 真实浏览器验证）全绿通过。
