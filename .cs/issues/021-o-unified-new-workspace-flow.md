---
kind: issue
title: "统一 New workspace 的 Project-first 创建流程"
type: feature
status: closed
created: 2026-08-05
epic: ""
---

# 统一 New workspace 的 Project-first 创建流程

## 目标

用户无论从 Workspaces 标题栏 `+`、Project 行 `+` 还是 `Cmd/Ctrl+N` 进入，都使用同一个 Project-first 创建界面：有可靠上下文时直接预填 Project 与 Host；没有当前 Workspace 上下文时先选择 Project；Host 只在所选 Project 有多个可用位置时出现，Isolation 与 Base branch 保持为同一 Composer 上的次级选项。

## 范围

- 包含：
  - Project 行 `+` 以聚合 `projectKey` 进入统一 `/new` 流程，不再静默选择 Project 的第一个 Host。
  - `Cmd/Ctrl+N` 从当前 Workspace 进入时继续携带当前 Project/Host；没有当前 Workspace 上下文时打开 Project picker，不沿用已过时的 remembered Project。
  - Workspaces 标题栏提供常驻的全局 `+` 图标按钮，复用 `Cmd/Ctrl+N` 的上下文语义，保证普通浏览器也有可见入口。
  - Project picker 跨 Host 展示所有至少有一个可创建位置的 Project；选择 Project 后再推导 Host。
  - 单一可用 Host 自动选择且隐藏 Host 控件；多 Host 只有当前 Workspace 携带的显式 Host 可免选，否则一律要求用户选择。
  - Isolation 继续作为内联 `Local / Worktree` 控件；Base branch 仅在 Worktree 时出现。
  - 保持草稿、Provider/Agent 控件、创建空 Workspace 与创建首个 Agent 的既有行为。
- 不包含：
  - 恢复独占整行空间的全局 `New workspace` 行。
  - 改变 Workspace/分支命名、worktree 创建协议、Provider 选择或 Agent 创建生命周期。
  - 新增创建向导、额外确认页、Project 搜索入口或新的服务端能力。

## 归属

- 独立 issue。
- 相关 spec：`.cs/spec/index.md` 的「侧栏 Workspace 导航」。

## 背景与证据

- 用户确认侧栏顶部全局按钮可以删除，但指出当前仍存在两种认知路径：Project `+` 已知 Project；全局入口则让用户在中间页面依次处理 Host、Project、Worktree。
- 两个入口底层已经共用 `NewWorkspaceScreen`，分歧来自入口上下文和表单选择顺序，不需要第二套创建能力。
- 当前 Project 行 `+` 经 `resolveNewWorkspaceTarget()` 取第一个可创建 Host，再把 Host-local `projectId` 与路径写入 `/new`；聚合 Project 跨多个 Host 时，这是无用户意图的静默选择。
- 当前 plain `/new` 使用 remembered Workspace 推导 Host 与 Project，并按 Host 过滤 Project；没有当前 Workspace 上下文时可能把过时选择当作当前意图。
- 当前 Host 控件按全局 Host 数量显示，而不是按所选 Project 的可用 Host 数量显示。

## 现状如何工作

Project `+` 或 `Cmd/Ctrl+N` 构造 `/new` 参数；`NewWorkspaceScreen` 先选 Host，再把 Project 列表过滤到该 Host，并从 route Project、remembered Project 或首个 Project 中选一个；随后显示 Project、全局 Host、Isolation 与 Base 控件。

## 影响范围

- 必须修改：
  - `/new` app-local route 参数与 `buildNewWorkspaceRoute()`。
  - Project 行创建 target 与导航。
  - New Workspace 的 Project/Host 选择策略及表单可见性。
  - 相关 i18n 文案与可访问性名称。
- 需要验证：
  - 当前 Workspace 的 `Cmd/Ctrl+N` 仍准确预选。
  - Project `+` 仍准确预选且跨 Project 导航不会保留旧手动选择。
  - plain `/new` 自动打开 Project picker，不偷用 remembered Project。
  - 单 Host 隐藏、多 Host 歧义要求选择；Project 变化后 Host 与 git-only 控件正确重算。
  - Project/Host 变化不清空正在编辑的 Composer 草稿。
  - 既有创建空 Workspace、创建 Agent、Isolation 记忆与 branch/PR 起点行为不回归。
- 仍待调查：无。

## UI 变化

- 角色与入口：侧栏 Project 行 `+` 是可见上下文入口；`Cmd/Ctrl+N` 是全局加速入口；二者落到同一界面。
- 图示状态：目标。

```text
显式 Project 上下文                     无当前 Workspace 上下文
Project [+] / Cmd+N                     Cmd+N
          │                                  │
          ▼                                  ▼
┌─ New workspace ───────────────────────────────────────┐
│ [Project ▼] [Host ▼]* [Local/Worktree ▼] [Base ▼]** │
│ ┌───────────────────────────────────────────────────┐ │
│ │ Message agent…                                    │ │
│ └───────────────────────────────────────────────────┘ │
│                                [Create / Start agent] │
└───────────────────────────────────────────────────────┘

*  仅所选 Project 有多个可用 Host 时显示；无可靠默认时自动展开并要求选择。
** 仅 Worktree 时显示。
无 Project 上下文时，界面打开后 Project picker 自动展开。
```

- 交互与关键状态：
  - Project `+` 只携带聚合 `projectKey`；单 Host 自动落定，多 Host 一律要求用户明确选择。
  - `Cmd/Ctrl+N` 只有在当前 Workspace 可作为创建上下文时才携带 Project/Host；否则进入未选 Project 状态。
  - 多 Host 且无可靠上下文时，Host trigger 显示 `Choose host`，在用户明确选择前不得创建到临时推导的 Host。
  - Project picker 选择会关闭自身并重算 Host；若新 Project 仍有 Host 歧义，立即打开 Host picker。
- 稳定约束：
  - 单一 `NewWorkspaceScreen`，不新增 wizard 或中间页。
  - Project 是第一信息层级；Host、Isolation、Base 是后续上下文。
  - 用户已输入的文本与非目标绑定附件不会因 Project/Host 变化丢失；目标绑定的 PR 上下文继续按既有规则清理。
  - 独占整行空间的全局 `New workspace` 行保持删除；全局入口位于 Workspaces 标题栏图标区。
- 仅作示意：控件精确宽度、间距和按钮文案沿用现有设计系统。

## 质量目标

- 创建效率：
  - 目标：显式上下文入口无需重复选择；无上下文入口只先要求 Project，Host 仅在真实歧义时介入。
  - 来源：用户决定。
  - 预期证据：定向 Playwright 覆盖 Workspaces 标题栏 `+`、Project `+`、有/无上下文快捷键及单 Host 可见性。
- 用户差错防御：
  - 目标：聚合 Project 多 Host 时不再静默取数组第一项；未确认歧义 Host 时不能创建。
  - 来源：本次风险扫描。
  - 预期证据：纯策略测试覆盖显式当前 Host、唯一位置、多位置强制选择，以及不同连接状态；浏览器断言 `Choose host` 状态。
- 状态连续性：
  - 目标：late hydration、Project/Host 切换与 route 复用不覆盖用户草稿，也不保留错误 Project/Host。
  - 来源：`docs/forms.md` 与既有回归契约。
  - 预期证据：既有 draft/route reset 定向 Playwright 与纯选择测试。
- 包容性与本地化：
  - 目标：新增或变更的 Project/Host picker 文案、按钮名称和空状态走八语言资源；键盘打开与焦点行为保留。
  - 来源：`docs/i18n.md`、现有可访问性契约。
  - 预期证据：资源 parity 测试及 Playwright 的 role/focus 断言。

## 方案判断

- 不把多个入口误当成多套流程：保留标题栏全局 `+`、Project 上下文 `+` 与全局快捷键，但统一 route 语义、Project-first 选择策略和 Composer。
- Host 是 Project placement，不是创建流程的第一层筛选器。Project 选择必须先于 Host；Host 列表只来自所选 Project 的可创建 placement。
- 使用可选 app-local `projectKey` query 参数表达聚合 Project，不复用 Host-local `projectId`。既有 `serverId + dir + projectId` 调用继续兼容，用于当前 Workspace、fork/setup 等明确 Host 上下文。
- 不重写整个 New Workspace form model；抽取并测试纯 Project/Host 选择策略，最小改造现有表单状态，避免把本次交互改变扩大成全屏重构。

## 实现设计

### 这次要怎么做

1. 为 `/new` 增加可选 `projectKey`，Project 行 `+` 只传该键；旧 route 参数继续解析。
2. 将“哪些 Host 可创建此 Project”收敛为 Project 模块的单一策略，供侧栏、Project picker 与 Host resolution 复用。
3. Project picker 从所有可创建 Project 中选择，不再由当前 Host 先过滤；无显式 Project route 时初始不选 Project。
4. 在 Project 选定后解析 Host：显式当前 Workspace Host → 唯一 Host → 多 Host 明确选择；不根据最近使用或在线状态猜测。
5. Host 控件只接收该 Project 的 eligible Hosts；歧义时显示 `Choose host` 并阻止提交落到 provisional Host。
6. 保持 Isolation、Base、Composer 与创建请求使用最终确认的 `selectedServerId + selectedSourceDirectory`。

### 功能 / 责任怎么分工

- Project 模块：定义 placement 是否可创建 Workspace。
- New Workspace 纯策略：根据 Project、显式 route Host 与可创建位置解析 Host 候选与是否需确认。
- Project picker：只拥有 Project 选择，不再拥有 Host-first 过滤。
- Screen：组合选择结果、打开对应 picker、渲染并提交；不复制策略判断。

### 请求 / 数据 / 调用怎么走

```text
Header + ─ global/current context ─┐
Project + ── projectKey ──────────┤
                                      ├─> /new ─> choose Project ─> resolve Host ─> Composer ─> existing create RPC
Cmd+N ─ explicit context ─────────┘                     └─ ambiguous ─> Host picker
Cmd+N ─ no context ─> /new ─> Project picker
```

### 哪些边界不碰

- 不改 daemon/protocol。
- 不改创建 Workspace/首 Agent 的 RPC、错误反馈和导航归属。
- 不改变 Isolation 记忆语义与 branch/PR 起点解析。
- 不恢复独占整行的全局入口，不新增搜索或额外设置。

### 质量目标如何落实

- 选择策略做成纯函数并覆盖每个决策分支。
- 入口和草稿生命周期使用现有真实浏览器/daemon Playwright 契约。
- 歧义 Host 使用显式未确认状态，提交边界再次校验。
- 所有新增客户端文案进入八语言资源。

### 一步步怎么改

1. 先改纯策略与 route/侧栏模型测试，确认旧的任意首 Host 行为失败。
2. 接入 `projectKey` route 与 Project-first picker，更新入口 E2E。
3. 接入 Host resolution、条件 Host 控件与提交校验，补多 Host 策略测试。
4. 验证 Project/Host 变化的草稿、Isolation 与创建主路径。
5. 跑定向测试、全仓 typecheck/lint/format 与 Web export，独立复审。

### 怎么确认做对

- Workspaces 标题栏 `+` 在普通浏览器中常驻可见，并与 `Cmd/Ctrl+N` 使用同一上下文解析。
- Project `+` URL 不再携带任意 Host/path，且目标 Project 已选。
- 当前 Workspace 的 `Cmd/Ctrl+N` 仍预选当前 Project/Host。
- plain `/new` 显示 `Choose project` 并自动聚焦 Project 搜索，不显示无关 Host。
- 单 Host Project 不显示 Host；歧义 Project 显示并要求 `Choose host`。
- 选择 Project/Host 后 Composer 草稿不变，创建落到所选 Host-local projectId/path。

## 验证

- 定向纯策略测试通过：5 个文件共 75 项；覆盖 aggregate `projectKey` route、eligible placements、显式当前 Host、唯一位置、多位置无条件确认、零 eligible Host、连接状态、opaque key、含冒号 Host ID 与侧栏 target。
- 最终定向 Playwright 通过：3 个文件共 10 个创建流场景；覆盖 Workspaces 标题栏 `+`、Project `+`、当前 Workspace `Cmd/Ctrl+N`、plain `/new` 自动打开并聚焦 Project picker、route 复用、单 Host 隐藏、多 Host 明确选择、草稿保留，以及创建请求落到所选 Host-local project/path。
- `npm run typecheck`、`npm run lint`、`npm run format:check` 全部通过。
- `npm --workspace packages/app run build:web` 通过，真实 Web export 产物生成。
- correctness review 与 ponytail review 并行完成：修复 accessible-name locator、opaque `projectKey`、跨 Host 创建落点回归覆盖、含冒号 Host ID 的 pending-archive 解析与验证记录；删除失去生产调用的 Host-first/remembered-context 策略、无调用 helper 及冗余测试。最终复审无 Medium+，ponytail 无剩余 finding。
- 人工 UI 验收：用户确认通过。

## 执行记录

- 2026-08-05：用户确认 Project-first 统一方案并授权实施；创建独立 feature issue，保持顶部全局按钮删除。
- 2026-08-05：用户进一步确认多 Host Project 不采用最近使用或唯一在线推断；除当前 Workspace 显式 Host 外，多位置一律要求明确选择。
- 2026-08-05：删除 recent/unique-online Host 推断及其 last-workspace 接线；多 Host 浏览器回归、当前 Workspace 快捷键回归与全量质量门通过。
- 2026-08-05：用户指出普通浏览器无法可靠使用系统占用的 New Workspace 快捷键；在 Workspaces 标题栏图标区恢复全局 `+`，但不恢复独占整行入口。
- 2026-08-05：用户完成 UI 验收；并行 correctness/ponytail review 后修复全部确认问题，删除已失去生产调用的 Host-first/remembered-context 代码与冗余测试，并重新通过最终质量门。

## 关闭回写

- project spec：`.cs/spec/index.md`；关闭时把稳定的 Project-first 创建入口、Host disclosure 与上下文优先级写入当前产品真相。
- notes：无。
- AGENTS.md / CLAUDE.md：无预期回写。
- tools：无。
