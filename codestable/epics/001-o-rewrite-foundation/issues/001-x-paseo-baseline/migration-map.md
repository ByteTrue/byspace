# Paseo → byspace 组件迁移地图

## 目标落点

```text
app.byspace.cc.cd ── Web/PWA (TypeScript，复制并适配 Paseo Web)
          │
          ├── direct / relay.byspace.cc.cd ── byspace daemon (Go)
          │                                      ├── Agent providers
          │                                      ├── projects/workspaces/terminal/files/Git
byspace CLI (同一 Go 二进制) ───────────────────────└── schedules/plugins/speech/tools

hub.byspace.cc.cd ── Hub service ── direct authorized WS ── Go daemon
```

Relay 目标为 byspace 自有 Cloudflare Worker/Durable Object 部署。Hub 服务实现来源仍需在外部 `getpaseo/hub` 上做单独决策；Hub 不经 Relay。

## 所有权矩阵

| Paseo 区域 | byspace 处理 | 首轮策略 | 不能误删的契约 |
| --- | --- | --- | --- |
| `packages/app` | 整体复制共享/Web 源码后适配 | 先建立 Web export 基线，再剥离 native 配置 | 多主机 runtime、host-qualified routes、IndexedDB replica、能力协商、browser-safe desktop adapter |
| `packages/client` | 复制并逐步改名 | 作为 Go daemon 的现成客户端和兼容标尺 | direct/Relay transport、重连、请求关联、状态/Timeline owner |
| `packages/protocol` | 复制；Go 侧生成或手写对应 codec | 从首轮消息提取 cross-language fixtures | hello、server-info、可扩展 schema、终端/文件二进制帧 |
| `packages/highlight` | 复制 | 保持现有 Web 渲染 | 代码高亮行为和构建入口 |
| `packages/plugin` | 复制前端 SDK/运行时；daemon host 重写 | 保留类型和 UI，运行时方案后决 | 插件 RPC、可信模型、UI bundle；不能因 Go daemon 删除插件产品能力 |
| `packages/expo-two-way-audio` | 不复制 | 静态审计确认只从 `.native.ts` 动态加载，Web build 不依赖该 workspace | Web voice/dictation 结果仍在范围内，但使用浏览器音频路径 |
| `packages/server` | 不复制为生产实现；按领域用 Go 重写 | 把现有行为、测试和数据模型当 oracle | 全部 session dispatch、Agent/Timeline ownership、文件/终端/Git/schedule/Hub/Relay 等领域 |
| `packages/cli` | 用 Go 重写并并入 `byspace` 二进制 | 首轮固定 TS 行为与命令账本，实现 daemon + Agent 核心命令 | endpoint 选择、JSON/YAML/quiet 输出、exit code、remote Relay、Hub 命令和完整命令账本 |
| `packages/relay` | 复制客户端 E2EE；Worker 作为自有 Relay 起点 | 去除 Paseo account/domain/upstream 后做 canary | v2 control/data socket、text/binary opcode、NaCl 互操作、v1 是否保留待决 |
| `packages/website` | 保留并后续改品牌/内容 | 不阻塞首轮 daemon 闭环 | 它是站点，不是 Hub 或 Relay；用户只排除原生客户端 |
| `packages/desktop` | 永久排除 | 不复制 package，不构建 Electron | 共享 app 中同名 browser-safe adapter 不能按目录名一起删 |
| `packages/app/ios`、`android` 与 native 发布配置 | 永久排除原生客户端产物 | 不生成/不发布；在 Web build 绿色后清理 | Web 平台仍可能复用普通 `.ts/.tsx` 和 `.web.*` |
| daemon Relay client | Go 重写 | 后于本地 Agent 闭环，但先做 crypto fixtures | persistent daemon key、pairing offer、reconnect/liveness、E2EE frame kind |
| daemon Hub client | Go 重写 | 保留协议 ledger，Hub Epic 实现 | exact origin、一次性 enrollment、relationship secret/grant、execution ownership |
| 生产 Relay 服务 | byspace 自有部署 | Cloudflare DO canary → `relay.byspace.cc.cd` | 零知识转发、滥用/成本控制、hibernation、多客户端和大帧 |
| Hub 服务 | 保留能力；fork/adapt 或重写待决 | 首轮只固定边界与外部来源 | dashboard/API/DB、GitHub/Slack/Discord、长连接、同源 daemon WS |

## Go daemon 领域账本

以下均为确认的最终范围。括号只表示推荐实现顺序，不表示删除：

1. **连接与协议（首轮）**：HTTP、WebSocket、hello、会话、RPC、push、capabilities、认证、backpressure、静态 Web。
2. **Agent/Timeline（首轮）**：create/resume/import/stop/archive/delete、stream/history、permissions、subagents、rewind、模型与使用量。
3. **Pi provider（首轮）**：`pi --mode rpc`、JSONL transport、catalog/options、事件映射、session handle、MCP/extension UI 的渐进支持。
4. **CLI 监督与客户端（首轮核心）**：daemon start/status/stop、Agent run/list/log/send/wait/stop/inspect；以后补齐全部命令。
5. **项目与工作区**：project registry、workspace placement、directory sync、labels、provision/recovery、worktree。
6. **终端与文件**：PTY/ConPTY、二进制流、resize/restore、文件编辑 revision、watch、upload/download 与路径包含。
7. **Git/Checkout/Forge/Review**：status/diff、branch/commit/merge/push/stash、PR、GitHub/GitLab/Gitea、归档与 review。
8. **脚本与服务**：受管理进程、端口/健康、service proxy、日志和关闭清理。
9. **计划与自动化**：schedule、heartbeat、隔离策略、重试/过期、Agent 创建与重启恢复。
10. **插件**：trusted TS/TSX source、编译、子进程 IPC、Web UI bundle；Node sidecar 或新 ABI 待决。
11. **语音与 Push**：浏览器录音、dictation、STT/TTS、push token 与通知；原生移动 capture 除外。
12. **工具与扩展**：MCP、daemon tool catalog、orchestration skills、browser tools 与 Agent 间协作。
13. **Relay**：daemon outbound transport、配对、多客户端、E2EE、远程 CLI/Web。
14. **Hub**：relationship、grant、execution RPC、CLI 管理以及可部署 Hub 服务。
15. **其他 provider**：Codex、Claude、OpenCode、ACP/Copilot/Cursor/Kimi/Kiro、OMP 等，按适配成本逐步进入。

## 第一条可验证闭环

```text
复制后的 Web build
  → Go daemon hello/server-info
  → 添加一个临时 Git 项目
  → 创建 Pi Agent
  → pi --mode rpc 流式输出
  → daemon 持久化 canonical Timeline
  → Web 与 CLI 同时观察
  → 刷新、daemon 重启、重新获取同一 Timeline
```

为保持切片真实，至少测试：正常完成、abort、Pi 不存在、未知 Pi 事件、畸形客户端 JSON、断线重连、daemon 重启以及两个不同 `serverId` 的缓存隔离。

## 必须先穿刺的高风险点

- **协议规模：** 现有 daemon session dispatch 横跨几乎所有能力。建立机器可检索的消息/命令迁移 ledger，不凭记忆判断完成度。
- **Web 裁剪：** `.web.*` 不是完整 Web；普通共享文件和 browser-safe desktop adapter 仍是依赖。先绿构建再删。
- **Relay crypto：** Go 使用成熟 NaCl 兼容库，并与 TS 生成 golden vectors；不能自行组合近似原语。
- **插件 runtime：** 现有 ABI 依赖 Node/esbuild。先决定受管理 sidecar 或版本化替代，再承诺产品无 Node 运行依赖。
- **跨平台系统能力：** PTY、watcher、signals/process groups、Unix socket 和 Windows named pipe 必须分别设计和验证。
- **Hub 外部来源：** monorepo 不包含 Hub server。必须读取外部仓库和许可证，不能从 daemon 客户端反推实现。
- **数据隔离：** byspace 默认只读写 `~/.byspace`；未来若需要 Paseo 历史迁移，必须是显式单向导入，不能让两个 daemon 共享 home。

## 域名约定

- `app.byspace.cc.cd`：托管 Web/PWA 与配对落地页。
- `relay.byspace.cc.cd`：Cloudflare Relay 的 WSS `/ws` 与健康端点。
- `hub.byspace.cc.cd`：Hub dashboard、HTTP API、provider callbacks/webhooks 与同 host daemon WebSocket。
- `byspace.cc.cd`：根站点/文档用途以后确定。

暂不创建 `api.*` 或 `worker.*`：当前没有需要它们承载的独立契约；Cloudflare Worker 可以使用 `relay.*` 自定义域名，不需要把运行平台暴露在产品命名里。

## 参考证据

Paseo 参考仓库：`~/workspace/forks/paseo`

- 总体：`docs/architecture.md`、`docs/data-model.md`、`docs/providers.md`
- Web：`packages/app/src/runtime/host-runtime.ts`、`packages/app/src/types/host-connection.ts`、`packages/app/metro.config.cjs`、`scripts/build-daemon-web-ui.mjs`
- daemon：`packages/server/src/server/bootstrap.ts`、`packages/server/src/server/session.ts`、`packages/server/src/server/agent/agent-sdk-types.ts`
- Pi：`packages/server/src/server/agent/providers/pi/`
- CLI：`packages/cli/src/utils/client.ts`、`packages/cli/src/commands/`
- Relay：`packages/relay/src/`、`packages/server/src/server/relay-transport.ts`、`SECURITY.md`
- Hub：`docs/hub.md`、`public-docs/hub/`、`packages/server/src/server/hub/`、`packages/cli/src/commands/hub/`
- 外部：`https://github.com/getpaseo/paseo-relay`、`https://github.com/getpaseo/hub`
