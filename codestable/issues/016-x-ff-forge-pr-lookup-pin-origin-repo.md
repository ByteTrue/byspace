---
id: "015"
type: ff
title: Forge PR 直读显式锚定 origin 仓库
status: closed
date: 2026-09-07
---

## 做了什么

在同时配置 `origin` 与 `upstream`(非 fork 关系)remote 的仓库里,BySpace 客户端点 merge 报
"Unable to determine current change request number for merge",且此前已识别的 PR 状态一并丢失。

根因:PR 解析有两条路径且对 base repo 的认定不一致——

- 后台轮询:slug 只读 `remote.origin.url`,GraphQL 按 origin 仓库查 → 正确识别。
- merge 等操作的强制直读(`force: true`):`gh pr view` / `gh pr list` 不带 `--repo`,
  gh 在多 remote 时按 fork 工作流启发式优先把 `upstream` 当 base repo、origin 当 fork head,
  到 upstream 仓库里找 `owner:branch` → 找不到 → `forge.pullRequest = null` → 报错;
  强制读的 null 还会覆盖缓存(force 路径无 stale 回退),造成"识别后失效"。

修复:`getCurrentPullRequestStatus` 的 load 里经 `resolveRepoSlugCached`(与轮询路径同源)
取 origin slug,`gh pr view <branch> --repo <slug>` 显式锚定;`gh pr list` 同样带上。
slug 为 null(无 origin/读取失败)时保持旧行为,不回归单 remote 与 fork(upstream=父仓库)场景。

## 改了哪些

- `packages/server/src/services/github-service.ts` — `resolveCurrentPullRequestView` /
  `tryCurrentPullRequestView` 接受 origin slug 并传 `--repo`
- `packages/server/src/services/github-service.test.ts` — 新增多 remote 锚定回归测试;
  两个未 stub `resolveRepoSlug` 的时序测试补 stub(load 中新增的 slug await 在 fake timers
  下会引入真实 `git config` 子进程延迟)

## 怎样验证

- 现场复现:在 hesitant-swan worktree(3 remotes)`gh pr view` 报
  `no pull requests found for branch "ByteTrue:fix/..."`,
  `gh pr view <branch> --repo ByteTrue/byspace` 正确返回 PR #29
- `npx vitest run src/services/github-service.test.ts` 109/109;
  `workspace-git-service.test.ts` + `checkout-git.test.ts` 197 过 1 skip;
  `checkout-session.test.ts` 38/38
- `npm run typecheck`、`npm run lint` 干净

## 对 codestable/ 的影响

无既有 spec 记录 forge PR 解析路径,无需回写;本 ff 即记录。
