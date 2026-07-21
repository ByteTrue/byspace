# Terminal paste path

## 为什么 raw 性能基线不足

用户在 Windows 浏览器中运行 Pi CLI 时给出了两个更直接的完整体验反例：

1. `Ctrl+V` 无法把剪贴板图片交给 Pi，`Alt+V` 也不能完成图片粘贴。
2. 粘贴多行文本时，每个换行被解释成一次 Enter，而不是作为一个 paste block 插入编辑器。

因此“Local Direct 100 分”首先要求终端应用收到正确输入语义；keydown→commit 很快只能说明 hot path 没有性能债，不能证明 Terminal 行为完整。

## Pi CLI 期待什么

当前安装的 Pi CLI 在 `dist/core/keybindings.js` 中把 `app.clipboard.pasteImage` 默认绑定为：

- Windows：`Alt+V`
- 其他平台：`Ctrl+V`

`dist/modes/interactive/interactive-mode.js` 的 `handleClipboardPaste()` 在 **Pi 进程所在机器** 读取系统剪贴板：

- 有图片：写入该机器的临时文件，并把文件路径插入编辑器。
- 无图片：读取纯文本并插入编辑器。

这意味着把 `Alt+V` 字节送到远端 Pi，只能让 Pi 读取远端主机剪贴板；它不能读取浏览器所在 Windows 机器的图片。浏览器图片粘贴必须由浏览器拥有并上传图片数据，再把 daemon 可访问路径作为 paste 输入。

## BySpace 多行文本路径

```text
Windows Ctrl+V
  → terminal-emulator-runtime.ts keydown handler
  → navigator.clipboard.readText()
  → xterm Terminal.paste(text)
  → xterm 根据当前 DECSET 2004 模式决定是否包裹
  → onData
  → terminal input binary frame
  → PTY
  → Pi editor
```

`Terminal.paste()` 本身是正确入口：当 xterm 收到 `CSI ? 2004 h` 后，它会把多行文本转换为：

```text
CSI 200 ~ + normalized text + CSI 201 ~
```

实际分叉发生在 snapshot attach/restore：

```text
PTY output: CSI ? 2004 h
  → server TerminalInputModeTracker
  → snapshot
  → browser renderSnapshot()
  → ESC c hard reset clears xterm mode
  → server replayPreamble replays Kitty/Win32 only
  → DECSET 2004 remains off
  → Terminal.paste() emits bare text with CR between lines
  → Pi treats each CR as submit/Enter
```

仓库已经有 authoritative worker `TerminalInputModeTracker`、`getReplayPreamble()` 和 snapshot 后 preamble replay；缺口只是 tracker 未记录 DEC private mode 2004。

### 可执行红测

`packages/app/src/terminal/runtime/terminal-emulator-runtime.browser.test.ts` 在真实 Chromium 中证明：

- 直接写入 `CSI ? 2004 h` 后，`terminal.paste("first line\nsecond line")` 正确发送 bracketed paste。
- 同一个 terminal 执行 snapshot replay 后，只发送 `first line\rsecond line`。

失败断言稳定落在 snapshot 后第二次 paste；因此根因不是 `readText()`、换行规范化或 PTY input frame，而是 input mode 恢复遗漏。

随后核对 Orca Windows 路径发现第二个独立边界：ConPTY 可能根本不把应用的 DECSET 2004 输出交给 renderer。snapshot fix 只能恢复已观测状态，不能恢复从未观测到的状态；因此 Windows user agent 下含换行 clipboard 文本必须无条件安全地 frame 成一个 bracketed block。该兜底仅限 Windows 多行文本，不改变其他平台或单行 shell paste。

## BySpace 图片路径

当前 Ctrl+V 分支只调用 `navigator.clipboard.readText()`：

```text
image-only clipboard
  → readText() returns empty / rejects
  → no terminal input
```

BySpace 已有可复用的完整上传能力：

```text
DaemonClient.uploadFile({ fileName, mimeType, bytes })
  → file.upload.request
  → chunked binary FileTransfer frames
  → FileUploadStore
  → $BYSPACE_HOME/uploads/<upload-id>/<file-name>
  → file.upload.response.payload.file.path
```

因此图片 paste 不需要新增一套 base64 RPC、分块器或服务端写文件实现。最小责任分配是：

1. 浏览器在用户 paste 手势中通过 Clipboard API 读取 image blob。
2. 复用 `DaemonClient.uploadFile()` 把 bytes 写到当前 daemon。
3. 得到 daemon 文件路径后，不依赖 xterm live mode，强制作为一个安全的 bracketed paste block 发给 PTY。
4. 新 client 对不支持该能力的旧 daemon 使用一个集中 capability gate；不模拟降级路径。

现有上传目录不会自动清理成功上传，图片 paste 若直接复用会继承这个生命周期。这不是首个 bracketed paste bug 的范围；图片 Issue 必须显式决定接受现有 attachment 生命周期，还是给上传增加 clipboard purpose 与清理策略。

## Alt+V 证据边界

Pi 的 Windows 默认图片绑定明确是 `Alt+V`，但原样透传只能让远端 Pi 读取 daemon 主机剪贴板。BySpace 因此只在 Windows 浏览器 clipboard 含受支持图片时接管 `Alt+V`，上传后 paste daemon path；clipboard 没有图片、API 不可用或图片回调不存在时，通过 `onTerminalKey` 按当前 input mode 透传原 chord，避免破坏 shell/其他 TUI 的 Meta+V。clipboard 读取/解码失败则显示错误并停止，不静默触发远端 Pi 的 daemon clipboard fallback。

真实 Chromium runtime 测试覆盖了图片接管与无图片 fallback；E2E 在 Windows platform 模拟下覆盖真实 upload→PTY 路径。真实 Windows headed Chrome 是否会在页面之前占用该 chord，仍需 Windows 手测确认。

## Orca Web 的对应路径

Orca Web 把 clipboard paste 当成独立的 Terminal 输入能力：

```text
Cmd/Ctrl+V
  → readClipboardText()
  → 有文本：pasteText(text)
  → 无文本/读取失败：navigator.clipboard.read() image
  → chunked clipboard upload RPC
  → runtime host 临时图片路径
  → 强制 bracketed paste(path)，不依赖 renderer 当前 mode
```

`terminal-clipboard-paste.ts` 还会对目标变化、超大文本、图片失败和 bracketed paste 中断做集中处理。BySpace 不需要复制它的专用上传 RPC，因为已有 `uploadFile()`；需要复制的是正确的能力归属：浏览器读取本机剪贴板，daemon 产生远端可读路径，Terminal 只粘贴路径。

## 执行结果

### bracketed paste restore 与 Windows fallback

- 扩展现有 `TerminalInputModeTracker` 记录 DEC private mode 2004。
- 把启用状态放进现有 replay preamble。
- snapshot 恢复权威 mode；Windows 多行 clipboard 文本在 ConPTY 未转发 mode 2004 时强制 framing，其他平台与单行文本仍遵循 xterm live mode。
- Browser runtime 与真实 capture PTY 分别验证 snapshot 后和 mode 2004 off 时都只收到一个安全 paste block；Kitty、Win32、Alt+V 和 raw Direct 基线不退化。

### clipboard image upload

- 复用 `DaemonClient.uploadFile()` 和现有 binary file transfer。
- `Ctrl/Cmd+V` 走文本优先、图片 fallback；Windows `Alt+V` 走图片探测、无图片原 chord fallback；两者复用 `DaemonClient.uploadFile()` 和现有 binary file transfer。
- Browser image clipboard → daemon 真实文件 → mode 2004 off 的 capture PTY 仍收到一个强制 bracketed path block。

### 仍待调查

- Windows headed Chrome 是否会在页面之前占用 Alt+V。
- Pi、shell 和其他 TUI 对含空格 Windows/POSIX 文件路径的插入规则；图片 Issue 需要用真实应用验证，不凭字符串单测猜测。
- 现有成功 upload 的长期清理策略是否适合高频截图。
