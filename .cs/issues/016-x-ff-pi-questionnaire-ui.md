---
kind: issue
title: "Fix Pi questionnaire Web interaction"
type: ff
status: closed
created: 2026-08-03
epic: ""
---

# Fix Pi questionnaire Web interaction

## 做了什么

修复 Pi 的 `ask_user_question` 与 BySpace Web 问题表单之间的适配：多题一次展示，自定义答案和多选答案按 RPC fallback 的真实顺序回填；普通 `ask_user` 的 freeform sentinel 也不再作为普通选项处理。

## 改了哪些

- `packages/server/src/server/agent/providers/pi/agent.ts`：在问卷 tool 启动时聚合完整 `questions[]`，桥接后续 `select`/`input` 请求，识别 `Type something.` 与 Pi freeform sentinel。
- `packages/app/src/components/question-form-card.tsx`：提交输入框时优先读取 `onSubmitEditing` 事件中的最新文本，避免刚输入内容后按 Return 被旧 state 覆盖为空。
- `packages/server/src/server/agent/providers/pi/agent.test.ts`：增加多题、自定义答案和 dismiss 回归测试。
- `docs/providers.md`：记录 Pi questionnaire 的 Web/RPC 适配边界。

## 怎么验证的

- `npx vitest run packages/server/src/server/agent/providers/pi/agent.test.ts --bail=1`：57/57 通过。
- `npx vitest run packages/app/src/components/question-form-card-core.test.ts --bail=1`：4/4 通过。
- `npm run build:client`：通过。
- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run format:check`：通过。
- `npm run typecheck --workspace=@bytetrue/byspace-app`：通过。
- App questionnaire tests：5/5 通过（含 Return 最新文本回归）。

## 对 `.cs/` 的影响

无已记录真相受影响；这是 Pi provider 的交互兼容性修复，稳定行为已同步到 `docs/providers.md`。
