---
kind: decision
title: "采用 magpie 式单二进制 Go 架构，前端与协议沿用现有实现"
created: 2026-10-19
superseded-by: ""
---

# 采用 magpie 式单二进制 Go 架构，前端与协议沿用现有实现

**后端、CLI、Relay、MCP 桥统一收进一个零 CGO 的 Go 二进制，前端保留现有 `packages/app` 编译产物用 `//go:embed` 打进同一二进制。**
架构形态借鉴 magpie（单一 `main.go` 分发、领域能力全在 `internal/*`、一个 handler 长出所有载体），但每一处能力的行为逐条从 Node 版翻译。

## 为什么这样分

架构与行为是两回事，混在一起就会出错。magpie 提供的是**形状**：一个二进制、一套 internal 包、一个 handler 多副面孔。它不提供 BySpace 的行为语义——那些在 `packages/server` 里，必须逐条翻译，不能重新发明。

前端不重写是硬约束：`packages/app` 已经是完整产品，重写等于用「架构更优雅」换掉所有既有 UI 行为。所以前端只换交付方式（编成 JS 产物嵌入二进制），不换实现。

## 具体约束

- **零 CGO。** `CGO_ENABLED=0` 必须可编译，不引入 C/C++ addon（PTY 用 `creack/pty`，SQLite 若需要则纯 Go 驱动）。
- **协议与加密不动。** WebSocket 消息仍受 `@bytetrue/protocol` 的 schema 约束；E2EE 用 `golang.org/x/crypto/nacl/box`，与前端 `tweetnacl` 字节级兼容。
- **落盘格式不动。** Go 版直接读写 `$BYSPACE_HOME` 现有 JSON，两版可共用同一个 home 目录随时切换对比。
- **不做桌面壳。** 桌面与原生移动已在 issue 025 退役，不因换语言复活。当前四副面孔：`serve` / `web` / `relay` / CLI。
- **行为必须翻译，不许发明。** 见下方「已知的偏离坑」。

## 目录布局

Go 用标准布局，不发明：`cmd/<binary>/main.go` 是入口，`internal/` 是私有实现。这是所有「一个二进制 + 一个前端」的 Go 项目的共同形状——coder/coder 用 `cmd/` + `site/`，gitea 用 `cmd/` + `web_src/`，pocketbase 用 `cmd/` + `ui/`，grafana 用 `pkg/` + `public/`。magpie 不适用：它的前端是手写 vanilla JS 直接躺在 `internal/gui/assets`，没有构建链，我们的 Expo 前端学不了。

过渡期的唯一事实：`packages/` 是 Node 实现（现行发布主体），`cmd/` + `internal/` 是 Go 实现。两者不互相 import，只在 `internal/webui/dist` 交接——`make build-web` 把 `packages/server/dist/server/web-ui` 拷进去再 `//go:embed`。

Node 侧的 daemon 实现已移入 `archive/`（见 `archive/README.md`）：`archive/packages/{server,cli}`、`archive/packages/relay`（只含服务端）、`archive/scripts`、`archive/packages/app-e2e`。它们**不参与构建**，只作为 Go 翻译时的对照物。

`packages/` 现在只剩前端与共享协议：`app`、`client`、`protocol`、`highlight`，以及 `relay` 的 E2EE 原语（`crypto`/`encrypted-channel`/`e2ee`/`base64`/`types`）——`packages/client` 直接依赖 `@bytetrue/relay/e2ee`，归档的是 relay 的服务端而不是加密层。

最终形态（Go 转正时）：`packages/app` → `web/`，`packages/{client,protocol,highlight,relay}` 作为它的构建依赖一并搬入。**这一步留到真正切换时做**，因为现在搬 Expo 的 workspace 边界只会换来一次大 diff。

## 背景（已知的偏离坑）

这条约束不是抽象的：实现过程中出现过六次「翻译不下去就自创实现」的情况，每次都由 owner 在实测中发现：

| 位置               | 自创的                              | Node 的实际行为                            |
| ------------------ | ----------------------------------- | ------------------------------------------ |
| agent timeline     | 落盘 `agents/timelines/*.json` 快照 | 纯内存 store，历史由 provider 会话文件重建 |
| `process_exit`     | 发 `turn_completed` 并保留 runtime  | `turn_failed` + `closeAgent` 摘除 runtime  |
| `steer`            | 有 `steer` 就无条件下发             | 先查活跃轮次，无则 `inactive` → 开新轮次   |
| pairing QR         | SHA-256 伪随机矩阵（扫不出来）      | `qrcode` 包生成真 QR                       |
| skills status      | 硬编码 `up-to-date`                 | 三态 + 逐 op `targets`                     |
| 内置 provider 列表 | 把 ACP 预设当常驻内置项             | 6 个内置 + `+ Add provider` 按需挂载       |

结论：新增实现时，Node 有对应物就必须指出对应文件；确实属于新增设计的，要显式标注，不能混在翻译里。

## 实施补充：逐文件对读的发现方式

「验证」不能停在协议字段和单测上。逐文件对读 Node 实现的过程证明，真正的缺陷分三类，
每类需要不同的检查手段：

| 缺陷类型               | 例子                                                                              | 能发现它的手段                                       |
| ---------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 字段没接 / 没发        | `rename_branch` 读 `newName` 而协议是 `branch`                                    | 静态对账（`npm run audit` 的入站/出站两项）          |
| 字段发了但值是假的     | `workspace.script.start` 返回 `script: nil`                                       | 只能逐文件读实现                                     |
| 逻辑对了但时序或锁错了 | 事件处理器重复加锁导致 agent 静默                                                 | 只能真实运行 + 协议 trace                            |
| 分支写了但没有生产端   | `TargetGoneError` 定义了、`RunOnce` 处理了，executor 从不返回它                   | 只能 `grep` 类型名，确认非测试代码里除定义外还有引用 |
| 实现存在但没人调用     | `FormatSystemNotificationPrompt` 零调用者，父 agent 因此永远不知道子 agent 已完成 | 只能按「Node 侧谁调它」反查 Go 侧调用点              |

后三类有一个共同点：**代码是对的、类型是对的、测试是绿的**，缺的是「这句代码会不会被执行到」。
`go vet` 与编译器都不查这个，因为它们只关心「能不能编译」，不关心「有没有人用」。

第三类最贵：`go test`、协议校验、浏览器检查都可以全绿（浏览器检查当时是 7/8，失败项被误判为
环境问题），而 agent 完全不工作。详见
`../notes/013-go-daemon-agent-silent-reentrant-lock.md`。

因此这条决策加两条约束：

1. **新增 provider 或事件处理路径时，必须能回答「这条路径在最坏时序下会不会持有锁做慢操作」**。
   `handleRawEvent` 持锁处理整轮对话是当前的形状，读循环被业务逻辑阻塞，任何慢操作都会表现为
   「agent 无响应」。
2. **引入一个错误类型、一个格式化函数、一个分支时，必须同时确认生产端真的会产出它**。判据是
   `grep` 那个符号：如果在非测试代码里只出现在定义处，这段逻辑就是死的。

讨论过程见 `../talks/008-go-rewrite-architecture-inspiration.md`；全量对齐范围见 `../epics/2026-10-19-o-go-single-binary-full-parity/spec.md`。后续基于 Wails v3 与 `-tags nogui` 同构延伸桌面端与 Android 客户端的演进见 [Decision 005](005-wails-v3-unified-desktop-and-android-client.md)。
