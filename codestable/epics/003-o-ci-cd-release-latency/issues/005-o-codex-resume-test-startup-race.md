---
kind: issue
title: 移除 Codex resume 测试的 500ms 启动竞态
status: open
type: bug
created: 2026-08-11
updated: 2026-08-11
---

# 移除 Codex resume 测试的 500ms 启动竞态

## 问题

CI `31491465489` 的 Windows server suite 只有一个失败：`resumeSession does not replace a persisted Codex thread when app-server resume fails` 在 500ms 自定义竞速门内没有发出任何 app-server request。该测试通过真实子进程 stdio 驱动 fake app-server；Windows 满载时进程启动可能超过 500ms，但文件内其他同类测试都直接等待协议结果，并由 Vitest 的 30 秒 test timeout 防止永久挂起。

## 契约

- 仍验证 persisted thread 的 `thread/resume` 失败会原样拒绝，不得静默创建 replacement thread。
- 仍精确断言只发生 `thread/loaded/list`、`thread/resume`，不发生 `thread/start`。
- 测试不得把 runner 调度速度当产品行为；真正挂起仍由统一的 Vitest timeout 失败。

## 实现

- 删除该单测私有的 `Promise.race(..., 500ms)` 和重复 timeout 分支，直接断言 `resumeSession()` rejection。
- 不改变 production provider 或全局 test timeout。

## 验证

- [x] 该测试独立启动 10 次，10/10 通过；协议本体每次约 93～130ms。
- [ ] Windows server suite 在新的 exact-SHA CI 中通过。
- [ ] 完整 CI 通过。

## 关闭条件

- 上述远端验证通过并记录 exact SHA/run。
