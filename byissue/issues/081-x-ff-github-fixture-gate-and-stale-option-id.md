---
kind: issue
title: "GitHub fixture 复盘：gate 四份拷贝收敛成两处、过期 option id、搜索索引等待"
type: ff
status: closed
created: 2026-10-13
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# GitHub fixture 复盘：gate 四份拷贝收敛成两处、过期 option id、搜索索引等待

> **读者：** 接手 e2e 基建的人。079 处理了泄漏本身，这条是复盘时顺带查出来的三件事。

---

079 关闭后按要求复盘「为什么会泄漏」，发现根因比 079 记的更深，并顺带查出一个从没跑过的过期断言。

## 1. gate 有 4 份拷贝，3 份是错的

判定「这台机器能不能跑 GitHub 测试」的代码散在四个文件里，名称各异：

| 文件                                                              | 原名                                               | 查了 scope? |
| ----------------------------------------------------------------- | -------------------------------------------------- | ----------- |
| `app/e2e/support/helpers/github-fixtures.ts`                      | `hasGithubAuth`                                    | 否 → 079 修 |
| `server/.../checkout-pr-merge.e2e.test.ts`                        | `hasGitHubCliAuth` + `hasGitHubCliDeleteRepoScope` | 是          |
| `server/.../checkout-ship.e2e.test.ts`                            | `hasGitHubCliAuth`                                 | 否          |
| `server/.../auto-archive-unrelated-github-merge.real.e2e.test.ts` | `hasGitHubTestAccess`                              | 否          |

后两个**不在 CI 的 server-tests 文件列表里**，只在手动跑时泄漏 —— 这就是回收的 20 个仓库里 `byspacetmp-unrelated-merge-*` 的来源（最早一个 08-24）。

收敛为每包一处：`canCreateTempGithubRepos()`（server `test-utils/temp-github-repo.ts`，该文件本就拥有 `byspacetmp-` 前缀）与 `canCreateGithubFixtures()`（app）。app 不依赖 server 包，跨不了包，两份互相注释指路。

## 2. composer-attachments 的 option id 是过期的 `pr:`

`id: \`\${item.kind}:\${item.number}\``（`packages/app/src/composer/index.tsx:1758`），而 `ForgeSearchItemSchema.kind`是`z.enum(["issue", "change_request"])`（`packages/protocol/src/messages.ts:2567`）。spec 断言的是 `pr:\${number}`—— 这个 id 从 forge search 把 PR 改名`change_request` 那天起就不存在了。

**它从没失败过，因为这两个 spec 在 CI 上永远 skip**（CI 无 `gh` 认证）。本机缺 `delete_repo` scope 时也 skip。补齐 scope 后第一次真跑，它立刻红了。

修：断言改为 `change_request:\${number}`。

## 3. GitHub 搜索索引对新建 issue/PR 有延迟

Spec 建完 issue/PR 立刻在 picker 里搜标题。实测索引延迟 6~12s，个别到 20s，而 picker 只等 15s，所以是偶发红。

修：`createTempGithubRepo({ waitForSearchIndex: true })` 在返回前轮询到可搜到为止。轮询用 daemon 同款命令（`gh issue list --search` / `gh pr list --search`）——`search/issues` 端点滞后更久，用它会出现「以为索引好了、app 仍搜不到」。

## 验证

- 两个 gate 函数用 Node 直接验：有 scope → true；无 scope / 未认证 → false。
- `composer-attachments.spec.ts -g "GitHub"`：**4 passed / 0 failed / 0 skipped**。这覆盖了 issue 例与 PR 例，即 `pr:` → `change_request:` 的修正端到端跑通。
- 清理：跑完 0 个 `byspacetmp-*` 残留，四个 fixture 的仓库都删掉了。
- `typecheck` / `lint` / `format:check` 全绿。

**（补记）验证曾受阻：** 首次尝试时本机因当天反复建仓触发 GitHub 二级限流（`You have created too many repositories, too quickly`），15 分钟以上未解除，当时只验到 issue 例。限流是环境状态不是代码问题；等它自行解除后补跑，PR 例通过。

## 顺手发现（不在本次范围）

`server/src/server/daemon-e2e/*.e2e.test.ts` 里大量 `execSync("git ... -m 'Initial commit'")` 用单引号。Windows 上 `execSync` 走 `cmd.exe`，它不把 `'` 当引号 —— 用 Node 复现过，命令变成 `git commit -m 'Initial commit'` 直接把 `commit'` 当 pathspec，报 `error: pathspec 'commit'' did not match`。`checkout-ship.e2e.test.ts` 的两例因此在 Windows 上必红。

全仓同类写法 **67 处，散布 12 个文件**（`git-operations.e2e.test.ts` 一个文件占 31 处）。

**严重度限定：** 这 67 处所在的文件**都不在 CI 的 server-tests 列表里**（`npm run test:integration` 是一份固定文件清单，不含这些 `daemon-e2e/*.e2e.test.ts`；Windows job 只跑 PTY benchmark）。所以它不影响 CI 绿，只影响在 Windows 上手动跑这些 e2e 的人。修法与 079 的「Windows 测试基建」同主题，需要单独一次处理。

## 对 `byissue/` 的影响

新增 `notes/012-github-fixture-repo-leak.md`（泄漏机制 + 诊断/批量清理命令），与并行的 `notes/011-playwright-spec-cross-file-project-leak.md` 互相指向（同一个「清理失败被吞」形状的 app 侧与 GitHub 侧）。
