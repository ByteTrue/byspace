---
kind: issue
title: "提高侧栏 Workspace 信息获取效率"
type: feature
status: closed
created: 2026-08-05
epic: ""
---

# 提高侧栏 Workspace 信息获取效率

## 目标

侧栏只保留以 Project 为基础的单一信息结构，用户无需搜索或理解五种内部状态，就能先看到正在等待自己处理的 Project 与 Workspace，并在 Hover 中查看一个 Workspace 下所有 Agent 的精确状态。

## 范围

- 包含：
  - 删除 Project / Status 分组切换，侧栏只保留 Project 结构。
  - 将 Project 分为 `Needs attention` 与 `Other projects` 两个连续区域，同一 Project 只出现一次。
  - 任意未归档 Agent 等待输入、权限、失败或等待检查时，其 Workspace 与 Project 进入 `Needs attention`。
  - `Needs attention` 按最早等待时间排序；`Other projects` 按最近 Agent 活动排序；无 Workspace 的 Project 沉到末尾。
  - Project 内待处理 Workspace 优先并按最早等待排序；`Other projects` 中保留用户显式置顶覆盖，其余 Workspace 按最近 Agent 活动排序。
  - 删除空 Project 下独占一行的 `New workspace`，保留 Project 行的 `+`。
  - Project 行显示需要处理的 Workspace 数；Workspace 行优先显示需要处理的 Agent 数，否则显示正在工作的 Agent 数。
  - Workspace Hover 卡片显示全部未归档 Agent、父子层级与精确状态。
- 不包含：
  - 新增或改造搜索能力。
  - 修改 Command Center。
  - 隐藏空 Project。
  - 修改 daemon 或协议。

## 归属

- 独立 issue。
- 相关 spec：`.cs/spec/index.md`。

## 背景与证据

现有侧栏把 Project 与 Status 作为互斥分组方式。Project 视图保留用户能识别的项目上下文，但项目多时需要逐项扫描；Status 视图突出当前状态，却丢失 Project 结构。Workspace 名称通常由 AI 生成，不适合作为用户必须记忆和搜索的定位键。空 Project 还会重复渲染一整行 `New workspace`，与 Project 行已有的 `+` 重复。

## 现状如何工作

`SidebarModelProvider` 根据持久化的 `groupMode` 生成 Project 或 Status 投影；`SidebarWorkspaceList` 再渲染两套列表。Workspace 的当前侧栏状态只汇总最近的根 Agent 活动，Hover 卡片只显示 Host、分支、目录、diff 与 PR 信息。

## 影响范围

- 必须修改：侧栏投影模型、Project 列表模型、显示偏好菜单、Workspace 行摘要、Workspace Hover 卡片及相关测试。
- 需要验证：Project/Workspace 分类与排序、空 Project 沉底、旧持久化状态读取、折叠与手动排序不再干扰新相关性排序、Hover 高度与鼠标安全区、紧凑浏览器仍能看到关键摘要。
- 仍待调查：现有 Agent 状态派生函数能否直接作为全部 Agent 的统一精确状态来源。

## UI 变化 / 实际与预期

- 角色与入口：管理多个 Project 与 Agent 的用户打开左侧 Workspace 列表，首先判断哪里正在等待自己，再按 Project 上下文进入 Workspace。
- 图示状态：目标。

```text
Workspaces

Needs attention  3
▼ byspace                         ⚠ 2  +  ⋮
    ● release verification       ⚠ 1
    ● relay deployment           ⚠ 2
▼ pi-package-mono                ⚠ 1  +  ⋮
    ● Ask user non-interacti...  ⚠ 1

Other projects
▼ CFG                                  +  ⋮
    ● main                         ● 3
    ○ simple-buffalo
▶ chat                                  +  ⋮
▶ empty-project                         +  ⋮
```

- 交互与关键状态：
  - Project 只出现一次；含任意待处理 Workspace 时进入 `Needs attention`。
  - Workspace Hover 保留现有元数据，并新增按父子层级展示的 Agent 列表；需要处理、工作中、完成依次排列，同类按最近活动排列。
  - Hover 详情不是关键状态的唯一入口；行内摘要始终可见。
- 稳定约束：Project 是用户认知锚点；不以搜索作为主路径；空 Project 可见但沉底；Project 行 `+` 是创建 Workspace 的唯一项目内入口。
- 仅作示意：图标造型、精确间距与数字的最终视觉样式。

## 质量目标

- 交互能力 / 适当性可识别：
  - 目标：无需搜索或切换分组，用户进入侧栏即可优先识别所有等待自己处理的 Project 与 Workspace。
  - 来源：用户决定。
  - 预期证据：纯投影测试与真实 Web 界面手动检查。
- 交互能力 / 易操作与包容性：
  - 目标：Hover 提供完整 Agent 详情，但关键待处理摘要不依赖 Hover，在无 Hover 的紧凑浏览器仍可见。
  - 来源：用户决定与 UI 风险扫描。
  - 预期证据：行模型测试、桌面 Hover 与紧凑布局手动检查。
- 性能效率 / 资源利用：
  - 目标：侧栏集合所有者一次性派生 Workspace Agent 摘要，不为每个 Workspace 行新增对高频 Session store 的独立订阅。
  - 来源：`docs/coding-standards.md` 的集合订阅约束。
  - 预期证据：代码结构检查、App typecheck 与现有侧栏测试。
- 可维护性 / 可测试性：
  - 目标：二分类、计数和排序规则集中在纯投影模块中，组件只消费行模型。
  - 来源：本次风险扫描。
  - 预期证据：聚焦单元测试覆盖分类、排序与边界。

## 方案判断

状态不再是另一套页面结构，而是 Project 投影的相关性规则。复用 Session store 已有 Agent、Workspace 与层级数据，不新增协议、依赖、搜索或第二套持久化排序。旧 `groupMode` 持久化值只在读取时归一为单一 Project 结构，旧 Status 渲染路径与无用状态一并删除。

## 实现设计

### 这次要怎么做

先建立按 Workspace 聚合全部未归档 Agent 的纯模型，输出待处理数、工作中数、最早待处理时间、最近活动时间与 Hover 列表；再以该模型生成两个 Project 区域和行摘要。

### 功能 / 责任怎么分工

- 纯投影模块拥有 Agent 二分类、Workspace 摘要、Project 分类与排序。
- `SidebarModelProvider` 一次订阅必要的结构共享索引并生成投影。
- Project/Workspace 行只渲染计数与既有状态点。
- Hover 卡片消费已派生 Agent 列表，不自行扫描全局 store。

### 请求 / 数据 / 调用怎么走

Session store 的 `agents` 与 Project/Workspace placement → Workspace Agent 摘要索引 → Project 两区投影 → Sidebar rows / Hover card。

### 哪些边界不碰

不修改 Agent 生命周期、Workspace 协议状态、Command Center、Project 创建流程、Host 过滤和 Workspace title 设置。

### 质量目标如何落实

关键状态通过常驻行摘要表达，Hover 只增加细节；所有集合派生在列表所有者完成；排序与映射保持纯函数并用聚焦测试固定。

### 一步步怎么改

1. 为 Agent 摘要与 Project 分区写失败测试。
2. 实现纯投影模型并让测试通过。
3. 切换为单一 Project 渲染，删除 Status 分支与 `New workspace` 占位行。
4. 接入 Project/Workspace 摘要与 Hover Agent 列表。
5. 运行聚焦测试和 App 静态/Web 构建验证。

### 怎么确认做对

聚焦单元测试覆盖所有分类和排序边界；浏览器检查两区结构、空 Project、行摘要、Hover 层级与无闪烁；执行 App typecheck、lint、format 和 Web export。

## 验证

- `npx vitest run packages/app/src/utils/workspace-agent-summary.test.ts packages/app/src/components/sidebar/sidebar-projection.test.ts packages/app/src/hooks/sidebar-workspaces-view-model.test.ts packages/app/src/i18n/resources.test.ts --bail=1`：64 项通过。
- `cd packages/app && npx playwright test sidebar-model-b.spec.ts --project='Desktop Chrome' --reporter=line`：3 项通过，覆盖统一 Project 结构、按内容显示分组标题、移除全局 `New workspace` 行、行内摘要、Hover、键盘 focus 与 390px 紧凑布局。
- `npm run typecheck`：通过。
- `npm run lint`：0 warning / 0 error。
- `npm run format:check`：通过。
- `npm run build:web --workspace=@bytetrue/byspace-app`：Web export 通过。
- 独立审查发现并修复：同组 Agent 排序与约定不一致、硬编码文案和 Hover 键盘可达性、置顶覆盖与最近活动排序边界、Agent 摘要覆盖 daemon Workspace/Terminal 状态。

## 执行记录

- 2026-08-05：用户确认目标信息架构与文案，建立受管理 feature issue。
- 2026-08-05：实现 Workspace 全 Agent 摘要索引、两区 Project 投影、Project/Workspace 行内计数与父子 Agent Hover 列表。
- 2026-08-05：删除 Status 分组链路、独立 Pinned/Status 区域和空 Project 的 `New workspace` 占位入口；保留 Project 行 `+`。
- 2026-08-05：补齐 8 个 locale、摘要无障碍名称、Hover 键盘 focus/blur；状态投影同时保留 daemon Workspace（含 Terminal）汇总与 Agent 细分。
- 2026-08-05：验收调整分组标题密度：无待处理项目时隐藏两处分组标题；两组同时存在时才显示 `Other projects`；`Workspaces` 提升为明确的页面标题层级。

- project spec：已将稳定的侧栏 Project 信息架构、条件分组标题、排序、Agent 摘要与 Hover 契约回写 `.cs/spec/index.md`。

## 关闭结论

- 判断：目标范围全部实现，用户已完成界面验收并明确授权提交，issue 可关闭。
- 质量证据：64 项聚焦单元测试与 3 项真实 Web E2E 通过；全仓 typecheck、lint、format check 与 Web export 通过；关键状态在紧凑布局与键盘交互下仍可用。
- 回写：当前稳定交互已毕业到 `.cs/spec/index.md` 的“侧栏 Workspace 导航”。
- 遗留：本 issue 无未完成项；全局与项目内 `New workspace` 创建路径统一作为后续独立讨论，不扩入本次关闭范围。
