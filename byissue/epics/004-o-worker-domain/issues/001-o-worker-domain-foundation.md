---
kind: issue
title: "worker 域地基设计与首批切片"
type: feature
status: open
created: 2026-09-24
---

# worker 域地基设计与首批切片

> **读者：** 接手本 Epic 第一个切片的人。要知道 worker 域的地基长什么样、哪些已定、哪些要先查清、怎么算跑通。

## 目标与范围

产出 worker 域的地基设计，并给出第一批可独立推进的切片。**设计已定稿（见下）。**

**包含：** worker 实体模型；SQLite schema 与归属；与 pi runtime 的装配方式（角色提示如何注入、一次执行如何映射成 Session）；权限闸的落点与裁决顺序；模板导入的最小可用路径。

**不包含：** 项目组与群聊的完整实现（后续切片）；UI 落地；IM、知识库、定时任务；记忆的版本化方案。

## 背景

`byissue/epics/004-o-worker-domain/spec.md` 已定形态与边界。本切片在动实现之前先把地基钉住，因为地基决定后面几块能不能少改动。

三处已查明的现有事实：

- pi 适配是完整的：`packages/server/src/server/agent/providers/pi/` 下 `agent.ts`、`cli-runtime.ts`、`runtime.ts`、`history-mapper.ts`、`tool-call-mapper.ts`、`session-descriptor.ts`。worker 的执行直接走它，不新写 runtime。
- 主域存储是文件 JSON + Zod，无迁移框架（`docs/data-model.md`）。worker 域用 SQLite，自成一套。
- 现有权限是 daemon 级 principal + grants，agent 与 terminal 共享 `workspace.write`（`docs/permissions.md`），**没有「agent 不能自批」这道闸**。worker 域需要它。

## 要先查清的三件事（已查清，见 talk §7）

AgentTeams 深挖已完成，结论如下：

1. **TeamHarness 的任务状态机** —— 九态转换表作单一事实来源，`planned → prepared → assigned → in_progress → submitted → completed / revision / blocked / cancelled`（后四者为终态）；跨语言加载同一文件并在测试中断言一致；单一入口同时写状态、追加 history（封顶 50）、同批同步多层状态。可指导我们的目标/计划/角色执行三层建模。
2. **凭据隔离** —— 它靠网关（Higress）让 worker 只持有消费级 token，真凭据不进 worker。但我们的 pi 凭据来自本机配置，形态不同，**不能直接照搬**；本切片需要判断是否存在等价风险，若无则明确记为不适用。
3. **预算机制** —— **AgentTeams 没有回合预算**；QoderWake 的 Goal 预算是它独有的。因此预算按 QoderWake 的模型设计（消息/回合上界 + 触顶停止自动唤醒），不参考 AgentTeams。

一条额外的已验证教训（直接决定我们的派活与汇报怎么写）：**通知必须靠机制而非模型记得**。AgentTeams 原先把“发完成消息”交给 Worker 自己记，实际部署中 Worker 在上下文压缩后忘掉它，Leader 收不到唤醒、下游任务卡在 `waiting`。任何关键信号（派活、完成、汇报）都不得依赖提示词。

## 方案（已按深挖结论校正）

- **实体**：worker 有 id、名称、角色模板引用、工作区路径、状态、记忆引用、技能清单、权限配置。
- **执行**：一次任务 = 一个 Session，经 pi provider 启动；角色提示由模板的职责/人格/工作手册装配。
- **任务状态**：按一张转换表 + 单一入口写，带 history，越序转换被拒并返回可操作的错误消息。
- **权限闸**：worker 域独立裁决，先于工具执行；规则取自 QwenPaw 的策略模型（29 条规则、8 类、severity 分级）。跨范围拒绝返回 404 而非 403。
- **通知**：派活、完成、汇报全部由机制发出，并用稳定 id 幂等去重；不依赖模型记得开什么话。
- **模板**：已收割的 11 模板与 61 技能（位于 `/Users/zijie/workspace/refs/qoderwake-worker-assets/`）进仓库，格式即 `.qoder/` 那套六个 Markdown 加技能目录，改名去掉 `common-` 前缀。该目录的 README 记了来源、许可状态与校验和，引入前先读。

**有界简化：** 记忆先只做工作区内的 Markdown 文件，不做 git 快照与回滚。上限：无法回溯记忆变更。升级触发：出现「记忆被改坏且需要还原」的真实需求。升级方向：照 QoderWake 的 git 快照方案。

## 验证

- 实体与 schema 定稿，且不与主域 store 冲突。
- 权限闸落点明确，能拒绝 worker 自批审批，且跨范围拒绝不泄露对象是否存在。
- 任务状态只有单一写入入口，越序转换被拒且有历史。
- 从模板导入到跑通一次 pi 执行的路径可走通。
- 首批切片各自可独立推进，依赖关系写清。

## 现状怎么工作（本次开工核对）

以下是写设计前读代码确认的事实，都与设计直接相关。

**执行路径已通。** `AgentSessionConfig.systemPrompt` 是 provider 无关的系统指令字段（`packages/protocol/src/agent-types.ts:517`），pi provider 已在用：`agent.ts:2608` 做 `composeSystemPromptParts(config.systemPrompt, config.daemonAppendSystemPrompt)`。**worker 的角色提示直接走这里，不需要新 runtime。**

**存储。** Node 24.21 自带 `node:sqlite`（`DatabaseSync`），已实测：建表、WAL、事务回滚、外键均可用。**不新增依赖。**

**权限裁决点确实缺一道闸（已定位）。** `respond_to_permission` 是一个注入给 agent 的 BySpace 工具（`agent/tools/byspace-tools.ts:3084`），它接受任意 `agentId` 并直接调 `respondToAgentPermission`，**没有任何“调用者不能是目标 agent”的检查**。它不在 daemon 权限集内（`docs/permissions.md` 的权限表不含它）。但工具目录的工厂已收到调用者身份：`callerAgentId` 传入 `createBySpaceToolCatalog`（`byspace-tools.ts:535`，来源 `agent-manager.ts:5104`），且已有别的工具用它做守卫（同文件 `:654`）。**修法很小：加一个同源于已存模式的检查。**

**权限请求形态。** `AgentPermissionRequest` 有 `id / provider / name / kind / title / description / input`；kind 为 `tool | plan | question | mode | other`（`agent-sdk-types.ts:491-510`）。审批可带 `toolInputPreview` 与 findings 摘要，参照 QoderWake 的 `PendingApprovalRegistry`。

**路由与入口。** 顶层页的现成形状是 `packages/app/src/app/schedules.tsx`：一层 `HostRouteBootstrapBoundary` 包一个 screen。侧栏已有 header action 按钮样式槽（`components/left-sidebar.tsx:931`）。

**RPC 命名。** 新 RPC 用点号命名空间 + `.request` / `.response`（`docs/rpc-namespacing.md`），所以 worker 域用 `worker.*`。

## 方案

### 一、实体与存储

worker 域用 `node:sqlite`，库文件落在 `$BYSPACE_HOME/worker/worker.db`。三张表起步：

| 表                        | 关键列                                                                      | 说明                                                                   |
| ------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `workers`                 | id / name / template_id / workspace_path / status / created_at / updated_at | 数字员工本体                                                           |
| `worker_permissions`      | worker_id / section / payload_json                                          | 四个 section：tool_guard / file_guard / builtin_tools / model_security |
| `worker_task_transitions` | task_id / from_state / to_state / action / actor / ts / note                | 任务状态历史                                                           |

约束：

- **任务状态只有一张转换表 + 一个写入入口。** 九态：`planned → prepared → assigned → in_progress → submitted → completed / revision / blocked / cancelled`。越序转换拒绝并返回可操作错误。同状态重入不写历史条目。
- **单一事实源。** 转换表是数据，不是散在调用点的 `if`。
- schema 与迁移：worker 域**自带版本号与迁移**（主域无迁移框架）。这是有界简化：不为 worker 域建一套通用迁移框架，只在域内向上升。

### 二、与 pi 的装配

worker 的一次任务 = 一个 Session：

1. 由 worker 的模板文件（`IDENTITY/PERSONA/BIBLE/CORE_CAPABILITIES/WORK_STYLES`）拼出 `systemPrompt`。
2. `AgentSessionConfig.cwd` = 该项目组的 workspace 路径。
3. `provider = "pi"`，不做多 provider 分支。

**有界简化：** 第一版只拼 `IDENTITY + PERSONA + BIBLE`（职责、人格、工作手册），`CORE_CAPABILITIES` 与 `DELIVERY_COMMITMENTS` 暂不进提示。上限：角色能力清单不参与装配，模型看不到自己声明的能力项。升级触发：出现“worker 不按声明能力行事”的真实案例。升级方向：把两者格式化为提示段落。

### 三、权限闸

两层，职责不同：

**一层：worker 域自己的逐工具裁决**（新）。取自 QwenPaw 策略模型（29 条规则 / 8 类 / severity 分级）。在工具执行前裁决，四个 section 独立。

**二层：堵住现有 Agent 工具目录的越权缺口**（改）。为 `respond_to_permission` 加一条：**调用者不得响应挂在自己身上的权限请求**。

- 实现：用具目录已持有的 `callerAgentId` 与请求的 `agentId` 比较，相等即拒。同源于 `byspace-tools.ts:654` 已有写法。
- 范围：只堵“自批”。不改 daemon 权限模型（`docs/permissions.md` 的 principal 模型不动），不让 agent 之间无法代批。
- 这是独立于 worker 域的真实安全缺口，但改动极小且与本次相关，所以在本切片内完成；若 Owner 认为应单独追踪，拆出去也行。

**跨范围拒绝返回 404 而非 403**（取自 AgentTeams）：不让受限调用者枚举出他看不见的对象。

### 四、模板导入

- 资产来源：`/Users/zijie/workspace/refs/qoderwake-worker-assets/`（其 README 记了许可）。
- 落点：`packages/server/src/server/worker/templates/<role>/`，去掉 `common-` / `devops-` 等对方前缀。
- 许可：QoderWake 无开源许可，所以是**改写适配**而非搬运；`browser-harness` 是第三方 MIT（Copyright Browser Use），若保留需附声明。
- 首批只入**开发相关**的模板（Frontend / Backend / QA / Project Administrator），内容运营、个人分身等不入。

### 五、首批切片

| 切片 | 内容                                      | 依赖     |
| ---- | ----------------------------------------- | -------- |
| 001  | 地基：实体 + SQLite + 转换表 + 状态机测试 | 无       |
| 002  | 模板导入：格式定稿 + 首批模板入库         | 001      |
| 003  | pi 装配：自模板到一次可跑的 Session       | 001、002 |
| 004  | 权限闸：worker 域裁决 + 堵住自批缺口      | 001      |

001 不动 UI——UI 是后续切片，本切片先让地基可在测试中观察。

## 风险与穿刺

两个想法上的不确定点，先打通再加厚：

1. **`systemPrompt` 注入对 pi 是否真的生效且不被覆盖。** 风险：pi 可能在 daemon append 或扩展文件里覆盖它。怎样算打通：构造一个带可识别标记的 role prompt，跑一次 pi，从实际发出的系统提示中读到该标记。
2. **`callerAgentId` 在 `respond_to_permission` 里是否确实非空。** 风险：非 agent 发起的会话可能没有它，守卫会变成空转。怎样算打通：写一个用例，自批被拒、代批放行；并确认无 callerAgentId 时是拒绝而非静默放行。

主路径端到端：创建 worker → 导入模板 → 拼提示 → 起一次 pi执行 → 产生任务状态与历史。

## 验证

- **状态机**：越序转换被拒、合法转换可走、历史可查、同状态重入不写条目。（最小可运行检查：一个覆盖全转换表的参数化用例。）
- **权限闸**：自批被拒、代批放行、无 callerAgentId 时拒绝。（两个负例 + 一个正例。）
- **存储**：WAL 下读写、事务回滚、重启后不丢。（一个持久化用例。）
- **模板**：导入后能租出合法提示，且不含对方命名前缀。（一个内容断言。）
- **pi 装配**：提示可达模型（穿刺 1 的结果作为证据）。

命令：`npx vitest run <本切片测试文件> --bail=1`。

## 执行记录

已实现。新增 `packages/server/src/server/worker/`：

| 文件                       | 内容                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `worker-task-state.ts`     | 九态转换表、`canTransition` / `assertWorkerTaskTransition`、带指路的拒绝错误               |
| `worker-store.ts`          | `node:sqlite` 存储；建表、迁移版本、唯一的状态写入入口                                     |
| `worker-template.ts`       | 模板加载与系统提示拼装，缺件时报错而非静默降级                                             |
| `worker-session-config.ts` | worker + 模板 + 任务 → `AgentSessionConfig`（provider 固定 `pi`）                          |
| `node-sqlite.d.ts`         | `node:sqlite` 的最小环境声明（仓库钉的 `@types/node@20` 早于该模块）                       |
| `templates/`               | 首批 4 个角色：frontend-developer / backend-engineer / qa-engineer / project-administrator |

改动既有文件两处：

- `agent/permission-response.ts`：新增 `assertNotSelfPermissionApproval` 与 `SelfPermissionApprovalError`，在调 provider 之前拦下自批。
- `agent/tools/byspace-tools.ts`：把目录已有的 `callerAgentId` 传给上述检查。

**与设计的偏差（三处，均偏小）：**

1. **同状态重入在 `canTransition` 里特判。** 最初实现把自环交给转换表，测试逐个状态枚举时暴露出我自己的矛盾：表里没有自环，但幂等重试又必须放行。改成在 `canTransition` 里显式处理同一状态，并单独提供 `isNoOpTransition`；表保持“只记真实变化”。
2. **`close()` 做成幂等。** 重开数据库的用例暴露关闭两次会抛错。修在存储而不是改测试——daemon 关闭路径也可能重复调。
3. **模板进仓的四份是 `IDENTITY/PERSONA/BIBLE`。** `CORE_CAPABILITIES` / `DELIVERY_COMMITMENTS` / `WORK_STYLES` 按有界简化暂不入，且有用例断言它们不出现在提示里。

## 穿刺结果

两个风险点都**已打通**，且都不是靠新写的一次性试探：

| 风险                                   | 结论   | 证据                                                                                                                                                             |
| -------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| role prompt 虽拼得出，但 pi 未必真收到 | **通** | `worker-pi-integration.test.ts`：真实模板 → 真实拼装 → 真实生成的 pi 扩展 → 断言角色在 pi 自有的系统提示之后仍然存在                                             |
| `callerAgentId` 是否真能拦住自批       | **通** | 三层覆盖：单元（`permission-response.test.ts`）与端到端（`mcp-server.test.ts` 过真实 MCP 客户端）：自批被拒且**未到达 provider**、代批放行、无身份（控制台）放行 |

主路径已端到端串通：模板 → 提示 → `AgentSessionConfig(provider: "pi")` → 真实 pi 扩展接受该提示。

顺带核实一件与本切片相关的事实：`agent.test.ts:1650` 已有用例断言 `systemPrompt` 与 `daemonAppendSystemPrompt` 拼到 pi 自有提示之后，说明这条路径不是本切片新开的口子，而是既有能力——我们的角色提示接在一个可信的台阶上。

## 验证

命令与结果：

```
npx vitest run packages/server/src/server/worker/ \
  packages/server/src/server/agent/permission-response.test.ts \
  packages/server/src/server/agent/mcp-server.test.ts \
  packages/server/src/server/agent/providers/pi/agent.test.ts --bail=1
→ 8 files / 275 tests passed
```

逐项对照质量承诺：

- **状态机**：全转换表参数化跑通；越序、终态出边、未知任务均被拒；同状态重入不写历史且不改 `updatedAt`；历史序号单调。
- **权限闸**：自批被拒且 provider 未被调用；代批放行；无 `callerAgentId` 时放行（控制台场景）。
- **存储**：WAL 下读写、外键拦截孤儿任务、关闭重开后状态与历史均在。
- **模板**：已入库 4 个模板均含全部必需部件；缺件与不存在两种失败可区分且提示到位；能力类文档经断言不进入提示。
- **pi 装配**：见穿刺表第一行。

`npm run typecheck`、`npm run lint`（改动文件）、`npm run format:check` 均通过。

## 有界简化（当前上限与升级触发）

- **记忆未做。** 实体里没有记忆字段，也没有版本化。上界：worker 跨任务不积累经验。升级触发：出现“同一个 worker 重复犯同类错”的真实案例。方向：工作区内 Markdown 加 git 快照。
- **worker 域权限裁决未实现。** 本切片只堆了那道自批闸（既有缺口的修补）；QwenPaw 那套 29 条规则的逐工具裁决属下一切片。上界：worker 的高风险命令目前无额外拦截。升级触发：切片 004。
- **模板无技能。** 只入了角色三件，未入 61 个技能。上界：角色只有性格与方法，没有可调用技能。
- **未接 daemon。** 存储、模板、装配都已可测，但还没有 RPC、没有 UI、daemon 启动时不建库。上界：这些能力目前只能从代码调用。

## 关闭候选（此时不毕业）

关闭时建议写入 `byissue/epics/004-o-worker-domain/spec.md`：

- 九态转换表与单一写入入口的具体形态。
- 模板三件的装配约定，以及能力类文档暂不入提示的理由。
- 自批闸的位置（`respondToAgentPermission`）与其三种身份的语义。
- worker 域用 `node:sqlite` 且自带迁移版本的决定。

值得单独记一条 note 的：`@types/node@20` 早于 `node:sqlite`，仓库采用局部 `.d.ts` 环境声明解决，位置必须落在 tsconfig 的 `include` 覆盖范围内（`src/types/` 不被编译，故放在 `src/server/worker/`）。
