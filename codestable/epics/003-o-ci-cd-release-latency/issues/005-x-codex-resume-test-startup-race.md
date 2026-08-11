---
kind: issue
title: 移除 Codex resume 测试的 500ms 启动竞态
status: closed
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
- [x] exact-SHA `6044abc83` 的 Windows server suite 在 run `31495966222` 中 6:32 通过；原失败场景没有 500ms runner 调度竞态。
- [x] 同一 run 27/27 jobs 全绿，workflow 墙钟 8:56。
- [x] 独立 review 确认 persisted thread 的 rejection 与精确 request 序列断言均保留，未发现 correctness blocker。

## 关闭条件

- 上述远端验证通过并记录 exact SHA/run。
