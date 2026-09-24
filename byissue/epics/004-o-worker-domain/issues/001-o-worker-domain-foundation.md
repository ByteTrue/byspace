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

### 切片 001：地基（已完成）

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

### 切片 002：模板扩展（已完成）

模板从 4 个扩到 **8 个**，技能从 0 补到 **47 个**，总体积 488KB：

| 角色                  | 技能 |
| --------------------- | ---- |
| backend-engineer      | 8    |
| data-analyst          | 7    |
| devops-engineer       | 7    |
| frontend-developer    | 7    |
| project-administrator | 6    |
| product-manager       | 5    |
| qa-engineer           | 5    |
| ui-designer           | 2    |

**未入的 3 个模板，各有理由：**

- `content-operations`——运营角色，与产品主线（开发）无关。
- `q&a-specialist`——内容只有 1 行身份加几条约束，是为 IM 群答疑定制的；IM 渠道已明确放最后。
- `personal-avatar`——是“本人分身”而非员工角色，且 PERSONA/BIBLE 为空。

**未入的技能：`browser-harness`。**

这是本切片最重要的一个决定，也暴露了 001 遗留的一个真实缺陷。

`browser-harness` 是一个**内置的第三方项目**（MIT，Copyright Browser Use，92 个文件、1.25MB，含 Python runtime），不是角色方法。更关键的是：**BySpace 已经专门把它退役了**——`byissue/issues/032-x-ff-retire-browser-tools.md`（已关闭，2026-09-15）删掉了整套 browser tools 运行时。把它引进来等于复活一个刚退役的能力。

**但 001 已经把这个缺陷写进了仓库：** 四个模板的 BIBLE 用 `` `skill browser-harness` `` 指令 worker 调用它，而技能目录里没有这个东西。**worker 会被要求使用一个加载不出来的技能。**

修法不是删掉引用（那是改对方的方法论），而是**让这种悬空引用不可能幸存**：

- `loadWorkerTemplate` 现在真实列出技能目录（且要求目录里有 `SKILL.md`，空目录不算）。
- 新增 `extractReferencedSkillIds(bible)` 解析 `` `skill <name>` ``。
- 新增测试：每个模板 BIBLE 引用的技能必须已入库，或在 `DELIBERATELY_UNIMPORTED_SKILLS` 里显式登记原因。
- 另一条测试反过来验证登记表的每一条都还真的被某个模板引用（避免登记表变成垃圾堆）。

**这条测试已反向验证过有效性：** 临时移走 `front-design` 后，它准确报出 `frontend-developer references unimported skills: expected [ 'front-design' ]`。

验证：

```
npx vitest run packages/server/src/server/worker/ --bail=1
→ 5 files / 62 tests passed
```

### 切片 004：权限闸（已完成）

新增 `packages/server/src/server/worker/tool-guard/`：规则数据 + 裁决引擎。

**规则来源与做法。** 从 QwenPaw（`agentscope-ai/QwenPaw` 的 `rules/dangerous_shell_commands.yaml`，Apache-2.0）**按数据导入**而非手抄：21 条规则，7 CRITICAL / 14 HIGH，分 6 类（code_execution 8、command_injection 4、resource_abuse 4、privilege_escalation 2、sensitive_file_access 2、network_abuse 1）。用脚本转换，`rules.json` 里保留 `source`、`sourcePath`、`importedAt`。

上游还有一类 `ShellEvasionGuardian`（7 项反规避检查），但**它是代码不是数据**（引用符状态机、逐字符扫描），本切片未移植，记为后续。

**裁决语义。** 三档决策，且 `block` 与 `confirm` **不是严重度的同义词**：

- `block` = CRITICAL，拒绝，worker 问也得不到；
- `confirm` = 其余命中，真人可以放行；
- `allow` = 无命中。

命中时**收集全部匹配规则**而不是遇到第一条就返回，让审阅者看到完整画面。片段截断到 200 字符——findings 会被记录和展示，不能把整条命令抛进去。

**一个安全上的设计选择：规则加载失败就报错，不降级。** 零规则的 guard 与“未发现风险的 guard”从外部看一模一样，这是安全控制最坏的失败模式。因此：文件声明条数与实际不符、正则非法均抛错。

**引号处理。** 匹配前剥掉单引号内容（`echo 'rm -rf /'` 只是打印文本），但保留双引号内容（shell 在双引号内仍会展开）。这是个近似，不是 shell 语法解析——文档里写清了：真正兜底的是审批闸，不是这个匹配器。

**构建产物已验证。** JSON 导入用的是 `with { type: "json" }`；担心它过不了真实构建，所以实际跑了 `tsc -p tsconfig.server.json` 并**执行了编译后的 JS**：`rules.json` 被拷贝到 `dist`，导入语句保留，运行输出 `block / confirm / allow` 三档均正确。

验证：

```
npx vitest run packages/server/src/server/worker/ --bail=1
→ 6 files / 84 tests passed
```

覆盖：四类威胁各有拦截用例（磁盘销毁、fork bomb、提权、rm/mv 需确认）；规则完整性（21 条、id 唯一、严重度合法）；加载失败两个负例；引号语义四条；禁用规则可解除阻断；发现项片段有界。

### 切片 005：接入 daemon 与 RPC（已完成）

按 Owner 选择的顺序 A：先把已有能力变成可通过协议调用的东西，再加项目组。

**协议。** 新增 `packages/protocol/src/worker/rpc-schemas.ts`，8 对 `.request` / `.response`，按 `docs/rpc-namespacing.md` 用 `worker.template.*`、`worker.worker.*`、`worker.task.*`、`worker.guard.*` 命名。全部并入入站与出站 union。

**权限分类是穷尽的。** `operation-permissions.ts` 用 `satisfies Record<InboundOperation, ...>`，所以新增 RPC 不分类就编译不过——这是好事，但不能靠它提醒人把映射写对。分类：读操作用 `workspace.read`，建 worker 用 `workspace.manage`，动任务用 `workspace.write`，guard 评估是 `workspace.read`（它只读不写，且应该允许保守调用者先问再做）。

**存量仓库/类别。** 新增 `WorkerService`（daemon 侧门面，持 store、模板目录、guard 规则），新增 `WorkerSession`（薄翻译层，不含领域规则），接入 session 分派链与 websocket server 的必需服务。

**存储生命周期是个设计选择：惰性打开。** 从不碰 worker 的 daemon 不会为它建库；打不开库也不能阻止 session 与 terminal 工作。所以 `WorkerService` 在首次使用时才 `new WorkerStore`，bootstrap 里只构造对象。

**错误处理分两类。** 拒绍（模板不存在、转换非法、任务不存在、动作未知）是用户可预期的，记 `debug`；只有真正的意外才记 `error`。否则日志会被用户输错淹没。响应统一走 `rpc_error`，不往每个响应上挂 `error` 字段——领域错误都是可读的拒绍，挂上去是重复。

**测试用真实协议 schema 解析每次响应。** `worker-session.test.ts` 驱动真实 `WorkerSession` + 真实 `WorkerService`（真 SQLite、真模板、真规则），然后**把服务端发出的每条消息用 `SessionOutboundMessageSchema` 解析一遍**。手写 fixture 会在形状漂移后继续通过，这一步让服务端与协议契约按构造成立。

验证：

```
npx vitest run packages/server/src/server/worker/ \
  packages/server/src/server/session/worker/ \
  packages/server/src/server/agent/permission-response.test.ts \
  packages/server/src/server/agent/mcp-server.test.ts --bail=1
→ 9 files / 218 tests passed
npx vitest run packages/protocol/src/messages.wire-compat.test.ts \
  packages/protocol/src/messages.test.ts
→ 36 tests passed
```

**尚未完成：客户端方法与界面。** `DaemonClient` 已加 8 个方法，但 app 侧还没有路由、没有入口、没有屏幕。所以这个切片做成的是**可调用的后端**，不是用户能看见的功能。

### 切片 006：入口与界面（已完成）

按 Owner 最初的要求落地：侧栏一个新入口，跳到独立路由与独立屏幕。

**入口。** `sidebar-nav/model.ts` 的 `BUILTIN_SIDEBAR_NAV_IDS` 加 `workers`，图标 `Users`，标签走 i18n（9 个 locale 全部补了 `sidebar.sections.workers`）。这一条是数据驱动的位置：新增一个 `BUILTIN_ROWS` 成员与一个图标就完成了，没有改侧栏主结构。

**路由。** `packages/app/src/app/workers.tsx`，与 `schedules.tsx` 同形（`HostRouteBootstrapBoundary` 包一个 screen），并在 `_layout.tsx` 的 `shouldShowAppChrome` 里登记——漏掉这一步会得到没有 Chrome 的裸页面。

**数据层。** `workers/aggregated-workers.ts` + `hooks/use-workers.ts`，沿用 schedules 的聚合加载形状：跨 host 扁平列表、单 host 失败不拖垮整屏。

一个与 schedules 不同的语义：**“主机答了但列表为空”与“主机拒绝了请求”是两种状态**，分开报告。前者是“还没建过 worker”，后者是“这台主机不支持 worker”。混在一起会把协议不匹配显示成“空”。

**屏幕。** `screens/workers-screen.tsx`：名册 + 新建卡片（选角色、填名字）。故意只做“看与建”：任务、群、协作都是后续切片，先摆出它们的空控件等于承诺这个域还做不到的事。

**实现过程中撞到并修正的四件事**（都是按仓库实际约定改代码，不是改测试）：

1. **token 名写错。** 用了 `theme.radius.md` 与 `theme.spacing[5]`，实际是 `theme.borderRadius.md`，且 spacing 没有 5 档。
2. **原语签名弄错。** `Button` 用 `leftIcon`（且要传组件引用而非元素），`LoadingSpinner` 必须给 `color`，`EditingTextInput` 是非受控的（`initialValue` 而不是 `value`）。
3. **react-perf 规则。** 内联 JSX 与内联函数作为 prop 会破坏 memoization；按仓库现有屏幕的写法改为组件引用与 memo 变量。
4. **hook 放在提前 return 之后。** `useMemo` 写在条件返回之后会改变调用顺序，提到最前。

**跨包声明陷阱（遇到一次）**：app 依赖 client 的 `dist` 声明，所以新加的 `DaemonClient` 方法在重建 `@bytetrue/client` 前对 app 不可见。`npm run build:client` 后消失。这是仓库已知的约束，不是代码问题。

验证：

```
npm run typecheck                    → 0 errors
npm run lint -- <改动文件>          → 0 warnings and 0 errors
npx vitest run packages/app/src/sidebar-nav/model.test.ts \
  packages/app/src/i18n/key-contract.test.ts \
  packages/app/src/i18n/resources.test.ts --bail=1
→ 3 files / 43 tests passed
```

i18n 的 key-contract 测试扫描 `t("…")` 字面量与 en 资源树的一致性，所以新增的标签不可能只在部分语言生效而无人发现。

### 界面验证（在真实浏览器里跑通）

构建产物未生成，所以用 `npm run dev:app` 起 Expo 连开发 daemon（6778），在真实浏览器里验证。**验证结果：侧栏入口、路由、名册、新建表单、以及一次真实创建全部跑通。**

最终确认的行为：

- 侧栏出现 **Workers**，点击进入 `/workers`；
- 名册列出真实数据（`Alice / Frontend Developer`）；
- **New worker** 打开表单，八个角色全部渲染并带技能数（Software Developer 8、Frontend Developer 7…）；
- 填名、选 **DevOps Engineer**、点 **Create** → 真实创建成功，名册出现 `Bob / DevOps Engineer`；
- daemon 日志证实 `worker.worker.create.request → response`、`worker.template.list.*`、`worker.worker.list.*` 成对往返。

### 验证过程中发现并修掉的两个真缺陷

这两个都是我自己刚写的代码里的，且都只有在真浏览器里才会暴露。

**一、把过渡态当成终态。** 屏幕在 `connecting` 时显示 “Connect to a host to manage workers.”——这句话读起来是给用户派任务，但用户无事可做；而且每一次重连都会闪一次。改为按 schedules 屏幕的现有语义处理：**`connecting` 与 `loading` 同样显示加载态**。

**二、把 offline 当成 connecting。** 原实现只要没有任何 host 可问就返回 `connecting`。但“所有 host 都离线/出错”与“还在握手”是两件事：前者是已加载状态（空名册 + host 错误），后者才是过渡。把 offline 归为 connecting 会让屏幕永久转圈，因为状态再也不会变得更“可问”。改法与 schedules 一致：**只有在“没有可问的 host”且“至少一个还在 settling”时才是 connecting**。这条改动让一条既有用例失败了——它编码的正是旧错误行为，已修正。

**三、重连会抹掉已加载的名册。** 连接状态进了 query key，而重连不是瞬时的：状态先报 `connecting` 再回到 `online`。在那段窗口里取到的 fetch 合法地回答“仍在连接”，若让它覆盖一份本来正确的名册，每次闪断都会清空屏幕。现在**保留最近一次成功的 payload 直到有新的成功结果**。

### 切片 007：独立 console 页（已完成）

**Owner 纠正了我对形态的理解。** 先前做成的是嵌在 BySpace 壳里的一个路由；Owner 要的是：点 Workers 后**进入一个完全独立的新页面**，长得像 QoderWake，并带一个能跳回 BySpace 的按钮。

**关键改动是把壳换掉。** `/workers` 不再出现在 `_layout.tsx` 的 `shouldShowAppChrome` 里，因此 BySpace 的工作区侧栏在这个路由上不渲染；页面自建侧栏（BySpace 返回 / Work management / Workers & capabilities），并在左上角提供返回。

理由是两套导航模型不兼容：BySpace 侧栏回答“我在哪个 workspace”，而这个页面横跨所有已连接 host，词汇也不同（worker / task / capabilities）。同时摆出来等于把两个无关的导航树并在一屏。

**页面内容按参考产品对齐：**

- **Dashboard**：标题 + 副标题；Task records 卡（四格统计 + 一句状态描述）；Needs attention（Action required / Review results 两个 tab）;All tasks。
- **Worker management**：名册 + 内嵌新建卡（选角色、填名），侧栏带数量徒标。
- **Capabilities & resources**：空态（技能与连接器属后续切片）。

**新增 `worker.task.list` RPC。** Dashboard 的统计和任务表需要跨 worker 的数据；逐个 worker 取会让屏幕开销跟名册大小跑。支持全量与单 worker 两个范围。

**两处有意的取舍：**

- **任务取数失败不拖垮名册。** worker 与角色目录是主路径（没有它们就没名册）；任务是尽力而为，取不到就退化成空列表，而不是把整台 host 报成坏掉。有用例钉住。
- **协议只导出真正被用的推断类型。** 我一开始导出了 8 个，检查后发现 7 个无人引用——那是投机导出，已删。

**一个我自己造成的误导，如实记录：** 我曾把 `worker.task.list` 报的 `unknown_schema` 归因为“入站 AOT 白名单没生成”。**那是错的**：查时间戳发现 daemon 启动（13:14）早于该 RPC 加入（14:18），是跑着的服务比代码旧。重启后同一请求立刻通过；并且入站根本没有 AOT 生成（只有出站有）。教训是**先取证、后归因**，而不是反过来。

验证：

```
npx tsx src/server/worker/verify-worker-rpc.e2e.ts
→ 15 项全通（新增 task.list 全量与单 worker 两个范围）
npx vitest run packages/app/src/workers/ packages/app/src/sidebar-nav/ \
  packages/app/src/i18n/key-contract.test.ts \
  packages/server/src/server/worker/ packages/server/src/server/session/worker/ --bail=1
→ 11 files / 133 tests passed
npx vitest run <protocol 与 agent 相关四个文件> → 158 tests passed
```

**浏览器里逐项确认：** 点侧栏 Workers → BySpace 侧栏消失、进入独立页；Dashboard 显示真实数据（1 Total / 1 Active / “1 task in flight”）；All tasks 列出 `Build the pricing table / assigned`；Worker management 列出 Alice、Bob 与计数 2；点 **← BySpace** 回到 BySpace 且侧栏恢复（含 Workers 入口）；再点可重新进入。

**一个未完全定性的点，如实记录：** 让查询在 host 转为 online 时重新取数的触发不可靠（观察到运行时已是 `online` 而 fetch 仍看到 `connecting`）。我用**“未加载则每 2s 重试、加载后停止”** 的轮询代替它：这是自愈的，且因第二项修正而在 offline 时也会终止（offline 返回 `loaded`）。**精确的反应性缺口没有根因定位**，这是当前的已知不足，不是已验证的结论。

### 真实链路验证（发现并修掉一个真缺陷）

构建产物没生成，所以浏览器里看不到页面。改为直接跑一遍**客户端真正走的那条路**：`verify-worker-rpc.e2e.ts` 起一个真实 daemon、真实 socket、真实 `DaemonClient`，两端都过真实协议 schema。

```
npx tsx src/server/worker/verify-worker-rpc.e2e.ts
→ 13 项全通
```

**这次验证抓到一个真缺陷，而且是我自己写的代码里的。**

原本我只校验“这条边合不合法”。于是 `submitted → completed`（合法边）配上**错误的动作名** `submit_task`（真正产生该转移的是 `accept_task_result`）也通过了——**历史里会记下一条不真实的动作**。audit trail 记的东西不是真发生的事，那它就不是 audit trail。

修法：新增 `assertActionMatchesTransition`，要求动作必须是产生该转移的那个。

改完之后一个既有用例失败了，它暴露了边界：**幂等重试是合法的**——对已 assigned 的任务重发 `assign_task` 应该放行。所以同一状态的到达分三种情况：

- 动作等于**产生当前状态的那个动作** → 幂等重试，放行，不写历史；
- 动作是 `report_progress` → 进度报告，放行，不写历史；
- 其他 → 拒绝。它声称发生了没发生的事。

判定“产生当前状态的动作”需要读历史，所以这个判断交给**唯一的状态写入入口**（它能读同一事务里的历史），而不是纯函数。

新增 3 个用例：合法边配错动作被拒且状态与历史均不变；同一状态配无关动作被拒；in-flight 任务的进度报告放行。

### 切片 008：项目组（存储 + 协议 + 界面）

**Owner 裁决：B 为主线（协调者自己建组拉人），A 为兜底（手工建组）。** 本切片做的是 A——它既是可用能力，也是 B 所需的地基。

**数据库强制的约束。** "谁负责"必须可信，所以让它**在 schema 层不可表示**，而不是靠应用代码检查：

```sql
CREATE UNIQUE INDEX idx_worker_group_one_coordinator
  ON worker_group_members(group_id) WHERE role = 'coordinator';
```

为此做了三件事，缺一不可：实测 SQLite 确实执行部分唯一索引；写一条**绕过 store 检查、直接 INSERT** 的用例证明约束真的成立（否则注释是空话）；把"两个协调者"和"重复成员"分开测——第一版脚本用同一个 worker 同时触发两条规则，结果只测到了"已是成员"，协调者分支根本没被执行。

**两处建模决定。** 组绑的是 `project_id` 而不是路径，checkout 移动后组仍指向同一项目；`workspace_id` 可空，名册先于具体工作目录存在。

**协议与界面。** 4 对 RPC（list / create / add_member / remove_member），create 支持**一次调用带完整名册**，协调者建队只需一步。console 新增 Groups 分区（计数徽标），创建表单可选项目、指定协调者、勾选成员。

**被测试抓出的三个真问题：**

1. **roster 顺序不确定。** 原本按 `joined_at, worker_id` 排序，但 worker id 是随机十六进制，同毫秒加入的成员**每次读取顺序都可能不同**。改按 `rowid`（插入顺序）——这才是"名册"的意思。
2. **schema 版本号没随升级记录。** 建表用 `IF NOT EXISTS` 所以表会出现，但版本停在 1，将来真需要迁移时会重复执行同一步。补了版本分支，加"升级后旧数据仍在"的用例。
3. **我自己写的 Chip 有个静默 bug（浏览器验证才发现）。** 它有个"聪明"的默认 `value ?? label`：成员 chip 传了 `value`，项目与协调者 chip 没传，于是**存的是显示名而 `selected` 比的是 id**，那两个 chip 永远选不中、Create 按钮永远禁用。控制台只显示"未选中"，没有任何报错。修法是**删掉默认值、让 `value` 必填**——这类 bug 就不再有静默的可能。

**验证：**

```
verify-worker-rpc.e2e.ts → 18 项全通
  （新增 create group / 第二协调者被拒 / 加成员 / 列出）
worker 相关 vitest        → 9 files / 144 tests
typecheck 0 错误 / lint 0 错误 / format 全通过
```

**浏览器端到端确认：** Groups 分区 → New group → 填名、选项目（byspace）、指定协调者（Alice）、勾选成员（Bob）→ Create → 列表出现 `Pricing page / Coordinator: Alice / +1 member`。数据库落盘核对一致：

```
grp_8d892296073b | Pricing page | prj_405024cae814dd4f | active
  wkr_4383c89da6c9 | coordinator   (Alice)
  wkr_e813856df209 | member        (Bob)
```

### 关于 B（协调者自己建组拉人）：方案已定，改为照搬上游

**Owner 指出 QoderWake 是用 CLI + skills 实现的，要求直接参考而非自创。核对后确认 Owner 正确，我此前的"worker 工具目录"方案是在重新发明轮子。**

上游做法（一手证据在 `builtin-skills/qoderwake-cli/SKILL.md`）：waker **通过 `qoderwake` CLI 干活**（`waker create`、`group create --waker`、`group add-waker` 都是命令行），CLI 在 agent 的 PATH 里，身份从环境变量注入；**skill 只是说明层**，告诉 agent 该跑哪些命令、有什么安全规则（如"创建员工前必须二次确认"）。**没有专门的 agent 工具 API**——agent 本来就有 Bash。

BySpace 两侧都已具备同样机制：`packages/cli` 与 `skills/` 目录。因此 B 的实现路径是：

1. **给 BySpace CLI 补齐组与 worker 的管理命令**（现无）。
2. **写一份 worker 侧的 skill** 说明命令与规则。
3. 让 worker 的角色模板带上它。

**安全边界要写清：** 上游自己明确区分"对话规则"与"daemon 权限裁决"，并声明 skill 里的确认要求**不改变**运行时权限。BySpace 同理——skill 是给模型的规则，真正的边界在 daemon 权限层。这也正是仍开放的"worker 能否创建 worker"那条待定项。

### 切片 009：worker 执行接线（任务真的能跑）

**做法：不新建执行机制，复用调度器那条路。** worker 任务就是"带角色的 agent session"，所以 runner 直接用调度器在用的同一个 `createAgent` 命令与 `runAgent` / `waitForAgentEvent` 配对，于是**自动继承**守护进程的工作区处理、权限请求、取消与通知语义。第二种执行路径意味着第二处会漂移的东西。

**输出映射是这一刀真正的内容**（三个结果都通向任务状态机）：

| run 结果               | 任务状态    | 为什么                                              |
| ---------------------- | ----------- | --------------------------------------------------- |
| 提交成功               | `submitted` | 有产出待评审                                        |
| 等权限裁决 / 被取消    | `blocked`   | **没产出**。报到 `submitted` 会把半成品塞进评审队列 |
| 创建会话或初始提示失败 | `blocked`   | 失败是人要处理的事，任务得留在可见处而不是消失      |

**测试抓出一个真缺陷——而且是我自己在切片 001 写的状态机。** `blocked` 当时**只能从 `submitted` 到达**，但上表里三个结果有两个需要直接从 `assigned` / `in_progress` 进入。这不是测试写错：要求一条失败的 run 先"假装提交"再阻塞，等于在审计流水里记下一次并未发生的提交。已给 `assigned` 与 `in_progress` 补上到 `blocked` 的边与 `block_task` 动作，并在状态机测试里加了对应断言。

注意那张**穷举负例测试**（对九态做叉积，断言表里没有的边一律非法）当时立刻红了——它是一份独立复述，正是它把这次改动挡下来要求我显式确认，而不是让新边悄悄溜进去。

**测试策略：** runner 测试里 agent 创建/运行/等待都是假的（它们本来就是守护进程的能力），但服务的 `runTask` 测试**用真 store**——"跑完留下正确状态、且每一步都在 history 里"只有对真实转换写入器才有意义。

**验证：**

```
worker 相关 vitest         → 9 files / 141 tests
新 runner 测试            → 9 项
新 service 测试           → 8 项
typecheck 0 错误 / lint 0 错误 / format 全通过
```

**新增 `worker.task.run.request/response` 一对 RPC**，权限按 `workspace.write`（起 run 会在工作区里创建 agent session，和其他写操作同权），`bootstrap` 里注入 runner。

**顺带修掉一个环境问题：** 上一轮 `pkill` 停掉 daemon 后 `.dev/byspace-home/byspace.pid` 成了陈旧文件（PID 已死、端口已空），新 daemon 因此拒绝启动并报 "Another BySpace daemon is already running"。已确认 PID 无对应进程、6778 无监听后清除。**记一笔：判断 pid 文件是否陈旧，要比对进程存活与端口监听，而不是只看文件是否存在。**

### 切片 010：CLI 命令 + worker skill（B 的本体）

**照搬上游，不自建 worker 工具 API。** QoderWake 的 waker 用 `qoderwake` CLI 干活，skill 只说明该跑哪些命令与安全规则；agent 本来就有 Bash。BySpace 两侧都已具备，这一刀把缺的部分补上。

**1. `byspace worker` 命令组**（对齐上游 `waker` / `group` 的形状）：

```
worker templates                 角色与其技能（角色在创建时固定，所以这是创建前该看的）
worker ls
worker create --name <n> --template-id <role> [--workspace-path <p>]
worker task ls|create|run        run 阻塞到任务落定，返回最终状态
worker group create --name <n> --project-id <p> [--goal] [--coordinator] [--member ...]
worker group ls|add-worker|remove-worker
```

上游叫 `add-waker`，BySpace 的实体叫 worker，所以是 `add-worker --worker`；命名差异是有意的，不保留 `waker` 别名（那是上游实体名，不是 BySpace 的）。

**2. `skills/byspace-worker-team/`**（SKILL.md + `references/commands.md`）：

- **动手前先跟用户确认**建员工 —— 上游 `waker create` 的规则原样搬。"这会花掉别人的钱、往名册里塞人"。
- **明写这条是对话规则，不是权限系统**（上游自己就这么写）：它不阻止你跑命令，也不改变 daemon 允许什么；真正的边界在 daemon 权限层。这正是此前悬着的"worker 能否创建 worker"的答案 —— 照上游，由权限层裁决，不靠文案。
- **`blocked` 不是完成**：三种状态的含义与处置列成表，因为把没产出的 run 报成完成是这条链路最容易犯的错。
- 技能**随 bundle 目录自动被收录**（`listBundledSkills` 读目录即目录清单，无硬编码名单），`build:server` 会把 `skills/` 拷进发行物。已实测两处：dist 里有 `SKILL.md` + `references/commands.md`；`getSkillsStatus` 的 `available` 含 `byspace-worker-team`。

**验证（全部对真实 daemon、真实 CLI，不是单测）：**

```
worker templates                 → 8 个角色（含技能列）
worker create ×3                 → Alice/Bob/Carol
worker group create（一次带齐名册）→ grp_bab998fa92a8，coordinator:wkr_97a0… + 2 member
worker group add-worker --role coordinator（组外的新 worker）
                                 → 被拒："already has a coordinator. A group has exactly one."
worker task create + run         → submitted
  历史：planned->in_progress(ack_task), in_progress->submitted(submit_task)
  真跑出的 agent：03bda17「Draft the pricing table spec」，provider pi/bytetrueapi/claude-sonnet-5
```

**测试里踩了一次和切片 008 同一个坑。** 第一次测"第二个协调者被拒"时，我用了一个**已在组里**的 worker，于是命中的是「已是成员」规则，**协调者规则根本没被执行**。换成一个组外的 worker 才真正触发。同一个陷阱犯了第二次，说明凡是"测某条规则"的用例，都必须先确认**这条规则是此时唯一能挡住的规则**。

**typecheck 0 错误 / lint 0 错误 / format 通过 / CLI 与 worker 相关 vitest 34 files 334 tests。**
