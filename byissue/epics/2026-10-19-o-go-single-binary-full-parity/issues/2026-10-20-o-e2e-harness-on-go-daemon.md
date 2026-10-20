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

## 第八轮：按 Node 重写 directory_suggestions + projectKey

用户要求「就按你说的做」，于是做了三件本该在翻译阶段就做对的事。

### a. `directory_suggestions` 重写（新增 `internal/match` + `internal/dirstream`）

原实现是「读一层目录 + prefix/contains 过滤」，且 `matchMode` 用了协议里不存在的
`prefix`/`contains`（协议只有 `fuzzy`/`suffix`）。

现在按 Node 重写：

- `internal/match/text.go` ← `packages/protocol/src/search/text-match.ts`（351 行）：
  六级 tier（exact / whole-word / prefix / word-start / substring / subsequence / fuzzy）、
  `PolicyForToken` 的按长度分级容错、Damerau-Levenshtein 的预算剪枝、跨分隔符的 compact 匹配。
- `internal/dirstream/{search,fs}.go` ← `archive/.../utils/directory-suggestions.ts`（777 行）：
  多级树遍历 + round-robin、`node_modules`/`dist`/`target` 等构建目录跳过、gitignore 感知、
  带 rank 的排序（matchTier → segmentIndex → matchOffset → fuzzyScore → depth → kind → path）、
  path query 与 text query 两种语义、`suffix` 模式、精确路径检索不套 ignore 规则。

**行为差异的实测**：`compo` 现在能命中 `packages/app/src/components`（之前只会看根目录一层）。

### b. `projectKey` 派生（新增 `internal/projectkey`）

`projectKey` 是侧边栏分组的身份：同一 remote 在两个主机上的 checkout 必须派生出相同的 key，
否则它们是两个项目。之前我把 key 直接设成路径，跨主机分组从根本上不可能。

按 `archive/.../server/project-key.ts` 移植：

- remote 形式优先：`remote:<host>[/:<port>]/<path>`，GitHub 路径小写化，自建 forge 保留大小写
- 子目录选择加 `#subdir:<relpath>`
- 无 remote 时用 `<path>` 并加 `host:<serverId>:` 前缀，避免两台机器的本地项目撞名
- 默认端口（443/80/22）不写进 key，非默认端口保留

同时修了两处调用：

- `project.create_directory` / `project.android.clone` / `workspace.create` 里的项目 key 都改走派生
- 描述符里的 `project.projectKey` 之前发的是**内部 projectId**，现在发派生 key
- 启动时 `BackfillProjectKeys()` 给缺 key 的旧记录回填（对齐 Node 的 boot reconciliation）

### c. `project.add` / `create_directory` / `github.clone` 不该自动建工作区

Node 走 `findOrCreateProjectForDirectory`（只建项目），Go 走 `EnsureWorkspaceForCwd`（项目+工作区）。
新增 `FindOrCreateProjectForDirectory` 并把三个调用点改过去。

## 验证（第八轮后）

- `add-project-flow` **8/8**
- `sidebar-project-grouping` **6/9**（跨主机同仓库、同仓库子目录跨主机、同主机两个 clone 均通过；
  失败的 3 个是多主机重命名/建工作区/移除弹窗）
- `sessions-empty` + `settings-navigation` + `workspace-lifecycle` **18/18**
- `workspace-labels` **1/3**
- `go test ./...` 全绿，新增 `internal/match`、`internal/dirstream`、`internal/projectkey` 共 20 个用例
- `audit:browser` 10/10；`go-parity-audit` 出站 0 / 未路由 0

## 未完成，需要后续 Issue

- `sidebar-project-grouping` 剩下 3 个多主机用例（重命名 / 从分组项目建工作区 / 多主机移除弹窗）。
- `workspace-labels` 剩余 2 个用例的 picker 渲染。
- `go-parity-audit` 报的 48 条入站字段缺口，主要集中在 `hub.*`（未实现）、`plugin.*`（无运行时）、
  以及若干请求的可选能力字段。
