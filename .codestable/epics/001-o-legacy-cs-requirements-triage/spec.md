---
title: 旧 CodeStable 需求盘点与去留决策
status: accepted
kind: epic
owner_decision: approved
approved_revision: c7ca9c333af7983cb327be16c8b492ca38b345cf0a85a655e8ad528309a650cb
accepted_at: 2026-08-31T04:23:08Z
acceptance_evidence:
  owner: "“确认验收”（2026-08-31）"
  review: "subagent run 213f6696-b401-4ec7-ac28-8a0c1c9cb790; verdict=pass; 0 blocking/important"
  verification: "typecheck, lint, format:check, git diff --check passed"
---

# Epic:旧 CodeStable 需求盘点与去留决策

## 背景

BySpace 已从历史定制线切换到 Paseo `v0.7.0-beta.2` 干净基线，并完成最小品牌、运行时隔离、发布和上游同步能力。旧归档中的 CodeStable 文档同时包含产品需求、一次性迁移任务、已被上游实现的能力和后来被 reset 移除的定制功能，不能按旧状态直接恢复。

本 Epic 只建立当前路线图真相。它不搬运旧代码、不把旧 `closed` 当作当前已完成，也不因当前代码里缺少某功能就自动判定需要重做。

## 语料与证据优先级

归档语料共 78 个 Markdown 和 1 个 Terminal benchmark JSON：

| 语料族                                    |                 数量 | 作用                         |
| ----------------------------------------- | -------------------: | ---------------------------- |
| `codestable/vision`、`spec`               |                    2 | 历史产品边界                 |
| `codestable/talks`                        |                    3 | 历史设计讨论，不直接成为需求 |
| `codestable/notes`                        |                    1 | 历史测试经验，不直接成为需求 |
| `epics/001-o-clean-beta1-rebuild`         |                    1 | 一次性基线重建               |
| `epics/002-o-terminal-experience`         | 17 Markdown + 1 JSON | Terminal 能力与基线证据      |
| `epics/003-o-ci-cd-release-latency`       |                    6 | 历史发布/CI 优化             |
| `epics/004-x-private-remote-web-services` |                    3 | 私有远程 Web 服务/Data Relay |
| `codestable/issues`                       |                   45 | 功能、修复、迁移和 UI 记录   |

证据顺序：

1. 当前 `main` 的行为、测试与现行 `docs/`。
2. reset 前最新产品快照 `ef1f2ac4d418b0bfc0fdb4ca1afd30e4ef9f844f`，只用于证明“曾实现”。
3. `origin/archive/node-main-v0.6.1-before-v0.7.0-beta.2-reset:codestable` 的历史意图。
4. `sync/paseo-v0.5.1` 只做交叉核对；其 `codestable/` tree 与 archive 完全一致，不重复计数。

禁止使用旧 97 文件 requirement matrix 代替本轮证据。

## 判定模型

盘点使用两个相互独立的维度，不能把“代码里存在相似机制”直接推导成“需求不再需要”。

### 证据状态

每份文档先记录客观状态：

1. **一次性执行记录**：特定版本同步、基线重建、目录迁移或已经完成的发布操作。
2. **当前行为已验证满足**：当前行为达到原始用户验收，不只是在源码中发现同名模块。
3. **当前存在相似能力但未验证等价**：必须保留原需求，等待行为或性能复核。
4. **当前明确缺失或回退**：reset 后实现不在，或用户仍能复现原问题。
5. **证据不足**：没有足够的当前行为证据，不得推断完成或无价值。

### Owner 去留决定

除明确的一次性执行记录外，所有产品能力、体验优化、Bug、性能问题和未完成验证项都必须完整展示给 Owner。最终去留只由 Owner 选择：

- **保留并实施**
- **已满足，接受关闭**
- **待复现/待验收**
- **暂缓**
- **明确放弃**

审计者可以解释成本、重用机会和同步风险，但不得替 Owner 用“个人项目”“维护成本”或“上游已有相似结构”删除需求。

## 已纠正的第一轮误判

第一轮提案中的自动去留结论全部撤回，只保留可验证的事实。特别纠正：

1. **Terminal 整体保留。** 旧 `epics/002-o-terminal-experience`、Terminal 截图粘贴、Windows 输入与延迟、retained renderer、revision 恢复、呈现默认值、通知、移动端复制，以及 Pi Terminal agent 状态上报都进入逐项重验。用户当前仍在 Paseo Terminal 复现历史问题，这是当前缺口证据；不能以 worker、snapshot 或 bracketed-paste 模块存在为完成证据。
2. **Service Proxy、Relay 与 Remote Web Services 不是同一能力。** 当前 Relay 只承载 BySpace client 与 daemon 的 E2EE 控制/交互流量；当前 Service Proxy 默认只反代 daemon 本机的 workspace services。旧 Remote Web Services 通过独立 Data Relay 让 daemon A 的本地浏览器访问 daemon B 的 loopback Web 服务，当前 `main` 没有该能力。它必须作为独立产品能力展示给 Owner，不能判为已覆盖。
3. **UI、语音、Forge、发布和侧栏需求不再批量归类。** 每份原始文档都列出后再由 Owner 决定；当前相似方案只能写入证据列。

## 允许直接建议剔除的范围

只有下列类型可以标记为“一次性、建议剔除”，仍会出现在完整清单中供 Owner 查看：

- 已完成且不可重复执行的旧版本同步或基线 reset；
- 旧 CodeStable 目录布局迁移；
- 仅记录某次发布、CI run、PR 收尾或临时验证的操作文档；
- 已被新的 `upstream-sync` / release 流程制度性替代、且不包含独立产品能力的旧操作步骤。

如果文档中同时包含可复用的性能、可靠性或产品约束，约束必须拆出展示，不能随一次性任务一起剔除。

## 完整矩阵格式

最终矩阵对 78 份 Markdown 一份不漏，每行至少包含：

| 字段         | 内容                                                |
| ------------ | --------------------------------------------------- |
| 文档         | 精确归档路径与标题                                  |
| 原始需求     | 用户能观察到的目标，不用实现文件名代替              |
| 历史状态     | 仅作线索                                            |
| reset 前证据 | 是否曾实现、验收或仍未闭环                          |
| 当前证据     | 当前 `main` 的实现、测试、文档和用户复现            |
| 证据状态     | 上述五类之一                                        |
| Owner 决定   | 保留、已满足、待复现、暂缓或放弃                    |
| 后续入口     | 仅保留项对应的 `cs-issue` / `cs-feat`，未决定时为空 |

Epic、Talk、Note、Vision 和 Project Spec 也必须出现在目录中，并明确它们是需求容器、设计依据还是执行记录，避免被误算为独立功能，也避免其内部约束丢失。

## 执行结构

1. 先生成 78 份 Markdown 的无遗漏文档级目录。
2. 按 Terminal、远程访问、Agent/编排、工作区/Git、UI/移动端、语音、发布/CI、品牌/迁移等能力组补齐三向证据。
3. 分组向 Owner 展示全部需求；不再先给默认删除结论。
4. Owner 对每项选择去留，允许整组决定，也允许逐项覆盖。
5. 只对确认保留的能力创建 `cs-issue` / `cs-feat`；本 Epic 本身不恢复 runtime 代码。
6. Epic 完成条件是所有历史文档都有证据和 Owner 决定，不是恢复任意数量的旧功能。

## 最终验收结果

- `requirements-catalog.md` 与 `decision-matrix.md` 覆盖 78 / 78 份历史 Markdown、1 份 Terminal benchmark JSON 和 77 / 77 个原子决策 ID。
- Owner 保留 34 项：T01–T18、R02–R03、A04–A09、W01、W02、W04、W05 中仅“hover 展示该 Workspace 下全部 Agent 精确状态”、W14、U03、U05、B01。
- 其余 38 个产品 ID 不再进入 BySpace 定制 backlog；这不授权删除上游当前已有且仍可用的功能。
- O01–O05 共 5 个一次性历史任务剔除。
- B01 的 Beta Relay 基础设施存在：endpoint 为 `relay-beta.byspace.cc.cd:443`，Worker 为 `byspace-relay-beta`；当前缺口是 `main` 未恢复 prerelease 自动选择 Beta Relay 的版本路由。
- `retained-delivery-index.md` 将 34 / 34 个保留 ID 唯一映射到 21 个后续 `cs-issue` / `cs-feat` 入口；只有实际启动某一入口时才创建临时 work 游标。
- 最终独立验收审查 run `213f6696-b401-4ec7-ac28-8a0c1c9cb790` 返回 `verdict=pass`，无 blocking 或 important finding。Owner 于 2026-08-31 明确确认验收。

## 永久交付索引

- 原始需求与归档来源：[`requirements-catalog.md`](requirements-catalog.md)
- reset 前、当前 `main` 证据与最终去留：[`decision-matrix.md`](decision-matrix.md)
- 保留能力的后续执行入口：[`retained-delivery-index.md`](retained-delivery-index.md)

## 验收标准

- 78 个历史 Markdown 和 1 个 benchmark JSON 全部有唯一归属。
- 每一份产品需求都向 Owner 展示；只有明确的一次性执行记录可以直接建议剔除。
- “曾实现”“当前存在相似机制”“当前行为已满足”分别提供证据，不混写。
- Terminal 的性能、正确性、截图粘贴、Pi activity、Direct/Relay 和跨平台边界完整保留并逐项复核。
- Remote Web Services 与当前 Relay/Service Proxy 分开说明和决策。
- 每个最终放弃项都有 Owner 明确决定；沉默不视为放弃。
- Epic 不直接修改 runtime、协议、UI 或发布流程。

## 风险与停止条件

- 若找不到 reset 前证据，标记“证据不足”，不得推断未实现。
- 若当前上游能力语义不同，只记录“相似但未验证等价”，不得自行判为取代。
- 若用户报告当前仍有问题，优先记录为未闭环证据，不以旧测试或当前静态结构覆盖。
- 若恢复会扩大协议或长期同步冲突面，先解释风险，再由 Owner 决定。
