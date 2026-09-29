---
kind: issue
title: agent 执行配置四列接活（model/custom_env/custom_args/mcp_config）
type: feature
status: closed
created: 2026-09-29
---

# agent 执行配置四列接活（model/custom_env/custom_args/mcp_config）

> **读者：** 接手的人——schema 四列从 040-088 演化链一路搬来，但 executor `config: {}`，全部只在列表显示，从未到达执行会话。

## 源形

daemon 侧把 agent 的 Model 层进执行选择（qualifyTaskModel）、CustomEnv 层进子进程 env（layerCustomEnvAndHermesHome，保 state-home 隔离）、CustomArgs/McpConfig 进 runtime 组装。写面 = agent 详情页的 env/model/args 编辑与校验。

## 收法（对齐我们的形）

- executor 两处 createAgent：`config: { ...(agent.model ? { model: agent.model } : {}) }`；`env: agent.customEnv`（JSON 列，null → 不传）。
- custom_args / mcp_config：**defer 记理由**——pi 的 ACP 启动面无 args 注入口（我们的 runtime 不是 CLI spawn），MCP overlay 属 runtime 面欠账（源也是 per-task overlay 层）。
- 写面：agent.update 扩 model/customEnv（omt-keeps）；agent 页加 Model 与 Env 两行内联编辑（复用 034 的 InlineEditField；env 用 textarea JSON，写侧 Zod 校验 Record<string,string>，坏 JSON 拒）。

## 验证

- 单测：executor 传面（fake createAgent 收到 model/env）；
- 真机：给 agent 设 model + env → 跑 run → daemon log / agent snapshot 的 env 见值。

## 执行记录

- executor 两处 createAgent：`config: { model }`（有则传）+ `env: agentEnvForRun(customEnv)`；agentEnvForRun 在边界解析 JSON 列（坏 JSON/非对象/非字符串值都抛清晰错误——失败响亮而非静默跑空 env），空/null → undefined。
- updateAgent 扩 model/customEnv（omt-keeps；env 存 JSON 文本、空对象归一 NULL）；agent.update RPC 与 client 同步；detail schema 补 customEnv。
- agent 页：Model 内联编辑 + Env JSON textarea（坏 JSON 不提交）。
- custom_args / mcp_config 照 defer（理由在案：pi ACP 启动面无 args 注入口；MCP overlay 属 runtime 面）。
- 测试：传面 2 例（fake createAgent 断言 config+env 到达；边界函数 7 断言含坏 JSON 拒、空归 undefined）。
- 真机：Audit Bot 设 model=qwen3-coder + env {MULTICA_ENV_PROBE:"carried"} → 派 run "报告 MULTICA_ENV_PROBE 的值" → run 回报 `carried`——env 经 custom_env 列注入 pi 会话，全链成立。
