---
kind: issue
title: "Pi Provider 基于 model.thinkingLevelMap 精确过滤思考等级"
type: bug
status: closed
created: 2026-09-02
closed: 2026-09-02
---

# Pi Provider 基于 model.thinkingLevelMap 精确过滤思考等级

## 做成以后是什么样

- Pi 的思考等级（Thinking Level）选择器在前端只展示当前模型实际支持的等级档位，而非无差别展示全部 7 个档位（`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`）；
- 不支持思考的模型（`reasoning: false` 或无）不展示思考选择器；
- 遵循 Pi 的官方能力映射规则：
  - `off` 到 `high` 默认可用，除非在 `model.thinkingLevelMap` 中被显式映射为 `null`；
  - `xhigh` 和 `max` 仅在 `model.thinkingLevelMap` 中被显式提供有效映射时才展示；
- 切换模型（`setModel`）后，自动向 Pi 运行时同步该模型收敛后的实际 `state.thinkingLevel`，防止 UI 状态与底层模型脱节。

## 为什么现在做 / 当前坏在哪

- 此前在基线同步时，`mapPiModel` 直接将 `PI_THINKING_OPTIONS` 中的所有 7 档全部映射给了所有 `reasoning: true` 的模型，忽略了 Pi 原生通过 RPC 上报的 `model.thinkingLevelMap`；
- 导致对于只支持部分思考档位或不支持 `xhigh`/`max` 的模型，前端依然显示了无效的思考选项，且 `setModel` 切换模型后未同步模型修正后的思考等级。

## 方案与实现安排（对齐 v0.6.0 归档标准实现）

1. **`rpc-types.ts`**：
   - `PiModel` 接口补齐 `thinkingLevelMap?: Partial<Record<PiThinkingLevel, string | null>>`；
2. **`agent.ts`**：
   - 实现 `getSupportedPiThinkingOptions(model)`：按 `model.thinkingLevelMap` 过滤可用档位；
   - 实现 `getDefaultPiThinkingLevel(options)`：动态计算默认档位（优先 `medium`，若无则选最接近档位）；
   - `mapPiModel` 仅传入当前模型实际支持的 `thinkingOptions`；
   - `setModel` 在模型切换后调用 `getState()` 同步底层收敛的 `state.thinkingLevel` 到会话状态；
3. **`docs/providers.md`**：
   - 记录 Pi 思考等级按模型过滤与映射的架构规则。

## 验证与事实

- `packages/server/src/server/agent/providers/pi/agent.test.ts` 新增对 `thinkingLevelMap` 过滤和 `setModel` 思考等级同步的单测；
- `packages/server/src/server/agent/providers/pi/` 全部 122 个单测全绿；
- 全工程 `typecheck`、`lint`、`format:check` 全绿。
