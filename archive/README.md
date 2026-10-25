# archive/ —— Node 实现的归档

这些是从 `packages/` 移过来的 Node/TypeScript 实现，**保留用于对照，不参与构建**。

## 为什么留着

Go 重写的原则是「架构学 magpie，每处能力的行为逐条从 Node 翻译」。翻译时会反复需要原文：
`session.ts` 的某个 RPC 分支、`agent-manager.ts` 的轮次状态机、`provider-manifest.ts` 的
provider 定义。删掉就得去翻 git 历史，那比留一个目录贵得多。

实际踩过的例子：`process_exit` 该发 `turn_completed` 还是 `turn_failed`、`steer` 在无活跃
轮次时该退化成什么，都是靠读这些文件才定下来的（见
`byissue/decisions/004-go-single-binary-architecture.md` 的「已知的偏离坑」）。

## 什么被归档了

| 路径 | 原位置 | 被谁替代 |
| --- | --- | --- |
| `packages/server/` | `packages/server/` | `internal/{server,agent,terminal,workspace,store,schedule}` |
| `packages/cli/` | `packages/cli/` | `internal/cli/` |
| `packages/relay/src/{cloudflare-adapter,node-adapter,relay-session,web-static,cutover-proxy}` | `packages/relay/src/` | `internal/relay/` |
| `packages/relay/wrangler.toml` | `packages/relay/` | 未替代（Cloudflare Worker 部署配置） |
| `scripts/{ci-workflow,daemon-launch-contract}.test.mjs` | `scripts/` | 未替代（校验 Node 发布流水线的契约） |
| `scripts/{dev-daemon,seed-worktree-dev-state,package-bytetrue-baseline,benchmark-terminal-latency,measure-relay-latency}` | `scripts/` | 未替代（Node 侧的开发与发布工具） |
| `packages/app-e2e/tunnels-*.spec.ts` | `packages/app/e2e/browser/` | 未替代（依赖 Node daemon 的隔离启动 helper） |

## 什么没有归档

`packages/relay` 保留了一部分：`crypto.ts`、`encrypted-channel.ts`、`e2ee.ts`、`base64.ts`、
`types.ts`。这是**前端必需**的 E2EE 原语——`packages/client/src/daemon-client-relay-e2ee-transport.ts`
直接 import `@bytetrue/relay/e2ee`。归档的是 relay 的**服务端**，不是加密层。

`packages/{app,client,protocol,highlight}` 全部保留，它们是前端与共享协议，Go 侧也以
`packages/protocol` 为 wire 契约来源。

## 不要做的事

- **不要从 `archive/` 里 import**。没有任何 `npm` workspace 指向它，`knip.json` 也不扫描它。
- **不要在这里改代码**。它冻结在归档时刻，只读。
- **不要因为编译报错就删它**。Go 侧不依赖它；前端构建通过 `scripts/build-daemon-web-ui.mjs`
  读 `packages/app/dist`，不读归档目录。

## 什么时候可以删

Go 版接管日常使用、不再需要逐条对照 Node 行为时，整目录 `git rm -r archive/`。那一步会
留下一条清晰的提交记录，比逐步掏空更好追溯。
