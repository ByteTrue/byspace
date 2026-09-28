---
kind: issue
title: inbox 读管面收归 owner：agent 的会话不得读/标记/归档老板的队列
type: bug
status: closed
created: 2026-09-29
---

# inbox 读管面收归 owner：agent 的会话不得读/标记/归档老板的队列

> **读者：** 接手的人——为何 agent 不能碰 inbox 的读管面、真机证据。

## 真机证据（019 链的末环断点）

秘书的自主跟进 run 把她自己建的 action_required 项**归档并读掉**（DB read=1 archived=1）—— 老板的待决项从老板队列消失。她按指示"处理其余"时把手伸进了 owner 的队列：读管面（list/mark/archive/mark_all）当前对任何会话开放，无身份判别。

## 源语义

inbox 是**登录成员的队列**：所有读管 handler 走 requireUserID（member 身份）；agent 在源里没有 inbox 面。系统侧写入（run 失败/escalation）是 handler 内部路径，不是任意 agent 的 RPC。

## 收法

- inbox.list / mark / archive / mark_all：senderSessionId 解析为 agent 时拒绝（错误措辞与"无此项"同形？不——这里是越权，用明确的 not-your-surface 错误；读面的存在性不敏感，inbox 是 owner 单队列，无跨人探测面）；
- 无 senderSessionId = owner（console/CLI 老板路径），不变；
- inbox.create 保持 agent 可写（唯一的 agent→owner 队列入口，指示语义需要它）。

## 验证

- 单测：agent 会话 mark/archive/list 被拒、owner 路径不变、create 仍可；
- 真机：以 BYSPACE_AGENT_ID（非 run）调 inbox ls 被拒。

## 执行记录

- 协议四读管 schema 增 senderSessionId；handler 增 #assertOwnerOnlyInbox：解析为 run 即抛 "the owner's inbox is not an agent surface"；create 不动。
- CLI 四命令经 ownerCaller() 传 BYSPACE_AGENT_ID —— 传 id 是让拒绝成为机制而非约定。
- 秘书指示补边界一句（inbox 只有 create 一个动词，归档老板的桌面是老板的动作），且 seed 每启动同步 instructions（updateAgentInstructions）—— 只在建时写的 seed 会把措辞修正永远留在旧行上。
- 测试四例（inbox-owner-only.test.ts）：run 会话 list/mark/archive/mark-all 各拒、owner 与 create 保持开放、归档后行仍在（历史不丢）。
- 真机：修前 run 会话 ls 返回该项（裂缝证据）；修后同一命令报 handler_error，owner ls 正常；console 老板归档闭环（read 保持 0、archived=1）。
- 措辞纠正：首稿把"秘书归档自己建的项"当证据，核对 DB 后确认该项（97ea8faf）是早前验证以 owner 处理的；真证据是修前 run 会话可读 + 源 requireUserID 语义 + 她的 transcript 把 inbox 当工具面。证据措辞按核对后的事实写。

## 关闭回写

- 019 链的末环修复记录；parity-audit D 行身份面补一行。
