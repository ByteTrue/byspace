---
kind: issue
title: run 身份链与评论归属
type: bug
status: closed
created: 2026-09-28
---

# run 身份链与评论归属

> **读者：** 接手的人——为什么 issue 记录里"谁说的"现在读不对，修完后靠什么保证不再读不对。

## 问题

对照审计（`../parity-audit.md` F2）发现：executor 建会话后**从不写 `queue.session_id`**，daemon 因此无法把任意会话反解为 run/agent；连带 `multica.comment.create` 没有作者字段、CLI 不传调用者身份、handler 硬编码 `authorType: owner`。结果是 **agent 在 run 里说的话，在 issue 记录里读作 owner 说的** —— 源里 run 的每句话归它自己（run token 身份），issue 的记录才读得懂"谁说的、谁做的"。这是记录层的正确性缺陷，不是装饰。

## 现状怎么工作

- executor（`packages/server/src/server/multica/executor.ts`）：`createAgent` 建会话 → `runAgent` → 回写评论（作者已是 agent，这条对）；但会话 id 只活在 agent-manager 里，queue 行的 `session_id` 列空着。
- handler（`session/multica/multica-session.ts` `#handleCommentCreate`）：作者恒为 owner。
- CLI（`packages/cli/src/commands/multica.ts` comment send）：不传身份。

## 方案（照 worker 域已验证的模式，不发明）

1. **executor 写 session_id**：建会话成功后 `store.attachTaskSession(task.id, sessionId)`（新 store 方法，UPDATE 单列）。
2. **反解**：`store.getTaskBySession(sessionId)`（新；按 session_id 索引）。
3. **协议加字段**（增量）：`multica.comment.create.request` 加可选 `senderSessionId`。
4. **handler 归属判定**：有 `senderSessionId` → 反解 run → 作者 = 该 run 的 agent（`authorType: agent`）；反解不到 → 拒绝（本域里 agent 只经由 run 说话，秘书的发言留在它的会话里，不进 issue 记录）；无字段 → owner（人类面不变，console 依赖此）。
5. **CLI**：环境里有 `BYSPACE_AGENT_ID` 时必须作为 `senderSessionId` 发送（与 worker 域同纪律：谎报身份被拒，而不是被信）。

## 影响面

- 必须改：executor、store（两方法）、protocol、handler、CLI。
- 需要验：run 评论归 agent（e2e 里 Writer 的回复读作 Writer 而非 you）；人类 console/CLI 评论仍归 owner；假会话 id 被拒。
- 仍未知：无。

## 验证

- store 单测：attach 后可反解；未 attach 反解为空。
- handler 单测：三分支（run 会话→agent / 无字段→owner / 陌生会话→拒绝）。
- e2e verifier 增补：run 回写的评论作者为 agent；CLI 带身份发送归 agent。
- 真机：触发一次 run，读 DB 确认作者列。

## 执行记录

- store：`attachTaskSession` / `getTaskBySession`（不索引 session_id，跟随源——源的索引服务 chat-resume 查找；注释记理由）。
- executor：建会话成功后 stamp；失败路径不 stamp（无会话即无身份）。
- protocol：`comment.create.request` 增量加 `senderSessionId`。
- handler：`#resolveCommentAuthor` 三分支；拒绝消息与"非 run"同义，不泄露其他信息。
- CLI：`BYSPACE_AGENT_ID` 存在即发送；输出行的 author 反映真实作者。
- 验证：store 2 测（stamp 反解、跨状态移动存活）；handler 3 测（run/owner/陌生拒绝）；e2e verifier 22/22（含三条身份检查，同库第二连接 stamp 后立即 completed，executor 不会 drain 成真会话）。
- 偏差：无。
- 真机闭环（2026-09-28）：#3「CLI attribution probe」指派 Writer 并移出 backlog 触发 run；run 在自己的会话里执行 `byspace multica comment send`，DB 读回 `agent|d71ab728|CLI attribution check` —— CLI 评论归 agent 而非 owner。
- 真机抓到的两个旁证：(a) 我的 shell 带 BYSPACE_AGENT_ID 发评论被拒（"is not a multica run"）—— 门禁对真实误用首拦生效；(b) run 里的 `byspace` 走 packages/cli/dist，改源码不重建等于没改（dist 曾停在 9-27 旧构建，Writer 如实报告 multica 子命令不存在）—— 重建后闭环才通。
- 顺带：Writer 拒绝执行评论正文里嵌的副作用命令（识别为注入模式）—— 与上游行为守则一致，未修任何东西，记录为正确行为。

## 关闭回写

- Epic spec 进度表加一行；parity-audit 的 F2 标记已修。
