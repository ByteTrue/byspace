---
kind: issue
title: "PR 状态的后台轮询与推送（workspace payload 里的 github 段缺失）"
type: issue
status: open
created: 2026-11-01
---

# PR 状态的后台轮询与推送

## 现状

Node 的 `workspace-git-service` 为每个仓库目标维护 forge 快照，并按 PR 状态轮询：检查在跑时 20s（`FORGE_PR_STATUS_POLL_FAST_INTERVAL_MS`）、空闲 120s（`FORGE_PR_STATUS_POLL_SLOW_INTERVAL_MS`）、错误指数退避到 300s 上限，**变更后随 `workspace_update` 推送**（`session.ts` 的 workspace 快照带 `github: { featuresEnabled, pullRequest }`）。

Go 侧：

- 有拉取 API：`checkout_pull_request` → `workspace.GetPRStatus`，`internal/workspace/forge.go`。
- 没有周期性刷新，也没有推送。
- `internal/server` 的 workspace descriptor **完全没有 `github` 段**，协议里 `WorkspaceGitHubRuntimePayloadSchema.pullRequest` 在前端恒为缺失。

## 为什么现在不做

这不是一个可以就地补的不变量，而是一次 payload 契约与消费方的决定：

1. 要新增 workspace payload 的 `github` 段（含 `featuresEnabled`、`pullRequest`、`checks` 的完整形状），并决定它与 `checkout_pull_request` 响应的关系——两份数据同时存在时必须能说清谁是权威。
2. 消费方是正在重写的 web 客户端（`web/` 分支进行中）。现在推一个没人读的字段，等于制造第二个数据源。
3. 轮询本身要按 Node 的成本设计来做：检查 pending 时快、空闲时慢、错误退避、按仓库去重、GraphQL point 预算（Node 的批量上限 25、对齐网格 5s 都是为 5000 点/小时的配额设计的）。直接照抄成「每个 workspace 一次 `gh pr view`」会把配额打穿。

## 验收标准

- workspace payload 出现 `github.pullRequest`，字段通过协议校验，且与 `checkout_pull_request` 的同一 PR 数据一致（同源，不各自计算）。
- 检查 pending 时 ~20s 内面板能看到新状态，空闲时不再高频请求；连续失败时退避到 300s 上限并保留最后一次成功数据。
- 多 workspace 共享同一仓库时，一次轮询只发一次请求（按 repo 去重）。

## 参考

- Node：`packages/server/src/server/workspace-git-service.ts`（快照与轮询）、`services/github-service.ts`（批量、退避、配额）、`server/session.ts:4900`（payload 组装）。
- 本仓相关：`byissue/notes/018-durable-object-billing-and-hibernation.md`（为什么每帧都要算成本）、`docs/forge-providers.md`。

## 实现（2026-11-02，快改 [rewrite-leftover-fixes](2026-11-02-x-ff-rewrite-leftover-fixes.md)）

「为什么现在不做」里的三点都已有答案：消费方就是侧栏的 PR 徽标（旧版、新版都读 `githubRuntime.pullRequest`，Go 一直不发，所以徽标从没出现过）；它和 PR 面板（`checkout_pr_status_request`）走同一个解析函数 `workspace.CurrentPRStatus`，同源；轮询照 Node 的成本设计做。

- 轮询：`internal/workspace/pr_status_poll.go`，照 Node 的 `github-service.ts`（retainCurrentPullRequestStatusPoll 与批量）和 `workspace-git-service.ts`（retainGenericForgePrStatusPoll）。检查在跑 20 秒、空闲 2 分钟、连续失败翻倍到 5 分钟；GitHub 目标对齐到 5 秒网格，同一主机一次 GraphQL 查 25 个；剩余额度降到 40% 时该主机暂停到额度重置；fork 改查父仓库；已结束 PR 的检查结果缓存；匹配不上或候选页满时退回单独查询。
- 找 PR：`internal/workspace/github_pr_lookup.go`（Node 的 PullRequestStatusLookupTarget：worktree 元数据里记的 PR、分支跟踪配置、push 配置、HEAD 提交）和 `github_pr_current.go`（Node 的 resolveCurrentPullRequestView：`gh pr view <分支> --repo`，不是这个 checkout 的 PR 时列出该分支所有状态的 PR；开着的 PR 总算，已合并或关闭的只在 HEAD 还是它的 head 提交时算）。附带 Node 的合并信息查询（forgeSpecific），PR 面板的合并按钮读它，Go 原来不发。
- GitLab 的 MR 状态照 Node 重写（`gitlab_pr_status.go`）：按源分支找 MR；开着的 MR 状态是 `open`（原来是 GitLab 原样的 `opened`，客户端当成已关闭）；检查是最新流水线的作业，汇总用 GitLab 自己的流水线状态；审批和合并信号放进 forgeSpecific。
- 服务器：`internal/server/pr_status.go`。有客户端连着时轮询所有活着的 git 工作区，没有客户端时停。结果写进工作区描述的 `githubRuntime`，变了就推送；失败保留上一次成功的结果。在应用里提交、推送、切分支、建 PR、合并之后立刻重查；在终端里切分支、提交，打开着 Changes 面板时立刻发现，否则由每 5 分钟一次的放置检查发现（Node 用文件监听立刻发现；Go 的分支、改动统计也是这样延迟的，没有在这次改）。
- 顺带修掉：从 PR 建的 worktree 从不写元数据（`writeCreatedWorktreeMetadata` 读的是只有 branch-off 才设置的 BaseBranch），于是 fork 的 PR 找不回来；元数据里的 head owner 原来写成了「owner/仓库名」。

验证：Go 测试（轮询间隔与退避、批量、额度暂停、fork 改查、检查缓存、释放即停、候选挑选、查找目标、GitLab MR、描述里的 PR 与推送、PR worktree 元数据）。开发版实测：用 cli/cli#14783（fork 的 PR）建 worktree，元数据记下 base `trunk` 和 owner `mrecachinas`，8081、8082 侧栏都出现「14783 · passed」徽标和悬停卡片的 Checks；PR 面板的状态带合并信息；两个前端都没有校验报错。其余测试工作区的 PR 都已合并且分支已经走过了 PR 的 head 提交，按 Node 的规则不再显示。

没做：Gitea 的 PR 状态（Node 的 `gitea-service` 当前 PR 与提交状态、Actions 检查），Go 原来也没有，见 [gitea-pr-status](2026-11-02-o-gitea-pr-status.md)；GitLab、GitHub Enterprise 没有真实账号与主机，未实测。

等用户验收后关闭。
