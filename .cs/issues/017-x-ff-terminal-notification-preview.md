---
kind: issue
title: "Terminal 通知显示最近输出"
type: ff
status: closed
created: 2026-08-04
epic: ".cs/epics/2026/07/21/terminal-experience/spec.md"
---

# Terminal 通知显示最近输出

## 做了什么

Terminal 完成或需要输入的通知不再只显示 `Terminal 3`，而是优先展示终端最近的非空输出内容；没有可捕获内容时仍回退到终端名。

## 改了哪些

- `packages/server/src/server/websocket-server.ts` — 捕获最后 8 行渲染内容，压成单行并限制为 220 字符。
- `packages/server/src/server/websocket-server.terminal-notifications.test.ts` — 增加通知 body 使用最近输出的回归测试，并保留空输出回退覆盖。
- `docs/terminal-activity.md` — 记录通知 body 的取值与限长规则。

## 怎么验证的

- `npx vitest run packages/server/src/server/websocket-server.terminal-notifications.test.ts --bail=1`：10/10 通过。
- `npm run typecheck`、`npm run lint`、`npm run format`、`npm run format:check`、`git diff --check`：通过。

## 对 `.cs/` 的影响

无已记录真相受影响：这是 Terminal 通知展示细节，未改变 Terminal/Agent 的状态或协议边界；稳定规则已同步到 `docs/terminal-activity.md`。
