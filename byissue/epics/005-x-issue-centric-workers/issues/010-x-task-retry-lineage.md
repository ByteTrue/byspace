---
kind: issue
title: 失败自动重试（attempt 谱系）；task_supplement 裁决 defer
type: feature
status: closed
created: 2026-09-29
---

# 失败自动重试（attempt 谱系）；task_supplement 裁决 defer

> **读者：** 接手的人——哪些失败重试、谱系怎么连、supplement 为什么不做。

## 源语义（task.go 4829-5050 / 5199-5230）

- 只有**枚举内的瞬时理由**重试：runtime_offline / runtime_recovery / timeout / provider_network / skill_bundle_unavailable；其余失败（含人工取消、权限等待）不重试。
- 重试=**子 task**：attempt+1、retry_of_task_id 指父、max_attempts 顶（网络类可抬高）；backoff 只对 runtime_offline（延后等健康心跳）与 provider_network 末次（~5s），其余即时。
- 父落 failed，子 queued；triage 中的 issue 不重试。

## 我们的翻译（进程内执行形态）

失败分类没有源的结构化理由码，按**失败发生的位置**分，这在我们的形态里是诚实且稳定的判据：

- **可重试 = 启动期基础设施失败**：createAgent 抛错或 initialPromptError —— 即"运行环境没起来"类（对应源 runtime_recovery/offline 的位置语义）。
- **不重试**：权限等待（人工闸门，重试是骚扰）、取消（人的决定）、run 中途错误（无结构化理由码时重试中途失败=拿昂贵循环赌运气；源也只在有理由码时重试中途失败）。
- 谱系：子 task attempt=父+1、retry_of_task_id=父 id；顶 = max_attempts（默认 2）；delay 0（即时入队，kick drain）。
- 不引入 fire_at 延后语义（无 runtime 心跳面，延后无对象）。

## task_supplement 裁决：defer，理由

supplement = 人写的补充投递给**在飞的那一次 run**。我们的执行形态是一次 run 一个 turn 的进程内调用，运行中的会话没有插话面；忠实实现要先改执行面（可中断/可注入的 run），那是另一个 epic 的形状。硬做一个"排队等 run 结束再发"的假 supplement 会骗人（它不是 steer）。记 defer，连带能力表 task_supplement_capability 一起。

## 范围

- 包含：store createRetryTask、executor 启动期失败→重试谱系、attempt/max 顶、测试（重试一次、到顶不再、权限与取消不重试）。
- 不包含：fire_at 延后、网络类理由抬高顶、supplement。

## 验证

- 单测四例；真机：制造一次启动期失败不易，改以单测+verifier 断言谱系字段。

## 执行记录

- store：createRetryTask（attempt+1、retry_of_task_id、max_attempts 随行；到顶与否由调用方判，写面只写）。
- executor：createAgent/initialPromptError 包内层 try 标 startupFailed —— 只有**启动期**失败进谱系；catch 里 startupFailed 才 spawnRetryChild（attempt<max 才生）；onEnqueued 回调让子立即被 drain（subsystem 把 kickDrain 传进 executor，kick 块上移到 executor 之前，闭包调用时才求值，TDZ 安全）。
- 不重试面复核：permission 等待与 cancelled 走 return 不走 throw，天然不进谱系；中途 run 错误无结构化理由码，按 issue 的裁决不赌。
- 测试四例（executor-retry.test.ts）：启动失败生一子（attempt+1/父指针/子 queued/父 failed）；默认顶 2 下两轮 drain 后恰两行全 failed（无第三代）；permission 门不重试（恰一行）；成功无谱系。
- task_supplement 裁决 defer 已记于本 issue 范围段（执行形态一次 run 一 turn，无插话面；假排队 supplement 会骗人）。
- 质量：域测 16 文件 127 测；verifier 43/43；typecheck 0 / lint 0。

## 关闭回写

- Epic spec 进度；parity-audit 欠账面"重试行为"行标记完成、supplement 行记 defer 理由。
