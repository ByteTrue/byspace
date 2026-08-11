---
kind: issue
title: "恢复 main CI 可信基线"
type: bug
status: open
created: 2026-08-11
---

# 恢复 main CI 可信基线

## 做成以后是什么样

当前 `main` 的完整 CI 重新全绿，Git 手动刷新的测试与真实两阶段行为一致；后续 CI/CD 优化以一组可复算的成功 run 作为基线，而不是拿失败 run 或主观体感比较。

**范围：** 修正 stale test expectation，验证本地 Git 先响应、Forge 后更新；记录 CI、Playwright、发布与部署阶段的统一计时口径。**不包含：** 改变产品行为、开始 artifact promotion、改变 shard 数或顺手修其他测试。

## 当前坏在哪

提交 `5dd593dff` 把手动刷新改成先返回本地 Git/diff、再后台刷新 Forge。定向 `checkout-session.test.ts` 已覆盖新行为，但上层 `packages/server/src/server/session.test.ts` 仍断言请求处理期间同步调用 `github.invalidate`。

GitHub Actions run `31471036867` 因此在 Ubuntu 和 Windows 的同一测试失败：

- `session checkout refresh handling > forces a git, GitHub, and diff refresh on demand`
- `packages/server/src/server/session.test.ts:3222`
- 期望 `github.invalidate({ cwd: "/tmp/request-worktree" })`，实际同步调用次数为 0

这不是产品回归或 CI flake，而是测试仍描述旧同步边界。失败在 server job 中已经出现，但 workflow 继续等待 Playwright，最终约 17 分 34 秒后才结束。

## 必须守住的行为

- `checkout.refresh.response` 不等待 Forge 网络查询。
- 同一次刷新仍会强制完成 Forge 读取，并通过后续 checkout status update 发布 PR 状态。
- 新发现的 PR 仍能自动使 PR 面板出现。
- 不为满足旧断言恢复同步 `github.invalidate`。

## 动哪些、验哪些

- 更新上层 session test，使它分别观察本地响应边界与后台 Forge 完成边界。
- 保留 `checkout-session.test.ts` 的低层两阶段测试，避免两层测试互相描述冲突。
- 运行目标 server 测试文件、typecheck、lint、format；随后用 exact-SHA 远端 CI 验证 Ubuntu 与 Windows。
- 记录最近成功 CI 的 run ID、各 job `startedAt/completedAt`、Playwright shard 测试阶段，以及 npm/App/Relay workflow 执行时间。外部 queue time 单列。

基线已经确认的起点：最近 5 次成功 `main` CI 中位数约 15 分 33 秒、范围约 14 分 11 秒至 18 分 37 秒；成功 run `31417319455` 的四个 Playwright 测试阶段约为 16:24、11:30、12:24、14:00。

## 执行进展

2026-08-11：上层 session test 已改为用未完成的 Forge promise 验证两阶段边界。它先断言 `includeForge: false` 的本地 snapshot、diff refresh 和成功响应已经完成，再确认 `includeForge: true` / `manual-refresh-forge` 的后台读取已经启动，最后释放并等待该读取结束。没有修改生产代码，也没有恢复直接 `github.invalidate`。

本地与远端证据：

- 修复前：`npx vitest run packages/server/src/server/session.test.ts --bail=1` 稳定复现原断言失败。
- 修复后：同命令 143/143 通过。
- `npx vitest run packages/server/src/server/session/checkout/checkout-session.test.ts --bail=1`：35/35 通过。
- `npm run format:files -- ...`、`npm run typecheck`、`npm run lint` 通过。
- exact-SHA `542854ad3` 的 CI run `31480047406` 中，Ubuntu、Windows、macOS 与三平台 distribution jobs 均通过，原 stale assertion 没有再失败。
- exact-SHA `542854ad3` 的完整 workflow 随后被 Playwright shard 1 的两个既有首用例超时拦住；修复归入 Issue 003，并由下一条成功 run 验证。
- exact-SHA `7f4d633cb` 的 push CI run `31482108162` 完整全绿：workflow 墙钟 16:58（10:25:06–10:42:04 UTC），Ubuntu server 3:03，Windows server 7:32；Playwright 四个 job 分别 16:54、13:18、13:25、16:06。原 stale assertion 与两个首用例超时均未复现。

## 验证

- 原失败测试在新两阶段契约下通过，并能在错误恢复为同步等待时失败。
- `packages/server/src/server/session/checkout/checkout-session.test.ts` 与 `packages/server/src/server/session.test.ts` 定向通过。
- 根 typecheck、lint、format 通过。
- 新 exact-SHA CI 的 Ubuntu/Windows server jobs 与完整 workflow 全绿。
- 基线数据可以从记录的 Actions run JSON 重新计算。

## 关闭时

- 回写候选：Epic spec 中将当前失败改为已恢复，并固定最终基线样本。
- 关闭判断：行为测试正确、远端完整 CI 绿色、基线证据可复算。
- 遗留：artifact promotion 与 Playwright 优化分别由 Issue 002、003 承担。
