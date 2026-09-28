---
kind: issue
title: CLI 面补齐：issue update/status、squad 四动词、timeline/inbox 已齐
type: feature
status: closed
created: 2026-09-29
---

# CLI 面补齐：issue update/status、squad 四动词

> **读者：** 接手的人——agent 靠 CLI 操作域，面不齐等于手不齐。

## 现状盘点（parity-audit E 行）

CLI 已有：issue ls/create、issue wakeup ls/create/disable、comment ls/send、agent ls/create、squad 无、autopilot 七动词、inbox 五动词、office、timeline 无。
agent 的操作域里"改 issue / 建组拉人"是秘书与 worker 的主路径（waker 时代即靠 CLI），面缺=能力缺。

## 补

- `issue update --id --status|--priority|--assignee <id>|--title|--position`（走 multicaIssueUpdate，带 BYSPACE_AGENT_ID 身份）；
- `issue status --id --status`（走 status.update，同上身份）；
- `squad ls` / `squad get --id` / `squad add-member --squad --member [--role]` / `squad remove-member --squad --member`；
- `issue timeline --id`（混流只读，agent 看记录用）。

全部走既有 client 方法；senderSessionId 从 BYSPACE_AGENT_ID 传（与 comment send 同款）。

## 验证

- surface 测试锁动词清单；真机：agent 会话外以 owner 跑 update/status/squad 各一次并读回。

## 执行记录

- CLI 新动词：issue update（status/priority/assignee/clear-assignee/title/position，带 BYSPACE_AGENT_ID 身份）、issue status、issue timeline（混流只读）、squad ls/get/add-member/remove-member。全走既有 client 方法。
- **顺手抓到并修了一处更深的源语义漂移**：源的 CreateSquad 自动把 leader 以 role="leader" 加入 squad_member（squad.go 304-310），我们的 createSquad 不加入 —— 导致 CLI squad get / 详情页 roster 里 leader 不可见（真机 squad get 只见 Worker 一行）。修：store createSquad 同事务加 leader 行；handler create 对请求里重复点名的 leader 去重；create 响应改为回读存储 roster（而非请求 members 列表）。
- 顺带确认源的 role 语义：普通成员 role 默认空串（084 DDL），leader 判定靠与 squad.leader_id 比较而非 role（源 UI 191 行同款）—— 我的测试一度按想象的 "member" 断言，改回源形。
- surface 测试锁新动词清单（issue 的 update/status/timeline、squad 四动词）；真机跑 status/update/timeline/squad ls/get/add/remove 各一次读回一致。
- 质量：147 域测、verifier 43/43、全仓 typecheck 0 / lint 0。

## 关闭回写

- parity-audit E 行 CLI 列更新。
