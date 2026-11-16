---
kind: issue
title: "切回窗口后用户消息不再跳到会话流末尾"
type: ff
created: 2026-06-19
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# 切回窗口后用户消息不再跳到会话流末尾

用户在会话页发消息后切到其他软件几分钟再切回，第一条用户消息卡显示到了会话流最末尾（工具行之后）；刷新后恢复正确位置。复现于调试 4K 图片上传限制的会话。

- 根因：`direction: "after"` 的 catch-up 页会在窗口切回后重放与已加载历史重叠的行。重叠行里的 canonical `user_message` 经 `applyStreamEvent` → `placeCanonicalUserMessageAtTail` 处理，该函数对匹配到的已有行是「从原位删除、追加到 tail 末尾」——助手/工具行靠 messageId/callId 原位合并不受影响，只有用户消息被搬走，与截图现象吻合
- 改动：`packages/app/src/types/stream.ts` — `applyCanonicalUserMessageEvent` 新增 `coveredThroughSeq` 输入：重发行的 seqEnd ≤ 当前已加载 cursor 时走原位合并（`upsertUserMessageAcrossStream` insert none），不挪动；未匹配才落回原路径。原 head 插入分支抽为 `upsertCanonicalUserMessageIntoHead`（含 covered 分支圈复杂度控制）
- 改动：`packages/app/src/timeline/session-stream-reducers.ts` — `applyCanonicalForwardUnit`/`applyAcceptedForwardTimelineUnits` 把 `currentEndSeq` 传入，仅对「本行已被覆盖」的 user 行启用原位合并，新增行不受影响
- 改动：`packages/app/src/timeline/session-stream-reducers.test.ts` — 新增复现测试「keeps a re-delivered canonical user row in place when an after page overlaps loaded history」，修前红（user 行被搬到末尾）修后绿
- 验证：该测试文件 122 passed；timeline 全目录 8 文件 186 passed；`npm run typecheck`、`npm run lint`、`npm run format` 全绿。真实场景（切走再切回）未在浏览器手工复验——修复层在 reducer，行为由测试钉住
- 注意：`placeCanonicalUserMessageAtTail` 的「删除 + 追加到末尾」语义仍保留给未覆盖（新增）user 行与无 cursor 的路径；若未来出现「历史重排」类投诉，先查这里
- byissue：`spec/agent-conversation.md` 的「时间线恢复与同步」规则（authoritative 页不当作 live delta 追加）不变；本修复属于 forward 路径的重叠重放防护，spec 无需改
