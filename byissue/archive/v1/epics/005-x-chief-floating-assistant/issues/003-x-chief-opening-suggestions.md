---
kind: issue
title: "Chief 开场三条建议与空状态"
type: feature
created: 2026-10-10
---

# Chief 开场三条建议与空状态

## 目标与范围

Chief 会话空状态呈现三条写死的建议按钮，点击即以用户消息发送；内容回答由 Chief 提示词兜底。

包含：三条建议的文案与发送接线、空状态布局（遵循 docs/design.md）。

不包含：自定义开场建议配置、LLM 生成的建议 chips（明确不做）、服务端预写开场消息（Multica 模式，留作候选，需另行评估）。

## 方案要点

- 建议条数是用户对 Chief 能力边界的第一认知，三条写死；文案实现时按 Chief 实际能力（快速问答、观察 workspace、驱动 CLI）定稿。
- 依赖 issue 002 的浮窗与会话页入口，两处空状态表现一致。

## 验证

- 新会话空状态出现三条建议；点击发送后 Chief 正常作答。

## 验证限制

同 issue 002——BSK/browser 环境下 WebSocket 不稳定导致连接验证无法完成。开场建议的 UI 在空状态正确渲染（SuggestionChip 组件 + AgentStreamView props），逻辑已在单元测试和类型层面验证。

## 执行记录

- `AgentStreamView` 加 `emptySuggestions` + `onEmptySuggestionSelect` 可选 props。
- `renderListEmptyComponent` 在空状态文本下方渲染 `SuggestionChip` 按钮组。
- `AgentStreamSection` 检测 `byspace.agent-role === "chief"`，为 Chief 组装三条建议（i18n），点击经 `client.sendMessage` 发送。
- 建议内容走 i18n，全语言。
- typecheck 0 error，lint 0 error。
