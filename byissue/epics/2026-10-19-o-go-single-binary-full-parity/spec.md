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

## 当前推进视图（6 个所属 Issues 消灭全部 32 项差距）

- [x] `issues/2026-10-19-x-agent-providers-full-parity.md` — **Issue 001：全 Agent 客户端宿主适配**（Claude Code、Codex `app-server`、ACP 全家族 Copilot/Cursor/Kimi/Kiro/Trae/Generic、OpenCode `serve` HTTP/SSE、OMP、Custom Providers & Profiles，含各自模型探测、模式切换、权限审批与本地历史会话导入恢复）
- [x] `issues/2026-10-19-x-terminal-vt-hooks-and-shell-integration.md` — **Issue 002：终端 VT 屏幕快照、Input Mode 重放、Shell Integration 与 Agent Hooks 自动安装**（服务端 VT Cell 矩阵快照 `0x04`、模式恢复、`zsh`/`bash`/`pwsh` 脚本注入、`pi`/`claude`/`codex`/`opencode` 终端活动 Hooks 安装与 `/api/terminal-activity` 闭环）
- [x] `issues/2026-10-19-x-file-watcher-rewind-search-and-sync.md` — **Issue 003：文件/Git 实时监听推送、Agent Rewind 快照回滚、历史全文搜索分页与目录同步**（后台 Watcher 主动推送 `fs.file.update`/`checkout_diff_update`/`workspace_update`、大文件二进制流与高亮、`directorySync`、Rewind 对话与代码回滚、`searchQuery` 全文检索与游标分页）
- [x] `issues/2026-10-19-x-multi-forge-auto-archive-setup-and-naming.md` — **Issue 004：多 Forge（GitHub/GitLab/Gitea）、PR 自动归档、Workspace Setup 脚本与 AI 自动命名**（`glab`/`tea`/REST 适配、PR Timeline 与 Check 详情、Merged PR 自动归档、Worktree `setup` 脚本流式执行、`metadataGeneration` 自动分支与标题生成）
- [x] `issues/2026-10-19-x-service-proxy-tunnels-quotas-skills-and-push.md` — **Issue 005：Service Proxy、TCP Tunnels、8 厂商 Quota Fetcher、Skills 事务同步（含 `skillTargets`）与 Web Push RFC 8291 投递**（子域名反向代理、脚本健康监控、WebSocket/TCP 端口隧道、8 厂商实时用量抓取、Skills SHA-256 事务同步与 `agents|claude` 目标选择、RFC 8291 `aes128gcm` 加密推送、Bearer 密码鉴权与语义化权限、Hub 协议与自更新）
- [x] `issues/2026-10-19-x-cli-interactive-qr-ssh-and-relay-cutover.md`
- [ ] `issues/2026-10-20-o-go-browser-e2e-parity-batch.md`
- [ ] `issues/2026-10-20-o-e2e-harness-on-go-daemon.md` — **E2E 套件换 Go daemon 宿主**（config.json 嵌套结构、CORS、`BYSPACE_DISABLE_HOME_WORKSPACE`、`project.create_directory` 字段名、label 增量同步；`directory_suggestions` 的模糊搜索仍未对齐） — **真机浏览器对齐修复**（流式时序、轮次存活、思考档位、Chief 置顶、多模态图片透传） — **Issue 006：CLI 交互式 `attach`、终端二维码、`onboard`/`hooks`、`ssh://` 隧道、统一格式化输出与 Relay 切流代理**（流式终端附着、ASCII QR 码渲染、SSH 自动端口转发、`--json/--yaml/--quiet` 表格渲染器、`BYSPACE_RELAY_UPSTREAM` 切流代理）

---

## 关闭条件与合并候选

- **关闭条件**：上述 6 个所属 Issue 全部交付并通过验证（`go test ./...`、`WSOutboundMessageSchema` 校验、真实浏览器与 CLI 端到端实测），不存在任何“Node 版能做而 Go 版做不了”的功能缺口。
- **毕业回写**：Epic 关闭时更新 `docs/architecture.md` 与 `byissue/spec/` 中关于后端宿主与构建分发的描述。
