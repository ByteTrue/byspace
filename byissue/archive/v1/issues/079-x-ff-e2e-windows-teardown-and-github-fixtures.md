---
kind: issue
title: "e2e：Windows teardown 的 EBUSY、GitHub fixture 的 /tmp 与 delete_repo scope"
type: ff
status: closed
created: 2026-10-13
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# e2e：Windows teardown 的 EBUSY、GitHub fixture 的 /tmp 与 delete_repo scope

> **读者：** 接手 e2e 基建的人。
> **自检（四答即可）：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `byissue/` 有无影响。

---

在 078 的验收范围之外又跑了 9 个含 `withWorkspace` 的 spec（73 例），暴露三个独立问题，都不在 ubuntu CI 上出现。

## 1. teardown 的 EBUSY（5/73）

`with-workspace` 的 `cleanup()` 先 `client.removeProject()`、再删临时仓库，但 daemon 的 WS 连接一直开着。daemon 对每个 fixture 仓库持有原生 watcher，Windows 上未关闭的 handle 让 `rmdir` 报 `EBUSY: resource busy or locked`。失败的 5 例全部是 `repo.cleanup()` 的 rmdir，测试主体已通过。

剂量-反应（同一个 9-spec 批次，无并发干扰）：

| 配置                                 | EBUSY            |
| ------------------------------------ | ---------------- |
| `TEMP_CLEANUP_RETRIES = 5`（基线）   | 5                |
| `= 15`                               | 1                |
| `= 15` + 删目录前先 `client.close()` | **0**，连续 3 轮 |

- `workspace.ts` — retries 5 → 15（`fs.rm` 的 retryDelay 线性递增，5 次只有约 1.5s）
- `with-workspace.ts` — `repo.cleanup()` 之前先关掉 daemon client

## 2. GitHub fixture 用硬编码 `/tmp`

`github-fixtures.ts` 有 4 处 `path.join("/tmp", …)`。Windows 上 `path.join("/tmp", x)` 得到 `\tmp\x`（当前盘符根的相对路径，不存在），`git clone` 直接失败。同包 `workspace.ts` 已有 `resolveTempRoot()` 处理这件事，这 4 处漏了。

改为 `resolveTempRoot()`。这与 078 根因 1 是同一类（POSIX 路径假设），但当时只扫了 `/` 分割，没扫 `/tmp`。

## 3. fixture 清理失败被吞掉，仓库泄漏

`gh repo delete` 需要 token 的 `delete_repo` scope。本机 token 只有 `gist, read:org, repo, workflow`，删除一律 403，而 cleanup 包在 `try/catch` 里静默吞掉。后果是每跑一次泄漏一个仓库，攒到 20 个之后 GitHub 开始对 `repo create` 回 "You have created too many repositories, too quickly" —— 看起来像 fixture 坏了，其实是配额。

`hasGithubAuth()` 只检查 `gh auth status`，所以这些 spec 在有 auth 但没 scope 的机器上照跑不误。server 侧 `checkout-pr-merge.e2e.test.ts` 早就为此 gate 在 `delete_repo` 上，app 侧没有对齐。

- `hasGithubAuth()` → `canCreateGithubFixtures()`，同时检查 `delete_repo` scope（改名是因为它返回 false 时 auth 其实是好的）
- `auto-archive-after-merge.real.spec.ts` 原来**完全没有 gate**，补上
- 各处 skip 文案统一为 "Requires gh auth with the delete_repo scope"

结果：那 2 个 composer-attachments GitHub 用例从「跑起来→克隆失败/限流」变成正确跳过，`EXIT=0`，不再泄漏。

**遗留：** 已经泄漏的 20 个 `byspacetmp-*` 仓库需要 `delete_repo` scope 才能删。在本机执行：

```bash
gh auth refresh -h github.com -s delete_repo
# 然后
gh repo list --limit 200 --json name --jq '.[] | select(.name|startswith("byspacetmp")) | .name' \
  | xargs -I{} gh repo delete ByteTrue/{} --yes
```

## 验证

9 个含 `withWorkspace` 的 spec 连跑 3 轮，**EBUSY 三轮全 0**（本 issue 的修复目标）：

| 轮次       | 结果                                 | 说明                                                                                                                                                     |
| ---------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 第 1 轮    | 70 passed / **2 failed** / 1 skipped | 那 2 例是 `composer-attachments` 的 GitHub 用例，当时还没加 scope 门控、真跑并失败 —— 归 [081](081-x-ff-github-fixture-gate-and-stale-option-id.md) 处理 |
| 第 2、3 轮 | 70 passed / 0 failed / 3 skipped     | 门控加上后这两例转为正确跳过                                                                                                                             |

`typecheck`、`lint`、`format:check` 全绿。

**更正记录：** 本条最初写的是"连跑 3 轮：70 passed / 0 failed"，与第 1 轮日志不符（70 passed / 2 failed）。EBUSY 归零是三轮都成立的结论，但"零失败"只对第 2、3 轮成立。

## 对 `byissue/` 的影响

无。行为不变，只是 Windows 上不再误报、GitHub fixture 不再泄漏仓库。
