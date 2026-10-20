---
kind: issue
title: "把 Playwright E2E 套件的 daemon 宿主从 Node 换到 Go 二进制"
type: feature
created: 2026-10-20
---

# 把 Playwright E2E 套件的 daemon 宿主从 Node 换到 Go 二进制

归属 Epic：`byissue/epics/2026-10-19-o-go-single-binary-full-parity`。

## 目标与范围

`packages/app/e2e/` 有 186 个 Playwright spec，它们的 daemon 由
`e2e/support/helpers/isolated-host-daemon.ts` 启动——spawn 的是
`packages/server/scripts/supervisor-entrypoint.ts`（Node）。该包已归档到 `archive/`，所以整
套 E2E 目前跑不起来。

目标：把这唯一一处 daemon 启动点换成 `./bin/byspace`，让 186 个 spec 重新可跑。**不改任何 spec**，
除非它依赖 Node 独有的行为。

- **包含**：daemon 启动 helper、Go 侧为满足 E2E 所需的环境变量契约、配置读取结构对齐。
- **不包含**：重写 spec、Playwright 配置的 project 划分。

## 审计：换宿主需要 Go 侧补什么

对照 `isolated-host-daemon.ts` 传给 Node daemon 的环境变量，逐个核对 Go 侧支持情况：

| 环境变量                         | Node 用途                          | Go 现状                                       |
| -------------------------------- | ---------------------------------- | --------------------------------------------- |
| `BYSPACE_HOME`                   | home 目录                          | ✅ 支持                                       |
| `BYSPACE_LISTEN`                 | 监听地址                           | ✅ 支持                                       |
| `BYSPACE_SERVER_ID`              | 固定 serverId（spec 用它拼路由）   | ✅ 支持                                       |
| `BYSPACE_CORS_ORIGINS`           | 允许 Metro origin 跨域             | ❌ **完全没有 CORS**                          |
| `BYSPACE_RELAY_ENABLED`          | 关掉 relay                         | ❌ 未支持（默认关，可接受）                   |
| `BYSPACE_DISABLE_HOME_WORKSPACE` | 关掉 daemon 自建的 Chief workspace | ❌ 未支持（Go 会自建，spec 的工作区计数会错） |
| `BYSPACE_NODE_ENV`               | 开发模式                           | ➖ 不适用                                     |

## 审计：顺带发现的真实缺陷

`$BYSPACE_HOME/config.json` 的真实结构是：

```json
{
  "version": 1,
  "daemon": { "listen": "...", "cors": { "allowedOrigins": ["*"] }, "appendSystemPrompt": "..." }
}
```

Node 读的是 `persisted.daemon.<key>`（`archive/packages/server/src/server/config.ts:103,298,409,460`）。
**Go 的 `store.LoadDaemonConfig()` 读的是扁平 `<key>`**，于是：

- 用户的 `appendSystemPrompt`（本机是「永远使用中文回复」）被 Go 版静默忽略
- `daemon.cors.allowedOrigins` 被忽略
- `daemon.terminalAgentHooks`、`daemon.mcp` 等同理

这是「翻译时换了结构」的典型例子，与 `byissue/decisions/004` 里记的坑同类。本 Issue 一并修正。

## 执行记录

1. `store.LoadDaemonConfig` / `SaveDaemonConfig` 改为读写 `{"version":1,"daemon":{...}}` 嵌套结构，
   与 Node 的 `PersistedConfigSchema` 一致。**这是本轮最重要的修复**：之前读根层，导致用户的
   `appendSystemPrompt`（本机是「永远使用中文回复」）、`cors.allowedOrigins`、
   `terminalAgentHooks` 全部被静默忽略。
2. 新增 CORS 中间件：`config.daemon.cors.allowedOrigins` + `BYSPACE_CORS_ORIGINS`（逗号分隔），
   支持 `*`，预检返回 204。对齐 `archive/packages/server/src/server/bootstrap.ts:843`。
3. 新增 `BYSPACE_DISABLE_HOME_WORKSPACE=1`：跳过 `store.EnsureHomeWorkspace`，让 spec 的工作区计数成立。
4. `isolated-host-daemon.ts` 改为 spawn `bin/byspace serve`；删除只对 npm 包有意义的
   `publishedVersion` 分支，改为 `daemonBinary` 覆盖；保留原接口，spec 无需改动。
5. 归档 `agent-timeline-pagination-old-daemon.spec.ts`（它测的是已发布的**旧版 daemon**，
   Go 版没有「旧版」这个概念）。

## 跑测试过程中抓出的真实缺陷（本 Issue 的额外收获）

### a. `project.create_directory` 读错字段名 — 新建项目目录会落到 daemon 的 cwd

协议字段是 `parentPath`（`ProjectCreateDirectoryRequestMessageSchema`），Go 读的是
`parentDirectory`。`json.Unmarshal` 不报错，字段为空 → `filepath.Join("", name)` →
目录建在 daemon 的工作目录下。用户看到的是「新建项目后路径不对」。

### b. 审计脚本漏报的根本原因

`scripts/go-parity-audit.mjs` 原先检查「字段名在整份 Go 源码里出现过」。`parentPath` 恰好出现
在 `internal/workspace/files.go` 的一个函数签名里，于是被判为已覆盖。

改为 `handlerScopeFor()`：先定位 `case "<type>":` 分支，再顺着 `s.handleXxx(...)` 调用把被调
函数的函数体纳入作用域。**改完后缺口从 0 条变成 48 条** —— 那 48 条是真实存在但被旧逻辑掩盖的。

### c. `workspace.label.*` 缺增量同步 — 多端标签会一直显示旧值

`WorkspaceLabelSyncMetadataSchema` 有 `generation` + `headSeq`，前端 `host-replica.ts` 只在
`update.seq === cursor.afterSeq + 1` 时应用 `workspace.label.update`。Go 侧：

- `list` 返回固定的 `generation: "gen_1"`、`headSeq: labels.length`
- 从不广播 `workspace.label.update`

结果：创建/改名/删除标签后，本端靠 list 刷新能对上，其它已连接的客户端永远看不到变化。
已改为持久化 `LabelCatalog{generation, headSeq, labels}`，每次变更 `headSeq++` 并广播增量帧。

## 验证

- `sessions-empty` / `settings-navigation` / `workspace-lifecycle` 三个 spec 共 **18 个用例全部通过**。
- `add-project-flow` 6/8 通过（`parentPath` 修复后从 5/8 提升），剩 2 个卡在
  `directory_suggestions` 的模糊搜索。
- `workspace-labels` 1/3 通过；另 2 个仍差 picker 的行渲染（后端已确认 list 与 update 都正确）。
- Go 侧 `go test ./...` 全绿；`audit:browser` 10/10；`go-parity-audit` 出站 0 / 未路由 0。

## 未完成，需要后续 Issue

- **`directory_suggestions` 的实现与 Node 完全不同。** Node 的
  `archive/packages/server/src/utils/directory-suggestions.ts` 是 777 行的模糊搜索引擎
  （`scorePathMatch` 来自 `packages/protocol/src/search/text-match.ts`，351 行），支持
  `fuzzy`/`suffix` 两种模式、gitignore 感知、多级遍历、相关性排序。Go 侧只有「读一层目录 +
  prefix/contains 过滤」，且把 `matchMode` 的枚举值写错了（用了不存在的 `prefix`/`contains`，
  协议只有 `fuzzy`/`suffix`）。这是**我发明而非翻译**的又一处，需要按 Node 重写。
- `workspace-labels` 剩余 2 个用例的 picker 渲染问题需要单独定位。
