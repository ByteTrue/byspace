---
kind: issue
title: "快改：e2e 的 GitHub fixture 不再把临时仓库留在账号里（GitHub #37）"
type: ff
status: closed
created: 2026-11-03
---

# 快改：e2e 的 GitHub fixture 不再把临时仓库留在账号里（GitHub #37）

> **读者：** 接手 e2e 基建的人。泄漏机制与诊断命令见 [note 012](../notes/012-github-fixture-repo-leak.md)，这里只记这次改了什么、怎么验的。

本机跑在线 GitHub 用例会在 `gh` 登录的账号里建 `byspacetmp-*` 仓库。11-02 清账号时有 7 个是 e2e 留下的（10-23 到 10-28），ByteTrue/byspace#37 记了两条根因；11-03 又留下 7 个，查到第三条。

## 改了什么

- **建仓在 `try` 之外**（#37 建议 2）：`new-workspace.spec.ts` 的 clone、`composer-attachments.spec.ts` 两条用例的开工作区都移进 `try`，`finally` 删仓。
- **`createTempGithubRepo` 内部失败**（11-03 新查到）：`repo create --push` 推送失败时仓库已经建好，函数直接抛错，调用方拿不到 fixture 去删（11-03 白天漏的 7 个都是这条）。现在 `repo create` 之后任何一步失败都会先删仓再抛。
- **钩子超时**（11-03 验证时新查到）：pr-pane 的 `beforeAll` 建 6 个 PR 加检查和评论要一分多钟，默认 60 秒超时。超时时 `afterAll` 先跑，fixture 还没建完、拿不到，什么也没删；fixture 随后建完，没人删。重试又来一遍，一次运行漏 2 个。修法两处：
  - 仓库名带本次运行的 id（global setup 生成，worker 继承），global teardown 删掉本次运行剩下的仓库和本地克隆（`sweepTempGithubFixtures(runId)`）。
  - pr-pane 的钩子超时改为 4 分钟。
- **兜底扫除**（#37 建议 1）：global setup 删掉建于 30 分钟前的 `byspacetmp-*` 仓库和 `/tmp` 里同样过期的本地克隆，接住 teardown 之前就被杀掉的运行（本机 `/tmp` 已积了 137 个本地克隆、7.5 MB）。扫除只在 `canCreateGithubFixtures()` 为真时跑，失败只打警告，不挡测试。
- 清理时删除失败不再静默，打一行警告。
- `docs/testing.md`、note 012 按现状改写；gate 注释里指向已归档 server 的那段删掉。

## 验证（按 #37 的验收）

- 强杀：起 `pr-pane.spec.ts`，仓库建好 15 秒后对整个进程组 `kill -9`，`afterAll` 没跑，留下 `byspacetmp-pr-pane-1793720541053-agy98`（15:42:22Z 建），进程无残留。
- 窗口：紧接着跑 `new-workspace.spec.ts` 两条 GitHub 用例、`composer-attachments.spec.ts` 两条 GitHub 用例，都通过；global setup 没动那个还不满 30 分钟的仓库，四条用例自己建的仓库都删了。
- 扫除：16:13 再跑 pr-pane，global setup 删掉了 agy98，并清掉 `/tmp` 里 124 个旧的本地克隆。这一次 pr-pane 的 `beforeAll` 超时，暴露出上面的「钩子超时」，留下 2 个（g9qca、ta2d9）。
- 钩子超时修复后的验证见「执行记录」。

## 执行记录

- **16:20 正常跑 pr-pane**（钩子超时 4 分钟）：6 条全过，用时 2.2 分钟（只建 fixture 就超过 1 分钟）；本次运行建的仓库跑完即删。
- **16:23 复现钩子超时**：把 pr-pane 复制一份、钩子超时改成 20 秒，两次尝试都超时，正是 16:13 漏仓的情形。这次 global teardown 删掉了本次运行留下的 2 个仓库（`byspacetmp-pr-pane-mw0wbxd3wqh-q6fyp`、`…-wa0xb`）和它们的 14 个本地克隆；又等 60 秒，没有迟到的仓库出现。
- 16:13 那次漏的 2 个（修复前的代码建的，名字里没有运行 id、也不满 30 分钟，两道扫除都按设计没动）手动删掉。现在账号里 `byspacetmp-*` 为 0，`/tmp` 里的本地克隆为 0。
- **关闭**：提交 `edc9b220c`，CI 全部通过（22 项通过、16 个端到端分片全过，4 项按路径没有触发）。用户 11-03 验收关闭，GitHub #37 同时关闭。
