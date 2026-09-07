---
type: ff
status: closed
title: Pi 会话导入在模型配置变更后失败
created: 2026-09-07
closed: 2026-09-07
---

# Pi 会话导入在模型配置变更后失败

## 做了什么

Pi 会话文件或 agent 持久化元数据中记录的模型（如 `zijie/gpt-5.6-sol`），在用户修改 `~/.pi/agent/models.json`（删除/改名 provider）后不再存在。BySpace 启动 Pi RPC 进程时把该模型作为 `--model` 传入，Pi 对解析不了的 `--model` 在会话恢复逻辑运行之前即 `exit 1`，导致导入会话和加载历史会话直接报错——即使会话实际已在本地 CLI 换过可用模型。

修复：`PiRpcAgentClient` 新增 `resolveLaunchModel` 探针——请求带模型时先用 `--no-session` 短命会话调 `get_available_models`（Pi 的权威模型列表），校验后决定是否传 `--model`。校验语义与 Pi 对 `--model` 的实际失败条件对齐（只硬失败于 provider 不存在；已知 provider 下的未知 model id 走 Pi 自定义模型回退）：provider 不可用时省略 `--model`，让 Pi 自带的会话恢复回退选择可用模型；探针自身失败时保留原模型（fail-open），让真实启动暴露明确错误。探针结果在 client 内做 30s TTL 缓存；internal 会话（模型来自当前 provider 快照）跳过探针。丢弃时同步清掉 session config 的 model，持久化元数据不再回写死模型引用，下次 resume 自愈。

经 subagent review（PR #28）后补齐四项：探针失败 fail-open、只校验 provider、internal 跳过 + TTL 缓存、测试命名修正。

## 改了哪些

- `packages/server/src/server/agent/providers/pi/agent.ts` — `createSession` / `resumeSession` 接入 `resolveLaunchModel`（导入经 `resumeSession` 覆盖）
- `packages/server/src/server/agent/providers/pi/agent.test.ts` — 7 个新用例 + 3 处现有断言适配探针会话带来的额外 launch
- `packages/server/src/server/agent/providers/pi/test-utils/fake-pi.ts` — `queueSessionSetup` 增加 `availableModelsError`，支持脚本化探针失败

## 怎样验证

`agent.test.ts` 86/86 通过（新用例：provider 不可用丢弃、provider 在但 id 未知保留、裸 ID 不探针保留、探针失败保留、缓存复用、internal 跳过、resume 丢弃、丢弃后元数据清理、import 含斜杠模型 ID）。相邻 `cli-runtime` / `session-descriptor` 测试通过。`npm run typecheck` 0 错误、`npm run lint` 0 警告、Biome 格式化完成。修复前用本机真实 pi 二进制复现过根因：`--model zijie/gpt-5.6-sol` 启动即 exit 1，不带 `--model` 恢复同一会话正常。

## 对 codestable/ 的影响

无。spec/ 现有真相未失效；本修复不引入新架构事实。
