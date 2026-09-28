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

补充边界（2026-09-28，对照审计 F3）：本复刻的部署形态是**单 daemon per host**；队列领取的 in-process 等价性依赖该前提。多 daemon 并发领取不在边界内，若将来需要，claim 必须改为 DB 级原子（源用 PG SKIP LOCKED 的原因即此）。

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

- **切片 ① ✅ 完成（含全列审计收尾）**：从 577 个迁移筛出复刻集并全部翻译落地（**76 个迁移**）。收尾做了一次**全列审计**（每张复刻表在源 577 迁移中的 ADD COLUMN 并集 vs 复刻终态快照 diff），抓出批次间漏网的 13 个迁移：issue 的 revision 乐观并发列（351，update handler 的核心依赖）、start_date/metadata/triage/duplicate-of、comment 的 revision/recovery/suppressed、inbox actor 对、issue_status icon、191 的 issue.origin_id。**链位纪律**经受两次考验（149/337 两个 issue rebuild 各自只带它时刻的列）。**终态快照测试**钉死每张表最终列集列序，全程抓出 5 个真实 carry 遗漏。PG 存储函数（520/523/530/532 wakeup 捕获、538 settle trigger）定性为行为，随第④片引擎实现。
- 新线落位：`packages/server/src/server/multica/`（migrations runner + rebuild helper + 翻译件 + 5 个测试文件），干净 main 基线（v0.16.2），与练手线零耦合。
- 41 tests / typecheck 0 / lint 0 / format 净。6xx 段已核对：剩余迁移全属砍除圈（channel/plugin/github/telemetry）。

## 进度（2026-09-28，全链贯通）

- **切片 ①②③④⑤⑥ 全部落地**（13 个提交）：
  - **①schema**：120 个迁移三层审计对齐（批次翻译 → ADD COLUMN 并集 → models.go struct 对账），快照测试从活库生成；queue 59/59、agent 27/27 全表平。
  - **②store+RPC**：五域 store（issue 取号/乐观并发、agent system-key、comment 原子 touch、squad RESTRICT、queue 生命周期时间戳）+ 11 对 RPC 全链接线（protocol→权限→handler→dispatch→bootstrap→client），真机 14 项验证。
  - **③④引擎**：WillEnqueueRun 单一谓词（backlog 停车场/squad→leader/pending 去重）+ 评论触发（显式 mention 赢 @all/agent 作者无隐式路由）+ 执行器（agent-manager seam、一 agent 一并发、产物回写评论、workspace 走 schedule 的 provisioning 路径）。
  - **⑤秘书**：内置 Chief of Staff（system key、幂等 seed、mika 工作模型全文），对话面 = 一个专属 issue（办公室频道）—— **零新机制**。
  - **⑥CLI+console**：`byspace multica` 命令组（issue/agent/comment）+ app `/multica` 路由（issue 列表 + 办公室卡片 + 详情评论流 + composer）+ 侧栏入口（9 locale）。
- 160 tests / typecheck 0 / lint 0 / format 净。
- **真机端到端已完成**（2026-09-28，dev daemon + 真 pi + console/CLI 双入口，提交 5188cab91）：
  1. owner 在办公室评论多任务 → 秘书被 assignee 触发唤醒 → 真读 daemon 日志（发现真实的 qoder provider 报错并总结根因）+ 真建 /tmp 文件，汇报写回 issue。
  2. 「正式立项」请求 → 秘书自己开了 Issue #2（带描述），并诚实汇报无法指派的原因（agent ls 空 + CLI 无 agent create）——补上 CLI agent create 后闭环。
  3. @Writer 认领 → mention 触发 → Writer 真核对目录实况后回报（README 已存在且与快照一致，无需重写）。
  4. console 看板/详情真数据渲染 + composer 真发送真触发。
  5. **真机抓到两个真缺陷并修复**：CJK 全角标点后的 @mention 被静默丢弃（`：@Writer` 不触发——中文场景的高频形态，边界从 ASCII 空白改为任何非名字字符，回归测试锁死）；CLI 缺 agent create（秘书自己报告的缺口）。
  6. 数据跨 daemon 重启持久（SQLite）。
  7. 验证过程排除的环境坑：6778 被练手线旧 daemon 占用导致 unknown_schema 误报（进程清理后消失）。

## 进度（2026-09-28，对照审计与身份链）

对照审计（`parity-audit.md`）把复刻与源逐层对了一遍，五处漂移中三处已修：

- **run 身份链**（Issue 001）：executor 写 `queue.session_id`；`comment.create` 带 `senderSessionId`，handler 反解 run 归 agent、无字段归 owner、陌生会话拒绝；CLI 从 `BYSPACE_AGENT_ID` 发送身份。issue 的记录现在读得懂"谁说的"。
- **task_message**（Issue 002）：正式砍除，基线 27 表；理由记在基线砍除清单。
- **claim 前提**（Issue 002）：单 daemon per host 记入 executor 注释与本节边界。

审计余下两处：F4 状态双入口（共用 `#enqueueForIssueWrite`，风险已控，观察）；F5 秘书入口（常驻 workspace，Owner 批准的偏离）。欠账面（wakeup/autopilot/inbox/管理页等）列在审计末节，未动。

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
