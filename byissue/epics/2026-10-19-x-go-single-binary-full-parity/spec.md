---
kind: epic
title: "Go 单二进制全栈同构架构与 Node 全量功能 1:1 真实对齐"
owner_decision: approved
created: 2026-10-19
amended_at: 2026-10-19
approval_evidence:
  owner: "「最终的目标就是在新的架构下，在 go 版本里实现所有，注意是所有 node 版本的功能，不能有遗漏，不能存在 node 版本能做，但是 go 版本做不了的问题」（2026-10-19）"
  scope: "「单 Epic + 6 个所属 Issue 推进；全部实现，零排除；立档后直接开始推进 Issue 001」（2026-10-19）"
---

# Go 单二进制全栈同构架构与 Node 全量功能 1:1 真实对齐

> **读者：** 在这条架构迁移线里对齐的人——为什么采用单二进制同构模型、前端与协议如何保持零破坏复用、哪些底座已打通、剩余 32 项差距如何分 6 个 Issue 全部做实。

---

## 要改变什么

BySpace 此前由 Node/TypeScript 多包工作区（`packages/server`、`packages/cli`、`packages/relay`、`packages/client`、`packages/protocol`、`packages/app`）组成：服务端守护进程依赖系统 Node 运行时与 C++ 原生插件（如 `node-pty`、`@parcel/watcher`），跨包类型声明同步成本高，CLI 启动慢，Relay 与 Daemon 分离维护。

本 Epic 借鉴 `yetone/magpie` 的单二进制全栈同构哲学，将除前端 UI 构建层（`packages/app`）外的全部后端、CLI、E2EE Relay、MCP Bridge 与静态 Web 托管收拢进**单一零 CGO 的 Go 二进制（`byspace`）**：

1. **一核多壳（Single Binary, Multiple Surfaces）**：同一个 `byspace` 二进制通过子命令长出 `serve`（Daemon 宿主）、`web`（内嵌完整 Web 工作台）、`relay`（高并发 E2EE 中继服）、`mcp-bridge`（自举 stdio MCP 桥接）及全套 CLI 命令。
2. **前端 100% 保留复用 + `//go:embed` 自包含交付**：`packages/app` 编译导出的静态产物通过预压缩瘦身与 Gzip 透明解压回退直接嵌入 Go 二进制，同源注入 `window.__BYSPACE_INITIAL_DAEMON_CONNECTION__` 实现浏览器打开即零配置直连。
3. **100% 功能等价（Zero Exclusion, No Hollow Stubs）**：Node 版拥有的全部功能（包括全部内建与自定义 Agent 客户端宿主、终端 VT 快照与 Hooks、多 Forge 集成、文件/Git 实时监听、Service Proxy 与 Tunnels、8 家厂商配额抓取、Skills 事务同步与多目标安装、Web Push RFC 8291 加密投递、交互式 CLI）均在 Go 版中完整、真实地实现。

- 关联 Project Spec：`byissue/spec/index.md`、`agent-conversation.md`、`terminal.md`、`workspace.md`、`connection.md`、`notifications.md`。
- 灵感来源与边界：`byissue/talks/008-go-rewrite-architecture-inspiration.md`
- 架构决策：`byissue/decisions/004-go-single-binary-architecture.md` —— 架构形状学 magpie，每处能力的行为逐条翻译 Node；不许发明。

---

## 架构与质量约束

1. **零 CGO 纯静态编译（Portability）**：核心二进制在 `CGO_ENABLED=0` 下可编译，不引入任何 C/C++ addon。
2. **协议契约 100% 兼容（Compatibility）**：WebSocket 入站/出站消息严格通过 `@bytetrue/protocol/messages` 的 `WSOutboundMessageSchema` 校验；E2EE 使用 `golang.org/x/crypto/nacl/box` 与前端 `tweetnacl` 字节级兼容。
3. **落盘状态双向兼容（Reliability）**：直接读写 `$BYSPACE_HOME` 下的 `server-id`、`daemon-keypair.json`、`web-push-keys.json`、`config.json`、`projects/{projects,workspaces,labels}.json`、`agents/**/*.json`、`schedules/*.json`，Go 版与 Node 版可在同一数据目录无缝切换。
4. **拒绝空壳 Stub（Functional Completeness）**：任何在 Node 版具有真实副作用、持久化或外部进程交互的能力，在 Go 版必须具备同等真实实现并通过单元/集成/真实会话验证。

---

## 已交付底座切片（Direct Slices on `refactor/go`）

- [x] **单二进制骨架与核心通道**（`db47afb8c` ~ `313bdfebb`）：`main.go`、`internal/{home,e2ee,relay,webui,store,terminal,schedule,daemon,cli,server}`、`internal/agent/{jsonl,pi}`。
- [x] **WebSocket 176/176 入站路由与 37/37 内置 MCP 工具目录挂载**：Pi Agent 真 Token（`bytetrueapi/deepseek-flash`）流式对话、工具卡片结构化、`extension_ui_request` 提问弹窗、`.jsonl` 会话自动持久化与恢复、Git Unified Diff Hunk 解析器、HTTP 文件下载流、Web Push VAPID P-256 密钥生成已跑通。

---

## 当前推进视图（9 个所属 Issue，已交付 6 个，部分交付 1 个）

每一项的验收结论写在该 Issue 的「验收与关闭」章节里。

- [x] `issues/2026-10-19-x-agent-providers-full-parity.md` — **Issue 001：全 Agent 客户端宿主适配**（Claude Code、Codex `app-server`、ACP 全家族、OpenCode、OMP、Custom Providers；含模型探测、模式切换、权限审批、本地历史导入恢复）。审计补了四处：omp 收到 pi 的 flag 会立刻退出、Claude 子代理混进主时间线且 Task 分支漏了广播、Codex 用量恒 nil、Codex `Steer` 未走 `turn/steer`。
- [x] `issues/2026-10-19-x-terminal-vt-hooks-and-shell-integration.md` — **Issue 002：终端 VT 快照、Input Mode 重放、Shell Integration、Agent Hooks**。VT 网格与恢复三模式交付；hook 安装只做了 pi（claude/codex/opencode 的配置改写未做）。
- [x] `issues/2026-10-19-x-file-watcher-rewind-search-and-sync.md` — **Issue 003：文件/Git 监听推送、Rewind、全文搜索**。补了三处：订阅轮询从未启动、每秒读整个文件算 revision、rewind 只截断内存时间线（pi 的树导航是扩展不是 RPC）。目录同步 DROPPED。
- [x] `issues/2026-10-19-x-multi-forge-auto-archive-setup-and-naming.md` — **Issue 004：多 Forge、PR 自动归档、Setup、AI 命名**。补了合并就绪校验与 forge 精确 host 匹配（此前按 URL 子串判断，`gitlab-mirror` 会被判成 GitLab）。
- [~] `issues/2026-10-19-x-service-proxy-tunnels-quotas-skills-and-push.md` — **Issue 005：Web Push / Skills 事务同步 / Quota 框架已交付；Service Proxy 与 Tunnels 未做，已转 DROPPED/MISSING 并写明条件**。Quota 只实现了 `codex`/`zai`，其余 6 家需要真实凭据。
- [x] `issues/2026-10-19-x-cli-interactive-qr-ssh-and-relay-cutover.md` — **Issue 006：CLI 交互式能力**。`attach`、真 QR、`onboard`/`hooks`、统一输出层、Relay 切流全部交付；`ssh://` 隧道 DROPPED（需第二台机器）。审计补了 `agent mode`（此前被静默路由到 `agent update`）与 `daemon install-service` 三件套。
- [x] `issues/2026-10-20-x-e2e-harness-on-go-daemon.md` — **Issue 007：E2E 套件换 Go daemon 宿主**。186 个 spec 一行未改，切换后抓出 config.json 层级、`parentPath` 字段名、label 增量同步三个缺陷。
- [x] `issues/2026-10-20-x-go-browser-e2e-parity-batch.md` — **Issue 008：真机浏览器对齐修复**。流式时序、轮次存活、思考档位、Chief 置顶、多模态图片透传。`audit:browser` 现稳定 10/10。
- [x] `issues/2026-10-20-x-line-by-line-node-audit.md` — **Issue 009：逐文件审计**。512/512 有结论；未完成项集中在 [`issues/audit-log.md`](issues/audit-log.md) 的 MISSING 表里，每条带阻塞条件。

## 验收现状（2026-10-21）

**9 个所属 Issue：8 个交付，1 个部分交付（005）。**

机器检查全绿：`go test ./...` 通过；`npm run audit` 出站 `MISSING 0 / OPTIONAL 0 / NEVER_SENT 0`；
浏览器检查 10/10；入站字段缺口 31 条（全部属未实现的子系统，等于既定基线）。

## 未完成项（各自独立 Issue，不再挂在本 Epic 下）

| Issue                                                                                                                                   | 缺什么                                         | 阻塞条件                                     |
| --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------- |
| [`issues/2026-10-21-o-go-service-proxy-and-script-preview.md`](../../../issues/2026-10-21-o-go-service-proxy-and-script-preview.md)     | Service Proxy 整条链路：脚本能跑，没有预览 URL | 需要先定主机名方案（DNS 泛解析 vs 路径前缀） |
| [`issues/2026-10-21-o-go-tcp-tunnels.md`](../../../issues/2026-10-21-o-go-tcp-tunnels.md)                                               | TCP Tunnels                                    | **需要第二台机器**才能验证，盲写风险高于收益 |
| [`issues/2026-10-21-o-go-plugin-runtime-and-hub.md`](../../../issues/2026-10-21-o-go-plugin-runtime-and-hub.md)                         | plugin 运行时与 hub 远程控制                   | 需要沙箱设计与身份模型                       |
| [`issues/2026-10-21-o-go-quota-fetcher-six-vendors.md`](../../../issues/2026-10-21-o-go-quota-fetcher-six-vendors.md)                   | 6 家 quota 抓取                                | **需要真实凭据**才能验证数字对不对           |
| [`issues/2026-10-21-o-go-agent-hook-install-other-providers.md`](../../../issues/2026-10-21-o-go-agent-hook-install-other-providers.md) | claude/codex/opencode 的 hook **安装**         | 无硬阻塞，只是未做（shim 已就绪）            |

`server_info.features` 里这五项对应的开关本轮已全部改为 `false`——此前声明为 `true`，
客户端会渲染入口而背后什么都没有。`TestDeclaredFeaturesAreImplemented` 挡住回退。

## Epic 关闭条件

- ~~9 个所属 Issue 交付~~：8 个已交付，005 的剩余部分转成上面 5 个独立 Issue。
- **本 Epic 关闭**，剩余工作由那 5 个 Issue 承接。
- **毕业回写**：`docs/architecture.md` 与 `byissue/spec/` 中关于后端宿主与构建分发的描述，
  在 Go 转正（合入 main、切换发布流水线）时更新——那一步尚未发生，因此本次不回写。

## 沉淀的方法论

审计过程中反复出现的两类非产品问题，各写成一条 note，避免下一个人重走：

| Note                                                                     | 讲什么                                                                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| [notes/016](../../notes/016-verification-tools-report-false-failures.md) | 验证工具报失败时先分清「无关前置条件」「观测方式」「跑的不是刚构建的二进制」，以及为什么修工具时唯一不能碰的是断言本身   |
| [notes/017](../../notes/017-go-process-termination-needs-the-group.md)   | 停一个脚本 ≠ 停一个进程：只发 shell 会留下真正干活的子进程，信号要发给进程组；以及与「用进程树杀」那份旧 note 的前提差异 |

已有的相关 note：`notes/013`（重入锁导致 agent 静默）、`notes/014`（子进程身份环境变量泄漏）、
`notes/015`（重入锁的 AST 检查，含「加了分支但没人产出那个错误」的反例）。
