# worker 域与 QoderWake 参考 talk

讨论日期：2026-09-24。参与：Owner、AI。

本机环境：QoderWake 1.1.2 已安装并运行（daemon `127.0.0.1:19820`，App `/Applications/QoderWake.app`，数据 `~/.qoderwake/`）。

---

## 1. 开场：发现一个方向很像的产品，先分析它

Owner 起头：发现产品 QoderWake，和 BySpace 想要的发展方向"很像"，想直接参考其优秀设计。它本机已安装启动，同样是 daemon + web 架构。要求先分析这个应用。

AI 做了本机测绘。事实：

- daemon 是单文件二进制 `qoderwake __daemon --host 127.0.0.1 --port 19820`（约 180MB），Express 服务内嵌一份 Vite 构建的 React 控制台 + `/api/*` REST。
- 数据全在本地 SQLite：`~/.qoderwake/data/store/qoderwake.sqlite`，**约 150 张表**。
- agent 运行时是它自己的 `qodercli-wake`（bundled 1.1.58），与 BySpace 的 provider 适配处于同一位置。
- 不是纯本地：登录后走云端 `openapi.qoder.sh`；远程会话查询带 `origins=android,cli,ios,local_web,web`，即它也有云账号与移动端。
- 信息架构：侧栏分两组——`Work Management`（Dashboard / @Waker / Autonomous Work）与 `Wakers & Capabilities`（Waker Management / Capabilities & Resources）；侧栏下半是主体列表（`Waker (n)` / `Group (n)`）+ `New Waker` + 搜索。
- 核心概念：Waker（数字员工，有名字、头像、工作区、Skills、MCP、记忆、权限、项目、自动化）、Session（它的一次运行实例）、Trigger→Automation（定时 / 事件 / API）、WakerFlow（多 Waker 可编排流程）、Group（多员工协作容器，带 SOP、Goal、待办、消息、runs）、Memory（工作区里的 `IDENTITY/BIBLE/PERSONA/MEMORY/USER/TOOLS.md`，git 快照可回滚）。
- 外部资料补足定位：官方定位是"全天在线的数字员工"，2026-09-03 发布 1.0，1.1.1 于 2026-09-22，本机装的 1.1.2 更新。它把战场点名在 Claude Tag 与 Grok Bot 那一格——团队协作现场。

## 2. 第一次判断被 Owner 纠正：不是"只借交互"，是整体照搬

AI 的第一版结论是：两者只重合骨架不重合产品，建议**不跨簇**，只借它的交互与信息架构，同时预留两条思想（Harness Engineering 的"Session 是唯一真相 + 独立 Verifier"、Anti-Rot 的能力治理）。

**Owner 纠正，五点：**

1. 在当前 BySpace 左上角加一个按钮，跳转到一个**全新路由**，当独立的新功能页做——能力可以复用，**界面上不耦合旧界面**。
2. **直接抄**。它当前这个设计不需要再画蛇添足，最好就直接抄过来。
3. **要的就是"数字员工"这套业务角色叙事**，和原来的不冲突，因为是两个路由、两个独立功能页。
4. 阿里云账号那块依赖确实不要，但**它现有的资产直接搬过来用**——角色模板、内置技能等。
5. 模型底层用 **pi**，不做多 provider 适配。

**已确认：** 这不是"吸收交互"，是在 BySpace 里长出第二个产品面；借鉴颗粒度是最细的，整体借鉴。

随后 Owner 在三项收束上给了明确答案：Q1 颗粒度最细、全部借鉴；Q2 写进 vision 且是**完全参考**而非粗略参考；Q3 先开始 talk。

## 3. 资产清点：角色模板能拿到，权限层是开源

AI 先修正了自己上一条的一个错误说法（曾说"角色模板搬不走"）：**云端目录列表确实不在本地**（`waker template list` 的 11 条元数据是从阿里云拉的，本机 grep 为零），但**实例化的模板全量落盘**。Owner 建了一个 Frontend Developer 之后，AI 在其工作区读到完整资产：

```
~/.qoderwake/data/workers/<id>/
├── .qoder/IDENTITY.md              职责、核心定位、Done Criteria、能力边界、降级规则
├── .qoder/PERSONA.md               性格、沟通策略、反模式清单
├── .qoder/BIBLE.md                 工作手册：任务分类、Skill 调度表、Autonomous 执行政策、
│                                   Git worktree 强制门、共享步骤与 Gate、各工作流、交付契约、护栏
├── .qoder/CORE_CAPABILITIES.md     能力清单（JSON）
├── .qoder/DELIVERY_COMMITMENTS.md  任务类型→标准工作流（JSON）
├── .qoder/WORK_STYLES.md           风格标签（JSON）
└── .qoder-plugin/skill-versions/<skill-id>/git/   每个技能是完整 git 仓库，带 SKILL.md
```

**Owner 决定全部收割。已完成：11 个模板、61 个技能，存在 `/Users/zijie/workspace/refs/qoderwake-worker-assets/`**（含来源、许可状态与校验和的 README；尚未进仓库）。

| 模板                          | BIBLE  | 技能数                |
| ----------------------------- | ------ | --------------------- |
| Backend Engineer              | 593 行 | 8                     |
| QA Engineer                   | 357 行 | 6                     |
| Content Operations Specialist | 328 行 | 10                    |
| Frontend Developer            | 283 行 | 8                     |
| Product Manager               | 218 行 | 6                     |
| Data Analyst                  | 79 行  | 5（+去重后 8 个目录） |
| DevOps Engineer               | 48 行  | 7                     |
| UI Designer                   | 42 行  | 2                     |
| Project Administrator         | 37 行  | 6                     |
| Q&A Specialist                | 16 行  | —                     |
| 个人分身                      | 0 行   | —                     |

Project Administrator 的 6 个技能正对应 Owner 要的流程：`project-planning`、`task-breakdown`、`cross-functional-coordination`、`status-risk-reporting`、`meeting-decision-management`、`release-handoff-management`。它的 IDENTITY 第一句是 "keeping work scoped, sequenced, owned, and visible across product, engineering, QA, design, operations"。

**许可：** 模板内容随闭源 App 分发，**QoderWake 本身没有开源许可**——用法是参考与改写，不是直接搬运；内嵌的 browser-harness 为第三方 MIT（Copyright Browser Use），引入时保留声明。完整说明见资产目录的 README。BIBLE 里还有一条与 BySpace 现有能力直接吻合的设计——**Coding Entry Gate (Git Worktree Required)**：禁止在主 checkout 上写代码，必须先开 worktree。

## 4. 权限与审批：能拿到，而且它的上游是开源项目

Owner 问：审批这块的设计能不能拿到，代码或者逻辑。

**能，而且比预期多。** 关键发现是规则文件自带 `source` 字段：

```
"source": "QwenPaw/src/qwenpaw/security/tool_guard/rules/dangerous_shell_commands.yaml"
```

QoderWake 的整套权限层是开源项目 **QwenPaw（`agentscope-ai/QwenPaw`）** 的下游消费者。上游是 **Apache-2.0，35,250 stars，3,127 forks**，2026-02 创建，仍在活跃提交，topic 含 `harness-engineering`、`agent-harness`。

上游 `src/qwenpaw/security/tool_guard/` 全量可读：

| 文件                                  | 大小   | 内容                                                  |
| ------------------------------------- | ------ | ----------------------------------------------------- |
| `rules/dangerous_shell_commands.yaml` | 14.9KB | 29 条规则，带真实 `patterns` 正则与 `excludePatterns` |
| `engine.py`                           | 9.8KB  | 引擎，编排所有 guardian 并聚合 findings               |
| `guardians/rule_guardian.py`          | 33.4KB | 规则匹配                                              |
| `guardians/shell_evasion_guardian.py` | 20.3KB | 7 条反规避检查                                        |
| `guardians/file_guardian.py`          | 17.8KB | 敏感文件                                              |
| `safety_checks.py`                    | 39.3KB | —                                                     |
| `approval.py`                         | 3.3KB  | 审批决策模型                                          |

它还有 QoderWake 未内置的 `security/skill_scanner/`：8 类签名规则（command_injection / data_exfiltration / hardcoded_secrets / obfuscation / prompt_injection / social_engineering / supply_chain / unauthorized_tool_use），用于安装技能前扫描恶意内容。UI 也在开源里（`console/src/pages/Settings/Security/`，含 ToolGuardTab / FileGuardSection / ShellEvasionSection / SkillScannerSection / RuleTable / RuleModal）。

QoderWake 自己的实现（`package/src/daemon/modules/permission/`）在二进制里是可读 TS，包含 `RuleBasedToolGuardian`、`ShellEvasionGuardian`、`FilePathToolGuardian`、`ConnectorToolGuardian` 和 `PendingApprovalRegistry`。后者值得记的设计点：

- 用 `sha1(agentId|toolName|findings|salt)` 算 fingerprint 去重；同一动作的重复请求会让旧请求 `denied_approval_superseded`。
- 超时自动 `denied_approval_timeout`；已决记录保留 5 分钟，30 秒 GC 一次。
- 记录含 `toolInputPreview`、`findingsSummary`、`expiresAt`。

上游 `approval.py` 还提供一个没想到的维度：**`ApprovalScope.EXACT` vs `SIMILAR`**——批准之后记住的是"这一次的具体目标"还是"这个泛化模式"，是审批记忆的粒度问题。

规则规模：29 条，分 8 类——command_injection 3、resource_abuse 4、code_execution 8、network_abuse 2、sensitive_file_access 3、privilege_escalation 2、shell_evasion 7。severity 分 CRITICAL / HIGH / MEDIUM / LOW / INFO。

**已确认：** 权限层从上游 Apache-2.0 源码移植，不从二进制反推——上游干净、有许可、有社区维护，还多一个 skill 扫描器。

### 取用边界：能读代码到什么程度

Owner 问能不能直接对着它的代码抄。事实与边界：

**能读，而且不少。** 它用 Bun 打包，保留了 **1693 条源码路径注释**（`// src/daemon/modules/permission/engine.ts` 之类）、类名、字符串、SQL 乃至部分类型标注（827 处）。所以它的控制流与数据结构能读懂——本 talk 里 `PendingApprovalRegistry` 那些细节就是这么读出来的。

**但它是 minified 的**：18661 处变量被重命名为 `data1` / `record28` / `services2`。是能读懂的机器码，不是可编译的源码；照抄等于手工反编译，容易抄错边界条件。

**且它本身没有开源许可**：npm 上 `@qoder-ai/qodercli` 的 license 字段为空，`@qoder-ai/qoder-agent-sdk` 写的是 `SEE LICENSE IN LICENSE`。它不是开源项目，反编译其代码来用不是"参考开源"那条路。

**因此分层取用：**

| 要什么             | 从哪取                               | 依据                                                                                                                                 |
| ------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 权限与控制流逻辑   | QwenPaw（Apache-2.0，真源码）        | 可合法移植，需保留 NOTICE                                                                                                            |
| 角色模板与技能     | 已收割的 11 模板 / 61 技能           | `/Users/zijie/workspace/refs/qoderwake-worker-assets/`，改造成自己的模板；注意内嵌的 browser-harness 是 MIT（Copyright Browser Use） |
| 产品行为与信息架构 | 运行实例观察（界面 / 流程 / schema） | 研究一个产品的正常范围                                                                                                               |
| minified 机器码    | **不移植**                           | 无许可、易抄错                                                                                                                       |

**已确认：** 参照上表分层，不做整段机器码移植。

### 开源可捞盘点

AI 扫了二进制里的上游引用、`resources/` 的 `source` 字段、npm `@qoder-ai` scope 与 `QoderAI` 组织。**整个 `resources/` 里 `source` 字段只有一条**指向 QwenPaw；其余全是第三方 npm 库（pino / isomorphic-git / slack-sdk 等），不是它的上游。

| 来源                               | 许可       | 内容                                                                                                | 价值             |
| ---------------------------------- | ---------- | --------------------------------------------------------------------------------------------------- | ---------------- |
| QwenPaw（`agentscope-ai`）         | Apache-2.0 | tool_guard 全套 + skill_scanner（8 类签名）+ 安全设置 UI                                            | **高**，直接移植 |
| 角色模板（随 App 分发）            | 见上       | 11 模板 + 61 技能                                                                                   | **高**，已到手   |
| better-harness（`QoderAI`，2.3K★） | MIT        | Harness Engineering 平台，`docs/docs/concepts/` 有 agent-work-loop、findings-and-evidence、glossary | 中，方法论可读   |

**与 Owner 指示的关系：** better-harness 属于 `@qoder-ai/harness` 那一族（`harness-studio` → `harness-ui` + `harness`），即 Owner 明确要排除的 agent SDK 方向，**不进实现**。`@qoder-ai/qmind-cli` 属知识库，已明确放最后。

## 5. team 和 group：不是两个概念，是同一个东西的旧名与新名

Owner 问：team 和 group 有啥差别，我们最终都是在项目上工作吧。并判断"这个应该算一起的吧，直接抄风险比较低，能少改动尽量少改动"。

AI 第一次从 schema 读出的是分层，并推断成"两个阶段"。**这个推断是错的**，Owner 的要求促使 AI 继续查，随后在二进制里找到直接证据——它做过一次列重命名：

```sql
RENAME COLUMN team_idempotency_key TO group_idempotency_key
RENAME COLUMN team_payload_json    TO group_payload_json
```

配合兼容函数 `normalizeLegacyTeamGroupRecord` / `normalizeLegacyTeamGroupSessionRecord` / `normalizeLegacyTeamGroupActivityRecord` 与字段 `legacyTeamId` / `legacyTeams`，结论明确：**以前叫 team，后来改名 group，team 是遗留别名**。表名里的 team 与 group 指同一个对象（`team_groups_v3`、`team_group_members_v3`、`team_group_messages_v3`…），`_v3` 是版本号不是层级。这与它把 Waker 前身叫 worker、CLI 至今保留 `--worker-id` 别名是同一模式。

真实的层级是：

```text
conversations                通用会话层（闲聊 / 临时讨论，无项目）
      ↓
group（旧称 team）           绑 project_id；含 team_type、leader_member_id、current_mission_id
      ↓
group 内一次任务             绑 project_id 与 workspace_root，含 mission_id、task_name
      ↓
missions → plan_proposals → plan_tasks → role_runs → team_mailbox_items
           （使命）    （计划）      （任务）    （按 role 执行）  （异步信箱）
```

`project_id NOT NULL` 是**所有** group 共有的字段，不是 team 特有；不绑项目的只有 `conversations` 那层。

**已确认：直接抄一个绑项目的 group，不抄两个概念。** Owner 的直觉成立，而且理由比 AI 最初说的更强——它本来就是一个概念。

**另一处纠正：** `workspace_type`（`file` / `github` / `remote`）是**触发器与自动化**的字段，管任务从哪取代码，与 group/team 无关。

**AI 建议：BySpace 只做一个概念——"项目组"，从第一天就绑 project + workspace。** 理由：做两个概念只会在 UI 上多一层无意义的抽象；BySpace 的 project / workspace / worktree 已是一等公民，直接复用。

## 6. Owner 真正要的流程：角色、群聊、自协调、汇报

Owner 明确范围重排：IM、知识库、定时任务自动化那一块**不重要，放最后**。要的是**角色、群聊、角色自协调**——"我能够和 Project Administrator 给需求，他自己拉人、组建团队、拉群、走流程解决问题，然后向我这个老板汇报"。

AI 查证该流程在原产品里的机制（四个原语 + 协议约束）：

| 原语           | 载体                                                         | 作用                                                           |
| -------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| Group          | `team_groups_v3`（含 `leader_member_id`）                    | 协作容器                                                       |
| Goal           | `goal mutate`，带 1–96 turn budget                           | 总目标 + **成本闸**；超预算不再自动唤醒，防 agent 互相无限循环 |
| Plan / RoleRun | `plan_proposals`、`plan_tasks`、`role_runs`                  | leader 提计划 → 拆任务 → 成员按 role 执行                      |
| Routing        | `messages send --mention` / `--not-mention` / `--private-to` | **mention 即唤醒**；不提就只是上下文，不烧钱                   |

协议里值得直接抄的设计：

- **沉默是一等公民**：inbox 判断后若不需要动作，明确不发消息，而不是回一句"收到"。
- **协调者选举**：没点名 owner 时，第一个被 mention 的合格 worker 当选，其余不许抢。
- **可见性与唤醒分离**：`--private-to` 只管谁能读，不管唤醒谁；两者混用会让流程静默死掉。
- **证据规则**：成功唤醒只证明送达，不证明执行；推进阶段前必须核对 canonical message ID 与真实发送者。
- **禁止代写**：roster 里是可独立执行的成员，不是要你扮演的角色；不得代写他人 transcript，模拟未授权的参与者需要人类明确授权。

**已确认：** 优先级 = 角色 → 群聊 → 自协调 → 汇报。

## 7. 同类开源调研：存在，而且有一条直接的血缘链

Owner 提出：是否存在同类开源项目。AI 展开调研（五条特征：长期身份的员工 / 多 agent 协作与协调者 / 带审批收件箱的人控面 / 本地优先 / 驱动编码 agent）。

### 最关键的一条：QwenPaw 不是安全层，它本身就是 Agent OS

AI 之前只把 QwenPaw 当作 tool_guard 的上游。实际不是：

- 它是**自托管的个人 Agent 工作站**，带本地 Web Console（`127.0.0.1:8088`）、TUI、Tauri 桌面端。
- 每个 agent 有**独立工作区 / 配置 / 记忆 / 技能**；三层记忆含 ReMe（自演进 Markdown 知识库）。
- **Tool Guard 带审批等级 STRICT / SMART / AUTO / OFF**，还有 File Guard、Skill Scanner、Access Policy。
- 支持 Coding Mode、ACP、Codex/Qoder Agent 接入。

**它缺的正是 Owner 要的那半分**：没有任务看板、没有审批收件箱、没有组织模型。它自己的 roadmap 把 "Batch preview and approval"、"Agent task handoff"、"Running task steering" 列为 In Progress。

### 血缘链：AgentScope → QwenPaw → AgentTeams，QoderWake 是消费方

`agentscope-ai` 组织的三层结构：

| 层              | 项目                             | 许可       | 星           | 负责什么                                                                                                |
| --------------- | -------------------------------- | ---------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| 框架            | **AgentScope** / agentscope-java | Apache-2.0 | 32.3K / 5.8K | ReAct agent、消息、工具、MCP/A2A、permission hooks、workspace 抽象                                      |
| Agent OS + 守门 | **QwenPaw**（前身 CoPaw）        | Apache-2.0 | 35.2K        | 每 agent 工作区/记忆/技能、Console、Tool Guard / File Guard / Skill Scanner、多 agent、IM channels、ACP |
| 组织控制面      | **AgentTeams**                   | Apache-2.0 | 5.7K         | Manager-Workers、Matrix 房间（人在房里）、声明式 Worker/Team/Human、凭据网关、TeamHarness 任务状态      |

**QoderWake 与这条链的关系有硬证据：** 它的 channel 命令至今写着 `--target-kind waker|team_group|team_leader`，而 `team_leader` / `team_group` 正是 AgentTeams 的资源概念；它自己的表还叫 `team_groups_v3`（§5 已证 team 是 group 旧名）。即 **QoderWake 的组织层沿用 AgentTeams 的家法，安全层直接拿 QwenPaw 的。**

### 其它候选（已核实）

| 项目                                  | 许可                                           | 星          | 形状                                                                                           | 与我们要的差距                                                                                                                                                |
| ------------------------------------- | ---------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Paperclip** `paperclipai/paperclip` | MIT                                            | **81.4K**   | Node 服务 + React UI + 内嵌 Postgres；org chart、预算、审批工作流、心跳调度、适配器插件        | 单位是**商业目标**（"做到 $1M MRR"）不是编码任务；无 daemon+WS/relay/配对；治理是 run/policy 级，**无逐工具权限**。积压惊人：2361 open issues / 3236 open PRs |
| **5dive**                             | MIT                                            | 61          | each agent 一个 Linux 用户 + systemd；org tree、SQLite 任务队列、`task inbox` 审批、`5dive-ui` | 形状最接近，但**采用度极低**；只支持 Linux；UI 只读                                                                                                           |
| **Kortix/Suna**                       | **ELv2**（非 OSI 开源）                        | 20.2K       | agent + skills + company memory 全是 git 里的文本，sandbox、变更请求审批                       | 许可禁止作为托管服务提供；主运行时是云 sandbox，“自托管”仍需拉 Docker Hub 镜像                                                                                |
| **Paseo**                             | 声明 Apache-2.0，第三方说 AGPL-3.0（**未定**） | 18.2K       | daemon + relay + Expo + CLI，与 BySpace 同构                                                   | 无员工身份、无任务板、无审批收件箱                                                                                                                            |
| **Orca**                              | MIT                                            | 76.7K       | 桌面 ADE，worktree/终端/编辑器 + relay                                                         | 无员工模型、无任务板、无审批收件箱。**当 UI 与 worktree 参考，不当员工平台**                                                                                  |
| **OpenHands** / **Omnara**            | MIT / Apache-2.0                               | 80K+ / 2.9K | 编码 agent + 控制中心 / 持久 agent + RBAC + tool policy 停等审批                               | 非员工组织模型                                                                                                                                                |

**框架类（CrewAI / LangGraph / AutoGen / MetaGPT / CAMEL / Letta）与本需求不同类**：它们是库不是产品，无 UI、无任务板、无审批收件箱。另 AutoGen 已并入 Microsoft Agent Framework，处于维护模式。

**负面结果（重要）：**

- **没有任何开源项目同时具备全部五条**。最接近的四个各自缺一块：Paperclip（缺 daemon+WS、缺逐工具策略）、AgentTeams（缺 Web 任务板、K8s/Matrix 优先）、QwenPaw（缺任务板与审批收件箱）、5dive（缺采用度与真实 UI）。
- **生态里没有可抽取的独立权限策略引擎**（除 QwenPaw 的 Tool Guard / Access Policy 外）。每个项目要么自建，要么交给 agent 原生权限系统。**这是真实的生态空缺，也是“权限层值得自己拥有”的最强论据。**
- Paseo 的许可两派说法冲突（repo 显示 `NOASSERTION`），影响后续任何 fork 决策，需单独核实。

### AgentTeams 深挖结果

它自己的文档齐全（`docs/design/` 下有架构、TeamHarness 四篇、权限分层、凭据、房间权限）。

**资源模型。** 五个角色：Human / Manager / Worker / Team / Team Leader。全部 CRD 化（Kubernetes 声明式资源），Worker 是**无状态容器**，按需创建。Manager 负责理解目标、创建或选择 Worker、派活、跟踪、汇总。Team = 多个 Worker + 一个 Team Leader 的可复用协作单元。

**架构很重。** 控制器（Go operator）+ Matrix/Tuwunel（通信）+ Higress（LLM 与 MCP 统一网关、身份与访问控制）+ MinIO（对象存储，存放工作区/配置/产物）+ Element Web（UI）+ 每 Worker 一容器。最低 2 核 4GB，本地路径也是 docker-compose。**与 daemon + 本地 Web 的形态不同构。**

**TeamHarness 是什么。** 一个 MCP 插件，提供“运行时中立的团队协作底座”：稳定的角色提示词、协作技能（组织/沟通/共享文件/项目/派活/执行）、显式 MCP 工具。它**不**拥有 worker 生命周期、控制器调和、秘钥存储。

**最值得偷的一块：任务转换引擎（`docs/design/teamharness/task-transition-engine.md`）。** 它把自己的旧毛病写得很清楚：_状态转换散落在五个调用点（`delegate_task` / `ack_task` / `submit_task` / `accept_task_result` / `cancel_task`），各自手写守卫宽严不一；转换无历史；`accept` 只写 project meta，task meta 与节点状态可永久分叉。_ 它的修法：

- **一张转换表作为单一事实来源**（`task-transitions.json`），Python 写侧与 Go 读侧**加载同一文件并在测试中断言一致**（跨语言单源，双写漂移在测试期暴露）。
- 九态：`planned → prepared → assigned → in_progress → submitted → completed / revision / blocked / cancelled`，后四者为终态。
- **单一入口 `_transition_task()`**：校验转换表 → 写 status → 追加 history（封顶 50，丢最旧）→ task meta 与 project 节点**同批**同步。
- history 条目：`{ts, from, to, action, actor, note}`；同状态重入（幂等重试）**不记条目**。
- `report_progress` 是不改状态的 `from == to` 条目，note 必填且限长；v1 **不发房间通知**（防噪音）。
- 越序转换返回结构化错误并**引导正确动作**（`submit_task: task is 'planned'; ack_task it first`）。

**完成通知的设计教训（与我们直接相关）。** 原文：`submit_task` 原先只给 LLM 一个“你该发完成消息”的**提示**，靠 Worker 自己记得发 `@leader TASK_COMPLETED: ...`；实际部署中 **Worker 在上下文压缩后忘掉这行**，Leader 收不到唤醒，下游任务卡在 `waiting`。修法是**把通知从“靠模型记得”改成机制自动发**，并用稳定 txn id（`submit-<task-id>-<status>`）做幂等去重。

**人类在环。** 每个 Matrix 房间**包含人**；人在房里看全程、随时插话。审批就发生在房间里，**没有独立的审批收件箱**。房间权限有专门设计（`room-power-levels.md`）：人类按 `permissionLevel` 映射到 Matrix power level（1 → 100，2/3 → 50），且在每次 reconcile 时**修复**遗留房间。

**凭据隔离。** 真实凭据（API key、GitHub PAT）只存在 Higress 网关；Worker **只拿消费级 token**，看不到也拿不走真钥匙。MinIO 存共享文件系统，用于 agent 间传递信息以降低 token 消耗。

**权限分层（直接对应我们的审批闸）。** 角色矩阵（admin / manager / team-leader / worker / human）回答“你是谁”；`Human.spec.capabilities` 回答“你能碰哪个敏感面”，五个封闭取值：`full_access` / `channel_secrets` / `external_sources` / `approval_policy` / `secret_reveal`。两条硬规则：

- **“capability 永不隐含 team 范围”** —— 完整校验顺序是 `角色基线 AND TeamMatches AND HasCapability`，三者组合而非替代。
- **拒绝即隐形的 404 而非 403** —— 跨团队更新返回 404，因为 403 会让受限用户**枚举出**他看不见的 worker 及其归属团队。

另有一条值得学的写侧策略：L2 人类改 worker 只允许改 `skills` 一个字段，其余字段**逐项拒绝**；并且有一个测试 `TestL2WorkerUpdateFieldPolicyCoversAllRequestFields` 钉住“请求类型的**每个字段都必须被显式决定**，不得因遗漏而变成可写”。deny-by-default。

还有双层审计：每次操作**同时**写一条即时结构化日志行与一条 append-only 的 `audit/<UTC日期>.jsonl`（ETag 乐观并发 + 重试），日志行“即使没有存储也总是写”。

**它缺什么。** 无任务板；无独立审批收件箱（审批在房间里）；**未发现回合预算机制**（QoderWake 的 Goal 预算在它这里没有对应物）；无逐工具调用策略（工具级审批是 QwenPaw 的）。

### 对开发选择的影响

**AI 建议：仍自建 worker 域，但把“自建”缩小到三件事。**

**Owner 裁决：只看阿里 / agentscope 生态，不引入其它开源项目。** 理由是融合不好（不同框架、不同 runtime、不同许可），引入它们会让 worker 域变成多方缝合。因此：

- **参考范本 = QoderWake（产品形态）+ AgentTeams（组织层机制）+ QwenPaw（权限层策略）**。三者属同一血缘链（§7 已证）。
- **不引入 Paperclip / 5dive / Kortix / Orca / OpenHands 等**。已调研并记录在案，仅作背景认知，不进设计输入。
- **AgentTeams 单独深挖**（Owner 已确认）：只读设计不写代码，重点是 TeamHarness 与凭据隔离。

要自己做的三件（不可替代）：

1. **daemon + WS 协议 + relay + 本地 Web UI 的形态** —— 这是 BySpace 的已确定架构（`025` 的结论），也是上面所有项目都不具备的。
2. **逐工具调用的权限裁决** —— 从 QwenPaw 移植策略模型（Apache-2.0），而非重写。生态里无现成库，这也是我们的差异点。
3. **项目组自协调（角色 / 群聊 / 协调者 / 汇报）** —— 这块要按 §6 抄 QoderWake 的协议与 Goal 预算模型，而不是 AgentTeams 的 Matrix/K8s 路径。

**一句话结论：开源在“员工与组织控制面”这一层已经有不少前作，但在 daemon + 本地 Web + 逐工具审批 + 驱动 Pi 这个交集上没有现成产品；且按 Owner 裁决，我们只取阿里生态内的三份范本。这正好支持原计划：自建外形，移植权限，按 QoderWake 与 AgentTeams 的机制设计。**

## 8. 已确认决策

- 形态：BySpace 左上角入口 + **独立路由** + 独立功能页；能力复用，界面不耦合。
- 借鉴颗粒度：**最细，全部借鉴**。布局、信息架构、交互流程照抄；样式用 BySpace 自己的 token 与设计系统。
- 术语：统一用 **worker**。
- 存储：worker 域**新做一套，可以用 SQLite**（BySpace 现有的是文件 JSON + Zod），视为半独立的新功能。
- 运行时：用 **pi** 驱动，不做多 provider 适配。
- 依赖：**不引入任何云账号**依赖；不引入 IM 渠道依赖。
- 资产：11 个角色模板 + 61 个技能已收割；权限层从 QwenPaw（Apache-2.0）移植。
- 概念：只做"项目组"（绑 project + workspace）——它本身就是一个概念，team 是旧名；少改动优先。
- 取用方式：按上表分层（QwenPaw 源码 / 已收割模板 / 实例观察），不移植 minified 机器码。
- vision：写入"参考产品"，且是**完全参考**。

## 9. 仍开放

- worker 能否自批自己的审批。BySpace 现在 agent 与 terminal 共享 `workspace.write`，没有这道闸；wake 靠环境变量在 runtime 层拒绝 `approval resolve`。AI 建议在 worker 域加硬闸、老 agent 域不动。
- 项目组与 workspace 的绑定粒度。AI 建议一个项目组绑项目、每个 worker 一次任务开一个 worktree。
- 模板命名与归类：是否去掉 `common-` 前缀、`个人分身` 与 `Q&A Specialist` 是否纳入首批。
- skill_scanner（8 类签名扫描）是否纳入首批，还是只做 tool guard。
- **领域内是否已有可用的开源项目。** 已调研完成（§7）：无现成可 fork 者；Owner 裁决只取阿里 / agentscope 生态内的范本，不引入其它开源项目。
- AgentTeams 深挖已完成（§7）：四个可直接借的设计（任务转换表单入口、机制化通知、capability 与角色正交、跨团队 404）已记录。
- 参考产品的关系是否要升格为 vision 里并列的第二产品面（本 talk 先只写"参考产品"条目）。

## 10. 影响与风险

- **两套持久化模型并存**：worker 域用 SQLite，主域是文件 JSON + Zod，无迁移框架。需要在 worker 域内自成体系，不试图统一。
- **两套权限语义并存**：daemon 级 principal + grants，与 worker 级 tool guard / file guard / builtin tools / model security 四个 section。谁在什么层裁决必须写清，否则会出现两个真相。
- **成本**：自协调意味着一个需求可能拉起 N 个 worker 并行跑 pi。turn budget 与并发上限必须从第一天就有，否则一次误操作会放大成 N 倍消耗。
- **许可**：模板移植保留版权声明；从上游 Apache-2.0 移植需保留 NOTICE；内嵌 browser-harness 为 MIT（Copyright Browser Use）。QoderWake 本身无开源许可，不得移植其 minified 代码。**Paseo 为 Apache-2.0**（LICENSE 全文核实：除第三方组件外整体 Apache-2.0，无 AGPL 字样），BySpace 从它 fork 而来，上游许可不构成限制。
- **界面一致性**：新页面照抄它的布局，但与主界面并存，两套视觉语言需要边界（同 token、不同密度）。
- **术语污染**：`worker` 与现有 agent / workspace / session 的关系要一次说清，否则 glossary 的同义词禁令会失效。

## 11. 候选质量目标（非承诺）

- **安全性**：worker 域从第一天有"agent 不能自批审批"的硬闸；高风险命令在 runtime 层拦截而非靠提示词。
- **资源效率**：自协调的并发与 turn budget 有上界，且超限行为是停止自动唤醒而非静默继续。
- **可用性**：从"给需求"到"收到汇报"的主路径在窄屏可读可操作。
- **可维护性**：worker 域的数据与权限不污染主域既有 store 与 permissions 结论。

## 出口

**已执行：** 落为 Epic `byissue/epics/004-o-worker-domain/`（状态 open，owner_decision approved），首个 Issue `issues/001-o-worker-domain-foundation.md`。vision「参考产品」与「演化地图」已更新。

**Epic 分五块：** worker 域 / worker runtime / 项目组自协调 / 控制台 UI / 审批闸。

**第一批：** 角色实体 + 模板导入 + 项目组（绑项目与工作区）+ 群聊 + Goal/mention 路由 + 协调者。

**暂不纳入：** IM 渠道、知识库、定时任务自动化、WakerFlow、插件与技能市场、云账号、跨设备远程 worker。

**待办：** 定下 `/Users/zijie/workspace/refs/qoderwake-worker-assets/` 中模板进仓库的位置与命名（Issue 001 内的一项）。
