---
title: "Windows ConPTY 吞掉 TUI 的鼠标模式，滚轮退化成上下键"
created: 2026-11-11
---

# Windows ConPTY 吞掉 TUI 的鼠标模式，滚轮退化成上下键

**结论：** Windows 上通过 ConPTY 跑的 TUI，写出的 `?1000h`/`?1002h`/`?1003h`/`?1006h` 不会到达外层终端。外层终端（xterm.js）因此不知道应用要鼠标事件，在 alternate screen 里走内置回退，把滚轮变成 `ESC[A`/`ESC[B`。应用收到上下键，滚轮看起来"变成方向键效果"。真实 PTY（macOS/Linux）没有这个问题。

**实测（2026-11-11，10.1.115.59，Windows 11 build 26300，go-pty v0.2.3 → inbox `CreatePseudoConsole`）：**

- 用 ConPTY 跑 Pi 1.5.2 全屏，输出里只有 `?9001h ?1004h ?1049h`，`1000/1002/1003/1006` 全部缺失。
- 向 ConPTY 写入 `ESC[<64;10;10M`，应用侧能收到（Node raw stdin 探针，**无论它有没有声明鼠标**都能收到）。所以入站是通的，缺的只是出站模式声明；也因此不能在客户端"强制发 SGR"——会把转义序列注入没要鼠标的应用。
- 给 `CreatePseudoConsole` 加 `PSEUDOCONSOLE_PASSTHROUGH_MODE (0x8)`、`0xE`、`0xA` 都没有改变转发；inbox conpty 在这个 build 上不行。
- 同样输入在 macOS 开发版 BySpace 终端里：xterm 有 `enable-mouse-events`，滚轮发送 `ESC[<64;…M`，Pi 自己滚动。

**修复（2026-11-11 实现）**：BySpace 在 Windows 构建里嵌入 node-pty 的 `conpty.dll` + `OpenConsole.exe`，从该 DLL 调 `ConptyCreatePseudoConsole`（`third_party/go-pty` 的 fork），首次终端启动时解压到 `%LOCALAPPDATA%\\byspace\\conpty\\<hash>\\`。同一台机器上用 `terminal.StartSession` 实测：Pi 1.5.2 fullscreen 的 `?1000h/?1002h/?1003h/?1006h` 能到达终端；inbox ConPTY 下只有 `?1004h/?1049h`。payload 缺失或创建失败时回退 inbox。

**绕法（用户侧）**：Pi 1.5.2 的 `tuiMode` 设成 `regular`（`/settings` → TUI mode，或 `settings.json`），用终端普通 scrollback；全屏模式则依赖上面的 ConPTY payload。

**为什么记：** `2026-11-11-o-windows-conpty-mouse-modes.md` 的排查结论；以后遇到「Windows 上全屏 TUI 滚轮失灵 / 变成方向键」先查 ConPTY，不要先改 xterm 的滚轮逻辑。
