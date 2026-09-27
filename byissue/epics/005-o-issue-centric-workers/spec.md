---
kind: epic
title: "worker 域 v2：Node 复刻 multica —— 一模一样，只砍多租户"
status: open
created: 2026-09-26
supersedes: byissue/epics/004-x-worker-domain/spec.md 的协作模型
---

# worker 域 v2：Node 复刻 multica

> **读者：** 决定是否开工的人（Owner）与第一个实现者。这是复刻规格，不是设计规格：以 multica（multica-ai/multica，Apache-2.0，commit 04cdd48，源码归档在 ~/workspace/refs/multica）为唯一准绳。

## 结论先行（Owner 决定，2026-09-26）

**一模一样、完完整整抄过来，之后再按情况改。** 不预改 —— 先改后抄会引入架构偏差（此前的"执行留在 daemon 内"、"issue run 上限"两个预改动均已撤回）。

只做两个调整：

1. **砍多租户**（workspace/user/member/auth/cloud/billing/seats 那一圈），其余架构保持不变
2. **Go 后端与整体架构用 Node 复刻**（BySpace 全家都是 TS/Node，无引入 Go 的理由）

**Agent provider 不另起炉灶**：multica 的 agent-runtime 层（它适配 claude/codex/pi/opencode… 各 CLI）在 BySpace 对应**已有的 agent-manager**（RPC/ACP 适配、上层只暴露高级抽象）—— 这一层我们是现成的、不锁 pi。

**Epic 004 定性为练手**：验证了"agent=长期实体"与执行底座；其协作模型（群聊中心）整体让位。从 QoderWake 只保留 8 个角色模板资产（提示词产物，架构无关）。

## multica 架构盘点（一手审计，复刻对象）

```
云 server（= 我们的 daemon 承担）        本地 daemon（= agent-manager 承担）
├─ PostgreSQL + 551 个迁移               ├─ WS/HTTP 连 server，claim 任务
├─ REST API ~129 个 handler 文件          ├─ agent_task_queue 认领执行
├─ issue/comment/squad/autopilot/         ├─ 调本地 CLI（claude/codex/pi/
│  wakeup/inbox/activity 域               │  opencode…）在 issue 的仓库目录
├─ realtime WS（界面推送）                ├─ 进度/评论/产物回写 server
├─ dispatch（run 派发）/scheduler         └─ agents_probe（发现本机装了哪些 CLI）
├─ CLI（server/cmd/multica，cobra）     web（apps/web，Next.js）
└─ cloudruntime/billing/auth（砍）        └─ 看板/issue/agent/squad/chat 视图
```

**关键表（001_init + 后续迁移）**：agent、issue（四类状态生命周期 + 状态目录表）、issue_label/dependency、comment（comment|status_change|progress_update|system 四型）、inbox_item（severity 含 action_required）、agent_task_queue（run 六态）、squad/squad_member、autopilot/autopilot_trigger、issue wakeup（event/at/every/cron 四 kind）、activity_log、issue_subscriber。

**触发规则**：assign→assignee run（squad 则 leader 先动）；@mention 评论→被点名者一次 run；issue wakeup→注册者新 run（**秘书自驱的机制基础**）；autopilot(schedule)→create_issue 或 run_only。run 产物回写：progress_update/评论/状态变化。

**秘书（mika）**：内置 Chief of Staff（MikaSystemKey 形态），INSTRUCTIONS 全文已审：goal not routing decision、路由到最小够用者、聊天轮不产出交付物、建 agent/squad/改配置前预览确认、敏感/破坏性必须确认。

## 复刻边界（唯一两处偏离，均已 Owner 批准）

| 偏离         | 内容                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| 砍多租户     | workspace/user/member/auth/billing/cloud-runtime/seat 全删；所有表去 workspace 维度；单用户即 daemon 属主 |
| Node 复刻 Go | server 域→Node/TS（PG 保留与否见下）；执行层映射到 agent-manager                                          |

**存储定 SQLite（Owner 决定，2026-09-26）**：multica 的 PG 是它容器/服务端部署形态的一部分（依赖 pgcrypto/pgvector/pg_bgm/pg_cron 四扩展，桌面端连远程 server，从不内嵌）；BySpace 装在用户电脑上，形态不同。1:1 复刻的对象是**架构设计**（表/域/触发/队列语义），不是部署形态 —— 砍多租户时已承认形态可异，存储跟着形态走。SQL 翻译对照：`SKIP LOCKED`→事务认领（数据库通用模式）、JSONB→TEXT+读侧 Zod、pgcrypto uuid→crypto 模块、pg_bgm→FTS5、pg_cron→进程内定时器、vector→暂砍（搜索后置）。**迁移仍按 multica 的 551 个一步步翻译**（不一次性凭最终快照重写），保复刻保真度。**不复用 worker-store 既有代码** —— 之前的一律当练手（Owner 指示：不为历史资产适配，避免架构被带偏）。

## 复刻产物落位

- 新包 `packages/multica`（server 复刻：handler 域 → RPC、表 → 迁移、dispatch/scheduler、realtime）？还是并入 `packages/server` 的 worker 域重写？**开工第一片时定**，倾向新目录以保持复刻对照清晰，RPC 走既有 session 通道
- web：multica 的 apps/web 是 Next.js 独立站 —— 我们是单 app（Expo）。复刻**视图与交互**（看板/issue 详情/agent/squad/秘书对话），不引入 Next.js
- CLI：multica CLI 面（issue/agent/squad/autopilot/wakeup/inbox/chat）映射到 `byspace worker2`（名字开工时定）
- 角色资产：8 个模板进 agentconfig，秘书 INSTRUCTIONS 内嵌

## 判据

1. **一段话 → 多 issue**：老板对秘书说 3 件事 → 3 issue 各自指派 → 路由摘要
2. **issue 即完整记录**：squad issue 完成 → 评论含 leader 拆解 + 成员汇报 + 结果
3. **审批清单**：inbox 的 action_required + 对话汇总 → 答复后执行
4. **评论触发**：@agent → 一次 run → 汇报进评论
5. **自主跟进**：issue 状态变化 → 秘书醒 → 不需决策的自己处理（老板未被通知），需决策的写 inbox 汇报
6. **打断安全**：run 中断 → issue/状态/队列不烂 → 再触发可继续
7. **对照通过**：multica 源码里随便点一个行为（如 wakeup 重挂、squad 派发），我们的行为一致

## 进度（2026-09-27）

- **切片 ①（schema 冻结 + 迁移翻译）大部分完成**：从 577 个迁移筛出复刻集，翻译到 509 为止（001→509 中命中复刻表的 24 个迁移全部落地，含 squad、四类状态目录+7 内置种子、autopilot 三表、wakeup 双表、squad 派发记账三列）。523/530/532 是 PG 存储函数（wakeup 事件捕获），定性为行为而非 schema，随第④片触发引擎在 Node 实现。剩余：6xx 段核一遍是否有漏网复刻表（如 issue_number 相关、task_supplement——按砍除清单应排除）。
- 新线落位：`packages/server/src/server/multica/`（migrations runner + 翻译件 + 测试），干净 main 基线（v0.16.2），与练手线零耦合。
- 32 tests / typecheck 0 / lint 0。

## 工程切法

1. **盘点冻结**：从 551 个迁移提取最终 schema 快照（建表全集）→ Node 侧 schema + 迁移框架选型（PG/SQLite 此时定）
2. **server 域骨架**：表迁移跑通 + agent/issue/comment 基础 handler 域 + 认证砍除后的单用户上下文
3. **run 队列 + dispatch**：agent_task_queue + claim/六态 + agent-manager 执行适配 + 产物回写
4. **触发面**：assign/@mention/wakeup(四 kind)/autopilot(schedule)
5. **秘书**：内置 agent + INSTRUCTIONS + inbox 产出 + 自主跟进
6. **squad 派发 + 状态目录**：leader 先动、四类生命周期、内置状态锁定
7. **web 复刻**：看板/issue 详情/agent/squad/秘书对话/notifications
8. **CLI + 退役**：CLI 面映射、Epic 004 群聊链路删除、worker→新域收尾

## 范围外（与 multica 的差异均有 Owner 批准或属后续）

多租户/云/计费/席位（砍）；webhook/API 触发与 GitHub 集成（multica 有，v2 后再说）；移动端；board 高级功能（swimlane/保存视图）；issue run 上限（**搁置**，之后看情况）
