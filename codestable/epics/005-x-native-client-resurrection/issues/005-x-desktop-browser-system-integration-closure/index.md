---
kind: issue
id: 5
parent: 5
title: Desktop Browser 与系统集成闭环
status: closed
closed: 2026-08-26
---

# Desktop Browser 与系统集成闭环

## 目标

在 Electron core/package 闭合之后，恢复并验证 Desktop Browser workbench、CDP automation、daemon Browser Tools broker，以及 dialog、notification、editor、file path 等宿主能力；Renderer 继续只通过 typed preload 使用受限能力，不能获得任意 Electron IPC 或 CDP。

## 已交付范围

- Desktop Browser workbench：resident WebContents、workspace Browser tab、地址栏/导航、会话 partition、下载与 Browser keyboard policy。
- Browser Automation：tab registry、CDP session、ARIA snapshot、可信输入、截图、导航、等待、日志、evaluate、dialog handling 与完整协议 schema。
- daemon/tool 纵向链路：客户端 `browser_host` capability、WebSocket client registration、`BrowserToolsBroker`、Browser policy、10 个 agent Browser tools，以及 execute request/response 回路。
- typed preload/system bridge：window、dialog、notification、opener、editor、webUtils、menu、Browser 和 attachment file operations；未向 Renderer 暴露通用 `ipcRenderer` 或原始 CDP session。
- App integration：Browser panel/tab、resident webview surface plane、Desktop settings/permissions/updates、supporting side-panel routing 与 Desktop attachment store。

## 验证证据

### 聚焦测试

- App Browser/handler：3 files / 7 tests passed。
- Protocol Browser Automation：1 file / 11 tests passed。
- Client daemon Browser response：1 file / 3 tests passed。
- Server broker/policy/tools/WebSocket：6 files / 81 tests passed。
- Desktop 全量聚焦测试在 Electron core 检查点已通过：23 files / 188 tests。
- App、Protocol、Client、Server、Desktop typecheck/build 均通过。

### 真实 macOS Electron smoke

使用隔离 `BYSPACE_HOME=/tmp/byspace-browser-smoke-home`、daemon `127.0.0.1:6768`、Metro `8087` 和 Electron CDP `9223` 启动开发宿主；生产 daemon `127.0.0.1:6777` 的 PID 始终为 `13695`，未被停止或重启。

1. 通过真实 UI 建立 Workspace Browser tab，默认页 `https://example.com/` 正常显示。
2. `window.byspaceDesktop.browser` 仅暴露受限 typed methods，partition 为 `persist:byspace-browser`。
3. 经 typed Browser bridge 执行真实 automation：
   - `list_tabs` 返回真实 browser ID、workspace ID、URL、title 与 active/loading 状态；
   - `snapshot` 返回 `aria-yaml`，9 nodes、1 ref，含 `Learn more [ref=@e1]`；
   - `screenshot(fullPage)` 返回 880×692 PNG；
   - `navigate` 到 `https://example.org/`；
   - `wait(text="Example Domain")` 命中；
   - `evaluate` 返回 `title=Example Domain`、`href=https://example.org/` 与 H1。
4. 截图证据：`/tmp/byspace-browser-tab-created.png` 与 `/tmp/byspace-browser-automation.png`；结构化结果：`/tmp/byspace-browser-automation-results.json`、`/tmp/byspace-browser-automation-evaluate.json`。
5. 隔离 daemon 通过 lifecycle RPC 优雅退出；生产 daemon PID 保持不变。

### 当前 packaged macOS Browser 交互 smoke

在当前 `mac-arm64/BySpace.app` 上又使用隔离 `BYSPACE_HOME=/tmp/byspace-electron-browser-home`、持久化 daemon `127.0.0.1:16790` 与 `BYSPACE_ELECTRON_USER_DATA_DIR=/tmp/byspace-electron-browser-user-data` 执行真实交互：

1. Desktop 从 `stopped` 状态通过 packaged Helper 启动 managed daemon，第一次轮询即为 `running`；Renderer 随后完成 direct hello。
2. Browser WebView 以真实 Browser ID 注册，隔离 user data 中生成共享 `Partitions/byspace-browser` profile。
3. WebView 中的本地 smoke 页面实际触发 `Run` 按钮；guest console 在 `18:07:03` 输出页面唯一标记 `byspace-browser-smoke-clicked`，证明当前 packaged Browser surface 的真实页面交互路径执行成功。
4. Desktop 与 daemon 稳定运行约 502 秒后通过 lifecycle RPC 优雅退出；worker code 0、16790 listener 与测试进程均无残留，生产 6777 daemon PID `13695` 保持不变。

## 边界

本检查点证明 Desktop Browser/CDP 与 daemon broker 的源码、协议、测试和真实宿主行为闭合。公开签名包、自动发布、Windows/Linux 运行 smoke 与第三方 Browser 权限模型不在本检查点；这些仍由发布检查点和后续平台验收处理。
