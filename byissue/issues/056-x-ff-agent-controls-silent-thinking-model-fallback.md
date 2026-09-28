---
type: ff
status: closed
title: 切回会话时模型/思考档位被静默回退渲染
created: 2026-09-28
closed: 2026-09-28
---

# 切回会话时模型/思考档位被静默回退渲染

## 做了什么

用户报告：切回正在运行的会话（PWA，localhost:6777，两台 host 共用同一个 app），composer 工具栏的模型/思考显示变成「qwen3.8-max + Low」，看起来像模型被改了。全链路排查（daemon 内存态/持久化 JSON/WS 投影/replica-cache/timeline 缓存/两台 host 的 provider-snapshot 缓存、daemon.log 全天零条 `set_agent_model` 请求）确认：**会话本体从未被改，是纯显示层回退**。

根因在 `resolveAgentModelSelection` 及 thinking trigger 的两条静默回退链：

1. **思考档位回退 `[0]`**：会话配置的 thinking（如 `max`）不在当前模型的 `thinkingOptions`（如 `[low, medium, xhigh]`）时，`resolveEffectiveThinking` 静默取 `thinkingOptions[0]` → 显示「Low」；`ControlledAgentControls` 的 `displayThinking`（`findOptionLabel` 的 fallback 也是 `options[0].label`）同样把未匹配 id 渲染成第一档。
2. **模型回退 fallback 条目**：会话模型不在已加载的 catalog 行里（另一台 host daemon 重启后 snapshot 处于 loading/stale 窗口，catalog 尚未含该模型）时，`pickSelectedModel` 静默采用 `isDefault ?? [0]` 条目 → 显示成列表默认模型。

触发场景：一台 host 的 daemon 重启或其 provider snapshot 尚在重拉时，用户切回那台 host 的会话——catalog 与会话配置暂时错位，两条回退链叠加渲染出「模型+思考都被改掉」的假象，且会诱导用户手动改回（那才会真的改模型）。

修复（显示层防御，不改任何写入路径）：

- `resolveThinkingSelection`：显式档位存在但不在 options 里时保留原始 id 作为 `selectedThinkingId`、`effectiveThinking` 为 null，由 `resolveThinkingDisplay` 用 `formatThinkingOptionLabel({id})` 渲染（显示「Max」而非「Low」）；仅在**无**显式档位时才回退 `[0]`。
- `pickSelectedModel`：有确定 `preferredModelId` 但 catalog 未列出时返回 null（`resolveModelDisplay` 已有的 raw-id 路径接管显示），不再采纳 fallback 条目。
- `resolveThinkingTriggerLabel`（新增，从 index.tsx 抽到 utils 导出）：thinking trigger 对未匹配/未加载 id 一律显示格式化后的原始档位，而不是 `options[0]` 或 unknown。

## 改了哪些

- `packages/app/src/composer/agent-controls/utils.ts` — 新增 `resolveThinkingSelection`、`resolveThinkingTriggerLabel`；`pickSelectedModel` 去掉 `?? fallbackModel`；`resolveAgentModelSelection` 接入
- `packages/app/src/composer/agent-controls/index.tsx` — `displayThinking` 改用 `resolveThinkingTriggerLabel`（经 utils 导入）
- `packages/app/src/composer/agent-controls/utils.test.ts` — 6 个新用例（模型缺席保留 raw id、max→Max 不再 Low、无显式档位才回退、trigger 三态）

## 怎样验证

`npx vitest run packages/app/src/composer/agent-controls/utils.test.ts --bail=1` 18/18 通过；`npm run typecheck` 0 错误、`npm run lint` 0 警告、`npm run format` 完成。`control.test.tsx` 在干净 main 上同样失败（`window.matchMedia` 环境问题，预存，与本次无关）。修复前用真实 daemon payload + catalog 数据推演复现过显示配方（qwen3.8-max + 任意非档位 thinking → 「Qwen3.8 Max / Low」）。

## 对 byissue/ 的影响

无。纯显示层行为修正，spec/ 现有真相未失效。
