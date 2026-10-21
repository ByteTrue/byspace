# Go 重写架构灵感 talk

> 起因：owner 看到 [yetone/magpie](https://github.com/yetone/magpie) 后说「我感觉我发现了新大陆」，
> 想把 BySpace 用 Go 重写；同时又自己划了边界——「他是轻量网关，我是 agent 客户端载体，肯定不可能一模一样」。
> 本文记录那次讨论里**保留了哪些架构判断**，以及哪些部分被后续纠正。

---

## 一、为什么 magpie 让人觉得「优雅」

owner 的自述是「说不清这种架构感觉」，所以第一步是把那种感觉还原成可指认的源码事实（magpie clone 在
`~/workspace/refs/magpie`）。

**已确认：这四条是当时真正打动人的东西。**

1. **零 workspace 分裂。** 全仓一个 `go.mod`、一个 17 行 `main.go`（只调 `cli.Main(version)`）。领域能力都在
   `internal/*`，CLI / TUI / Web / 桌面 / Daemon 不是五个项目，而是 `internal/cli` 里 switch 出来的五种运行姿势，
   全部 import 同一套 internal 包。对比 Node monorepo 改一个字段要跨 5 个包重建声明文件。
2. **后端长出所有客户端。** `internal/gui` 用 `//go:embed assets` 把前端编进二进制，同一个 handler 既托管静态页面
   又提供 `/api/*`；桌面用 Wails 在进程内直接挂同一个 handler（连端口都不占），浏览器用十几行空壳 host 实现
   同一个接口后挂到 `net.Listen`。**客户端不是「另一套后端」，只是同一个 handler 的另一种宿主。**
3. **`-tags nogui` 的一行降级。** SQLite 用纯 Go 驱动（无 CGO），`gui_on.go` / `gui_off.go` 在
   `CGO_ENABLED=0 go build -tags nogui` 时裁掉桌面窗口，但 web / serve / tui 与所有 CLI 命令全保留，可交叉编译
   多个平台，Dockerfile 里只有一个二进制。
4. **主从自愈接管。** 桌面端启动时发现网关已在跑，当前进程退化成「只渲染 UI 的观察窗」；同时起一个协程
   watch，后台进程一退出就无缝接管，不会因端口冲突崩溃。

## 二、magpie 与 BySpace 的差异（owner 自己提出的边界）

**已确认：不能照抄的部分。**

magpie 是「改各家 agent 的本地配置 + 在 `:3425` 转发 LLM 请求」的配置器与流量网关。BySpace 要亲自 spawn
并托管 PTY、ACP/RPC agent 子进程、git worktree、文件监听与调度。这类系统级宿主工作 Go 反而更占优
（`creack/pty` + 原生协程 + 纯 Go SQLite，正好避开 Node 管 `node-pty`、子进程树、文件 watcher 的痛点）。

**owner 的三条纠正（以这三条为准）：**

- 「前端肯定是不学他的，我们前端我的想法是尽可能的去保留复用，我们编译成 js 再打包进去我觉得效果差不多。」
  → **前端开发方式不学 magpie（不手写一个巨型原生 app.js），但交付方式 100% 学它（`//go:embed`）。**
- 「relay 用 go 写我觉得反而性能会更优秀。」→ Relay 也用 Go 重写，而不是保留 Node 服务。
- Multica 看板是废案，不要再拿它当现有复杂度讨论。

## 三、可行性核查的五个关节

延着「挖可行性」的指示逐项对位后，结论比预想乐观——原本以为最难的跨语言卡点都有现成解法。

1. **E2EE 与 Relay。** Node 侧用 `tweetnacl`（Curve25519 + XSalsa20-Poly1305，报文 `[24B nonce][密文]`）。
   Go 的 `golang.org/x/crypto/nacl/box` 是同为 Bernstein 的 NaCl 标准实现，**字节级 100% 兼容**，
   所以 `packages/app` 里的握手代码一行都不用改。Relay 本体（当时约 2300 行 TS）Go 重写只需 600–800 行。
2. **内置 MCP 桥接。** 现在必须先用 tsc 编出 `dist/scripts/mcp-stdio-socket-bridge-cli.mjs`，再由 agent 子进程用
   node 拉起。可抄 magpie `internal/claudebridge` 的**二进制自举**：`os.Executable()` 拿到 `byspace` 自身路径写进
   agent 的 MCP 配置，子命令 `<5ms` 启动，彻底甩掉外部脚本与 JS 运行时。
3. **终端 PTY 与快照（最关键）。** 服务端现在做三件事——`node-pty` 开伪终端、扫 OSC 633 判断命令是否在跑、
   `@xterm/headless` 维护屏幕网格。Go 侧 PTY 用 `creack/pty`（Windows 走原生 ConPTY，纯 syscall，无 C++ addon）。
   屏幕快照有两条路：用纯 Go VT 模拟器维护 Cell 网格，或者更极简——只留 RingBuffer + replayPreamble，
   重连时把字节流推给前端 xterm 渲染（省掉服务端网格模拟）。
4. **Agent 驱动层。** `providers/` 当时 4.2 万行 TS 的成因是每家各封装了一套子进程流控与事件转换，但本质只有两种
   传输：子进程 stdio JSONL / JSON-RPC 2.0（Claude、Codex、Pi、所有 ACP agent），与子进程 HTTP + SSE
   （`opencode serve`）。Go 里只需一个扎实的 `internal/jsonl` 引擎，各 provider 只写 `Event → TimelineItem` 映射。
5. **存储与配置。** 持久化全在 `~/.byspace` 下的原子写 JSON。Go 重写连存储格式都不用换，好处是开发阶段
   Node 版与 Go 版 daemon 可以共用同一个 `.dev/byspace-home` 随时切换对比。

## 四、里程碑切法

以保留下来的前端当验收标尺：

- M1 骨架 + 内嵌 Web + Relay + 握手/server_info/项目列表
- M2 PTY 终端 + 文件树 + Git worktree
- M3 agent 宿主引擎（先打通一个 provider 再铺开）
- M4 CLI 子命令收口并退役 Node 后端

**仍开放：** owner 当时指定 agent 宿主先打通 pi，其余 provider 之后铺；Go 与 Node 并行推进，不做一次性切换。

## 五、出口

- 架构层结论落 `byissue/decisions/004-go-single-binary-architecture.md`。
- 全量功能对齐的范围与 32 项差距清单落 `byissue/epics/2026-10-19-x-go-single-binary-full-parity/spec.md`。
- 暂不纳入：桌面壳（Wails）、`-tags nogui` 裁剪。当前只做 daemon / web / relay / CLI 四副面孔，
  桌面壳是 magpie 的做法，BySpace 的桌面已在 issue 025 退役，不因换语言复活。
