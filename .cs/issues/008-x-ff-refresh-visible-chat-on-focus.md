---
kind: issue
title: "窗口恢复焦点后刷新可见聊天"
type: bug
status: closed
created: 2026-07-29
epic: ""
---

# 窗口恢复焦点后刷新可见聊天

## 目标

浏览器窗口从后台或失焦状态恢复，或用户重新打开 grace 内保留的 Workspace 聊天后，即使 timeline subscription 仍然存在，也要立即用权威 timeline catch-up 修复后台冻结或传输漏送的消息；不能被旧在途请求额外拖延数秒。

## 根因

可见 timeline 在 grace 内保留 subscription；恢复前台或重显 Workspace 时 membership 未变化，因此旧实现不会重新 fetch，后台冻结或短暂漏送后缓存会停在旧内容。第一阶段的 trailing refresh 仍会等待相同形状的旧在途请求，带来数秒延迟；而直接并发后，仅让 `ViewedTimelineSync` 忽略旧 generation 也不够，因为全局 timeline response listener 会先写 store，乱序旧响应仍可能覆盖新结果。

## 修复

- `ViewedTimelineSync.setActive(true)`、桌面窗口 `focus` 与重新显示 grace 内保留的 agent 都提交新的权威 forward intent，不改变现有 subscription membership。
- 每个 Host 的 `AgentTimelineSyncOwner` 统一拥有初始化、恢复、gap、显式刷新、rewind/reload 与 older 分页；可见恢复会立即创建请求，不等待相同形状的旧在途请求。
- 响应不再按“最后发出的 request 胜出”整体丢弃。owner 先 flush 同 agent 的 live queue，再按 connection generation、daemon epoch、cursor 和 sequence ranges 交给 canonical reducer；旧响应中的有效缺失 row 可以补入，但不能完成新的控制 intent 或回退 cursor/pagination。
- 浏览器回归测试阻断 `agent_stream`、写入真实 timeline，再验证 window focus 或重新打开 retained chat 后 1 秒内发出 fetch、2 秒内显示遗漏消息。

## 验证

- Timeline/Directory/Host/初始化相关目标单测：8 files / 210 tests 通过。
- `npm run test:e2e --workspace=@bytetrue/byspace-app -- e2e/viewed-agent-timelines.spec.ts --project='Desktop Chrome' --workers=1`：6/6 通过；focus 与 retained-chat 用例均要求恢复动作后 1 秒内发起 fetch、2 秒内显示遗漏消息，focus 用例还释放反序旧响应并验证消息不回退。
- `npm run typecheck`：通过。
- `npm run lint`：0 warnings / 0 errors。
- `npm run format:check` 与 `git diff --check`：通过。
- `npm run build --workspace=@bytetrue/byspace-app`：Web export 成功。
- 多轮独立 reviewer 的 blocker/high 均已修复，最终未发现新的 blocker/high/medium。

## 关闭结论

恢复前台、窗口焦点或 grace 内保留的 Workspace 聊天时，现在都会立即提交权威 forward intent，不再依赖“subscription 仍存在”推断消息完整，也不再等待旧 fetch 结束。Timeline 的请求和响应仲裁已进一步由 Issue 009 收敛到 Host 级单一 owner；旧响应按 canonical 语义合并，而不是按请求年龄粗暴丢弃。路径与 agent provider 无关，同时覆盖 Direct 与 Relay，因此不做 Pi 专用分支。
