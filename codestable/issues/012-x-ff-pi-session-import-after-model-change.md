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

修复：`PiRpcAgentClient` 新增 `resolveLaunchModel` 探针——请求带模型时先用 `--no-session` 短命会话调 `get_available_models`（Pi 的权威模型列表），模型不可用时省略 `--model`，让 Pi 自带的会话恢复回退选择可用模型。可用模型、裸模型 ID、探针失败三种路径均有测试锁定；丢弃时同步清掉 session config 的 model，持久化元数据不再回写死模型引用，下次 resume 自愈。

## 改了哪些

- `packages/server/src/server/agent/providers/pi/agent.ts` — `createSession` / `resumeSession` 接入 `resolveLaunchModel`（导入经 `resumeSession` 覆盖）
- `packages/server/src/server/agent/providers/pi/agent.test.ts` — 7 个新用例 + 3 处现有断言适配探针会话带来的额外 launch
- `packages/server/src/server/agent/providers/pi/test-utils/fake-pi.ts` — `queueSessionSetup` 增加 `availableModelsError`，支持脚本化探针失败

## 怎样验证

`agent.test.ts` 84/84 通过（含新用例：不可用丢弃、可用保留、裸 ID 保留、探针失败降级、resume 丢弃、丢弃后元数据清理、import 含斜杠模型 ID）。相邻 `cli-runtime` / `session-session-descriptor` 测试通过。`npm run typecheck` 0 错误、`npm run lint` 0 警告、Biome 格式化完成。修复前用本机真实 pi 二进制复现过根因：`--model zijie/gpt-5.6-sol` 启动即 exit 1，不带 `--model` 恢复同一会话正常。

## 对 codestable/ 的影响

无。spec/ 现有真相未失效；本修复不引入新架构事实。
