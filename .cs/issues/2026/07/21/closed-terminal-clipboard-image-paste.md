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

- 首版图片支持在 `Ctrl/Cmd+V` 的 `keydown` 阶段提前调用 Async Clipboard API；这会阻止浏览器产生可信 `paste` 事件，并拿不到 PixPin 等截图工具只在 `ClipboardEvent.clipboardData` 中提供的图片 flavor。
- Pi CLI 自身会读取剪贴板图片、写到本机临时目录并把路径插入编辑器；浏览器无法直接调用 Pi 所在机器的本机剪贴板。
- Orca Web 的远程链路会读取浏览器剪贴板图片、上传到 daemon 临时目录，再把 daemon 返回的文件路径通过 `terminal.paste(...)` 送入 PTY。
- BySpace 已有 `upload_file_request` 二进制上传、daemon 临时文件写入和 Relay 传输能力，不需要新增文件上传 RPC。

## Goal

让 BySpace Web Terminal 的标准 `Ctrl/Cmd+V` 回归浏览器可信 `paste` 事件：同一事件包含受支持图片时始终把图片上传到当前 daemon，并将 daemon 本地文件路径作为一次 paste 插入当前 Terminal；只有无图片时才粘贴 `text/plain`。Windows `Alt+V` 在浏览器剪贴板含图片时执行同一上传路径，没有图片时继续透传给 Terminal 应用。

## Acceptance criteria

1. 剪贴板事件存在 PNG/JPEG/GIF/WebP 图片时，无论是否同时存在文本都优先统一上传图片；只有无图片且存在非空文本时才执行文本粘贴。
2. 存在受支持图片时：
   - 读取图片 bytes；
   - 通过现有 `uploadFile` RPC 上传到当前 daemon；
   - 仅在上传成功后，把返回的 daemon 本地 path 交给 Terminal；
   - 无论 xterm 是否观测到 mode 2004，路径都带 `ESC[200~` / `ESC[201~` 一次性进入 PTY。
3. 单张图片上限与现有 Composer 文件上传一致，为 50MB；超限、剪贴板读取失败和上传失败均显示用户可见错误，不把半成品路径送入 PTY。
4. Windows `Alt+V` 仅在浏览器剪贴板含受支持图片时接管图片上传；没有图片、Clipboard API 不可用或没有图片上传回调时，以当前 input mode 编码原 chord 并透传给 Terminal 应用。其他平台的 `Alt+V` 始终原样透传。
5. 新 client 连接不支持该能力的旧 daemon 时不尝试上传，并显示“更新 host”提示；能力通过 `server_info.features.terminalClipboardImage` 单点检测。
6. Direct 和 Relay 共用相同语义与现有加密上传链路；不得增加仅 Direct 可用的旁路。
7. 不新增上传 RPC、不把图片渲染到 Terminal、不把 base64 文本送入 PTY。
8. 浏览器级测试覆盖图片剪贴板到 daemon 文件路径输入，验证上传后的 bytes；runtime 测试覆盖图片优先、无图片时文本 paste、图片路径 paste、Windows `Alt+V` 图片分支及无图片 fallback。
9. Raw Direct 性能基线不得明显退化。

## Change surface

- `packages/app/src/terminal/runtime/terminal-emulator-runtime.ts`
  - 标准快捷键放行可信 `paste` 事件；事件含受支持图片时统一上传、无图片时才读取文本；通过回调取得 daemon path 后强制作为一个 bracketed block 输入。
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

- 标准 `Ctrl/Cmd+V` 不再在 keydown 阶段读取 Async Clipboard，而是放行浏览器可信 `paste` 事件；`clipboardData` 中有 PNG/JPEG/GIF/WebP 图片时始终统一上传图片，无图片时才粘贴文本。Windows `Alt+V` 继续使用 Async Clipboard 图片入口。
- TerminalPane 只在 `server_info.features.terminalClipboardImage` 为 true 时复用现有 `client.uploadFile()`；runtime 成功取得 daemon path 后不依赖 xterm live mode，始终强制作为一个 bracketed block 输入。
- 新 daemon 宣告 optional capability；未新增 RPC、binary opcode 或 Direct 旁路。
- `Ctrl/Cmd+V` 由标准 paste 处理器接管；Windows `Alt+V` 只在 clipboard 含图片时走上传路径，无图片时通过 `onTerminalKey` 透传原 chord；其他平台的 `Alt+V` 和所有平台的 `Ctrl+Shift+V` 保留给终端应用/浏览器。
- 增加多语言 clipboard 读取、超限和旧 host 提示。
- 异步 clipboard image paste 通过 Promise 链串行化；连续标准 paste 或 Windows image `Alt+V` 按触发顺序上传和插入，terminal unmount 后 stale path 不会进入新实例。普通键入仍保持即时，不为异步上传引入全局输入 scheduler。

## Validation

- `npm --workspace @bytetrue/byspace-app run test:browser -- src/terminal/runtime/terminal-emulator-runtime.browser.test.ts --bail=1`：33/33 通过；新增标准快捷键不被 keydown 接管、同一事件 text+image 统一上传图片并只粘贴 daemon path、upload rejection 后队列继续，以及 unmount 后无 stale error 的回归覆盖。
- `npm --workspace @bytetrue/byspace-app run test:e2e -- terminal-clipboard.spec.ts --workers=1`：5 个场景全部通过；真实 capture PTY 覆盖 image-only 上传、Windows `Alt+V`、mode-off multiline、snapshot restore，以及 PixPin text+image 场景；后者使用 Chromium 系统剪贴板和真实 `Meta/Ctrl+V`，统一上传图片并粘贴 daemon path。
- `npx vitest run packages/protocol/src/terminal-input-mode.test.ts packages/protocol/src/messages.terminal-restore.test.ts --bail=1`：14/14 通过；新 feature optional schema 可解析。
- Direct raw baseline：idle p95 8.7ms、loaded p95 10.3ms、TUI p95 9.6ms、50k parse 95.0ms、resize p95 20.6ms，无明显退化。
- `npm run typecheck`、`npm run lint`、`npm run format:check`、App Web export 与 `git diff --check`：通过。

## 关闭结论

- 最终规则固定为：同一 paste 事件含 PNG/JPEG/GIF/WebP 图片时统一上传图片，只有无图片时才粘贴文本；不推断 localhost、剪贴板原始路径或混合 flavor 的来源与意图。
- 用户已在 macOS Chrome + PixPin + Direct headed 验收通过：图片写入 checkout-local daemon uploads path，返回路径可供 Pi 使用。
- 关闭证据包括 Browser runtime 33/33、Terminal E2E 5 个场景，以及 typecheck、lint、format、Web export、diff check 全部通过。
- 实现复用 UI 文件上传的同一 `client.uploadFile()`、binary transfer 与 daemon store；结论已回写 parent Epic、Direct baseline index 和 `terminal-paste-path.md`。
- 真实 Windows + ConPTY + Pi 验收继续由 parent Epic 跟踪，不因此 reopen 本 Issue。
