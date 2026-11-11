---
kind: issue
title: "Windows 全屏 TUI 滚轮失效：ConPTY 吞掉鼠标模式，终端退化成上下键"
type: bug
created: 2026-11-11
---

# Windows 全屏 TUI 滚轮失效：ConPTY 吞掉鼠标模式，终端退化成上下键

## 做成以后是什么样

在 Windows 上，BySpace 终端里的全屏 TUI（Pi 1.5.2 的 `tuiMode: fullscreen`、Claude Code 全屏界面等）能用鼠标滚轮滚动自己的内容。现在滚轮被终端翻译成 Up/Down 键，Pi 把它当行移动/历史处理，页面滚不动。

## 根因（2026-11-11 实测）

1. Pi 全屏模式进入 alternate screen，并打开鼠标上报（`?1000h ?1002h ?1003h ?1006h`）。
2. Windows 的 daemon 走 ConPTY（`internal/terminal` 的 `go-pty` → 系统 `CreatePseudoConsole`）。**inbox ConPTY 不把鼠标模式的 DECSET 转发给外层终端**：在 10.1.115.59（Windows 11，build 26300）上起一个 ConPTY 跑 Pi，输出里只有 `?9001h ?1004h ?1049h`，没有 `1000/1002/1003/1006`。
3. BySpace 的 xterm 因此认为应用没有申请鼠标事件；alt screen 下没有 scrollback，xterm 走内置的 alternate-scroll 回退，把滚轮变成 `ESC[A`/`ESC[B`。Pi 收到的是上下键。
4. 套一层 herdr 就"正常"：herdr 自己把上下键当滚动命令，而且它有自己的 scrollback，不依赖外层终端的鼠标模式。

同一条链在 macOS/Linux 上不成立：真实 PTY 会把鼠标模式原样送达，xterm 发 SGR 滚轮事件，Pi 自己滚动（2026-11-11 在开发版 web 端实测：滚轮产生 `ESC[<64;col;rowM`，Pi 视图滚动）。

## 证据

- Windows ConPTY 探针（10.1.115.59）：
  - Pi 全屏启动后，ConPTY 输出缺少 `?1000h/?1002h/?1003h/?1006h`。
  - 给 ConPTY 写入 `ESC[<64;10;10M`，应用（Node raw stdin）能收到——**入站 SGR 是通的**，问题只在出站的模式声明。
  - 给 `CreatePseudoConsole` 加 `PSEUDOCONSOLE_PASSTHROUGH_MODE (0x8)`（以及 0x2/0x4 组合）后仍然没有转发；inbox kernel32 ConPTY 在这个 build 上不解决。
- 同一个 Pi 在 macOS 开发版 BySpace 终端里：`.xterm` 有 `enable-mouse-events`，滚轮发送 `1b 5b 3c 36 34 ...`，Pi 视图真的向上滚（截图对照，滚轮后出现 "Jump to latest message"）。

## 解决路径（未定，需裁决）

1. **用户侧立即恢复**：Pi 的 `tuiMode` 设成 `regular`（`/settings` → TUI mode，或 `~/.pi/agent/settings.json` 的 `"tuiMode": "regular"`）。regular 模式用终端的普通 scrollback，滚轮恢复成终端滚动，不依赖 TUI 的鼠标支持。这只解决 Pi，Claude Code 等全屏 TUI 仍然受影响。
2. **产品侧根治（已实现，待真机验收）**：随构建嵌入 node-pty 1.1.0 的 `conpty.dll` + `OpenConsole.exe`（OpenConsole 1.23.251008001，win32-x64/arm64 各一份），运行时解压到 `%LOCALAPPDATA%\\byspace\\conpty\\<payload-hash>\\`，让 PTY 后端从该 DLL 调 `ConptyCreatePseudoConsole`。passthrough flag 单独不够（已实测），必须用带 OpenConsole 的 DLL。
3. **客户端强制发 SGR（已否决）**：ConPTY 会把入站 SGR 原样交非鼠标应用（Node 探针未声明鼠标仍收到），强制发送会把 `ESC[<...` 注入 less/vim 这类应用，不能作为默认行为。

## 关闭判断

选 1 只关闭"用户可用"，选 2 才关闭本 issue。关闭时回写：Windows 终端滚轮的 ConPTY 限制、Pi `tuiMode` 的设置位置。

## 执行记录（2026-11-11）

- `third_party/go-pty/`：v0.2.3 的本地副本（MIT，保留 LICENSE 与 `README-BYSPACE.md` 说明改动），`go.mod` 用 `replace github.com/aymanbagabas/go-pty => ./third_party/go-pty`。Windows 后端增加 `conpty_dll_windows.go`：从 `BYSPACE_CONPTY_DLL` 载入 `ConptyCreatePseudoConsole` / `ConptyResizePseudoConsole` / `ConptyClosePseudoConsole` / `ConptyReleasePseudoConsole`，用 node-pty 的命名管道布局创建 PTY，`CreateProcess` 后释放伪控制台；payload 缺失或创建失败时回退 inbox 实现。
- `internal/terminal/conpty/{win32-x64,win32-arm64}/`：`conpty.dll` + `OpenConsole.exe`（node-pty 1.1.0 prebuild，OpenConsole 1.23.251008001），`NOTICE.md` 记录来源与许可证。
- `internal/terminal/conpty_windows_{amd64,arm64}.go`：`go:embed` 两份 payload，首次 `StartSession` 时按内容 hash 解压到 `%LOCALAPPDATA%\\byspace\\conpty\\<hash>\\`，设置 `BYSPACE_CONPTY_DLL`；非 Windows/其他架构是 no-op。`pty.go` 在 `pty.New()` 前调用一次。
- 验证（实测，Windows 11 build 26300）：
  - 用 `terminal.StartSession`（真实包，交叉编译的 smoke 程序）启动 Pi 1.5.2 fullscreen：收到 `?1000h ?1002h ?1003h ?1006h`，而在同一个 smoke 里用 inbox ConPTY 只收到 `?1004h ?1049h`。
  - 对照：node-pty `useConptyDll: true` 同样能收到完整鼠标模式。
  - `GOOS=windows GOARCH={amd64,arm64} CGO_ENABLED=0 go build` 桌面单二进制成功；`go test ./internal/terminal ./internal/server` 与 `npm run audit -- --no-browser` 全过。
- Review 后的补强：`afterStart` 加锁，DLL 只按 `Conpty*` 导出加载（不用 kernel32 的 `CreatePseudoConsole`），命名管道加 `FILE_FLAG_FIRST_PIPE_INSTANCE`，proc 查找失败释放 HMODULE；payload 解压原子化并允许重试。
- 未验证：真实桌面 App 里点滚轮（需要你装新包）；杀毒软件对解压出的未签名 `OpenConsole.exe` 的反应；旧 Windows 10 上 payload 是否同样生效（OpenConsole 需要 ConPTY，1809+ 理论可用）。

## 维护

**payload（`internal/terminal/conpty/`）**

- 跟随 **node-pty 稳定版**的 `prebuilds/win32-{x64,arm64}/conpty/` 更新，不跟微软月度 OpenConsole。当前 1.23.251008001（node-pty 1.1.0）；node-pty beta 已有 1.25.260303002。
- 升级步骤：换 4 个文件（两个架构各一对）→ 更新 `NOTICE.md` 的版本号 → `GOOS=windows go build` 两个架构。没有代码改动；`Conpty*` 导出自 2022 年未变。缓存目录按内容 hash 命名，升级不会与旧进程抢文件。
- 体积：每个 Windows 架构 +约 1.2MB；仓库 +2.5MB。

**fork（`third_party/go-pty/`）**

- 三处改动（`pty_windows.go`、`cmd_windows.go`、新增 `conpty_dll_windows.go`），`README-BYSPACE.md` 有升级时重放的清单。
- 降低维护成本的选项：把这套“可选外部 DLL loader”提给上游 go-pty，上游接受后删掉 fork；不阻塞当前修复。
- payload 缺失/加载/创建失败自动回退 inbox，终端仍可用（只是滚轮问题回到原样）。
