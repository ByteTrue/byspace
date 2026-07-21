---
id: terminal-clipboard-image-paste
title: Terminal clipboard image paste
type: change
status: closed
parent: .cs/epics/2026/07/21/terminal-experience/spec.md
created: 2026-07-21
closed: 2026-07-21
---

Derived from: [Terminal 原始性能基线与差距定位](./open-terminal-direct-baseline/index.md)

## Evidence

用户在 Windows + Pi CLI 中使用 BySpace Terminal 时，`Ctrl+V` 无法像原生 Terminal 一样粘贴剪贴板图片；Pi 在 Windows 的默认图片绑定是 `Alt+V`，但原样把该 chord 送到远端 Pi 只会读取 daemon 主机剪贴板，仍拿不到浏览器本机图片。

代码追踪表明：

- BySpace 浏览器 Terminal 当前在 `Ctrl/Cmd+V` 时只调用 `navigator.clipboard.readText()`；剪贴板只有图片时得到空文本，输入被静默丢弃。
- Pi CLI 自身会读取剪贴板图片、写到本机临时目录并把路径插入编辑器；浏览器无法直接调用 Pi 所在机器的本机剪贴板。
- Orca Web 的远程链路会读取浏览器剪贴板图片、上传到 daemon 临时目录，再把 daemon 返回的文件路径通过 `terminal.paste(...)` 送入 PTY。
- BySpace 已有 `upload_file_request` 二进制上传、daemon 临时文件写入和 Relay 传输能力，不需要新增文件上传 RPC。

## Goal

让 BySpace Web Terminal 的 `Ctrl/Cmd+V` 在剪贴板只有受支持图片时，把图片上传到当前 daemon 并将 daemon 本地文件路径作为一次 paste 插入当前 Terminal；Windows `Alt+V` 在浏览器剪贴板含图片时执行同一路径，没有图片时继续透传给 Terminal 应用。文本剪贴板行为保持不变。

## Acceptance criteria

1. 剪贴板存在非空文本时继续优先执行文本粘贴，不读取或上传图片。
2. 剪贴板没有文本、但存在 PNG/JPEG/GIF/WebP 图片时：
   - 读取图片 bytes；
   - 通过现有 `uploadFile` RPC 上传到当前 daemon；
   - 仅在上传成功后，把返回的 daemon 本地 path 交给 Terminal；
   - 无论 xterm 是否观测到 mode 2004，路径都带 `ESC[200~` / `ESC[201~` 一次性进入 PTY。
3. 单张图片上限与现有 Composer 文件上传一致，为 50MB；超限、剪贴板读取失败和上传失败均显示用户可见错误，不把半成品路径送入 PTY。
4. Windows `Alt+V` 仅在浏览器剪贴板含受支持图片时接管图片上传；没有图片、Clipboard API 不可用或没有图片上传回调时，以当前 input mode 编码原 chord 并透传给 Terminal 应用。其他平台的 `Alt+V` 始终原样透传。
5. 新 client 连接不支持该能力的旧 daemon 时不尝试上传，并显示“更新 host”提示；能力通过 `server_info.features.terminalClipboardImage` 单点检测。
6. Direct 和 Relay 共用相同语义与现有加密上传链路；不得增加仅 Direct 可用的旁路。
7. 不新增上传 RPC、不把图片渲染到 Terminal、不把 base64 文本送入 PTY。
8. 浏览器级测试覆盖图片剪贴板到 daemon 文件路径输入，验证上传后的 bytes；runtime 测试覆盖文本优先、图片路径 paste、Windows `Alt+V` 图片分支及无图片 fallback。
9. Raw Direct 性能基线不得明显退化。

## Change surface

- `packages/app/src/terminal/runtime/terminal-emulator-runtime.ts`
  - 文本优先的剪贴板读取；无文本时识别受支持图片；通过回调取得 daemon path 后强制作为一个 bracketed block 输入。
- `packages/app/src/components/terminal-emulator.tsx`
  - 透传图片上传与粘贴错误回调。
- `packages/app/src/components/terminal-pane.tsx`
  - 单点 capability gate；调用现有 `client.uploadFile()`；显示错误 toast。
- `packages/protocol/src/messages.ts`
  - 增加 optional `server_info.features.terminalClipboardImage`。
- `packages/server/src/server/websocket-server.ts`
  - 宣告 capability；复用现有 upload handler。
- Terminal runtime browser test、ServerInfo schema test、隔离 daemon E2E。

## Non-goals

- 从 daemon 操作系统剪贴板读取图片。
- 支持任意文件类型或一次粘贴多张图片。
- 新建图片专用协议或上传服务。
- 修改 Pi CLI 的图片解析逻辑。
- 以 `Alt+V` 作为跨平台或文本粘贴快捷键。

## Execution record

- 浏览器 runtime 保持文本优先；空文本时通过 Async Clipboard API 识别 PNG/JPEG/GIF/WebP，50MB 前置上限后把 bytes 交给上层。
- TerminalPane 只在 `server_info.features.terminalClipboardImage` 为 true 时复用现有 `client.uploadFile()`；runtime 成功取得 daemon path 后不依赖 xterm live mode，始终强制作为一个 bracketed block 输入。
- 新 daemon 宣告 optional capability；未新增 RPC、binary opcode 或 Direct 旁路。
- `Ctrl/Cmd+V` 由标准 paste 处理器接管；Windows `Alt+V` 只在 clipboard 含图片时走上传路径，无图片时通过 `onTerminalKey` 透传原 chord；其他平台的 `Alt+V` 和所有平台的 `Ctrl+Shift+V` 保留给终端应用/浏览器。
- 增加多语言 clipboard 读取、超限和旧 host 提示。
- 异步 clipboard image paste 通过 Promise 链串行化；连续标准 paste 或 Windows image `Alt+V` 按触发顺序上传和插入，terminal unmount 后 stale path 不会进入新实例。普通键入仍保持即时，不为异步上传引入全局输入 scheduler。

## Validation

- `npm --prefix packages/app run test:browser -- src/terminal/runtime/terminal-emulator-runtime.browser.test.ts --bail=1`：31/31 通过；覆盖文本优先、mode 2004 off 时图片 path 强制 bracketed paste、50MB 前置拒绝、Windows shortcut/context-menu 多行 framing、`Alt+V` 图片分支、无图片透传 fallback，以及 clipboard read 失败只报错而不误触发远端 chord。
- `npm --prefix packages/app run test:e2e -- e2e/terminal-clipboard.spec.ts --workers=1`：4/4 通过；Windows platform 下分别用 `Ctrl+V` 与 `Alt+V` 从浏览器图片 clipboard 经真实 `file.upload.request` 写入隔离 daemon，在 capture PTY 未启用 mode 2004 时仍验证单个 bracketed path block 与完整服务端 bytes；另覆盖 mode-off Windows 多行文本和 snapshot restore。
- `npx vitest run packages/protocol/src/terminal-input-mode.test.ts packages/protocol/src/messages.terminal-restore.test.ts --bail=1`：14/14 通过；新 feature optional schema 可解析。
- Direct raw baseline：idle p95 8.7ms、loaded p95 10.3ms、TUI p95 9.6ms、50k parse 95.0ms、resize p95 20.6ms，无明显退化。
- `npm run typecheck`、`npm run lint`、`npm run format:check`、App Web export 与 `git diff --check`：通过。
