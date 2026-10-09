---
kind: issue
title: "Project 设置：新建 Workspace 的项目级默认（隔离模式、基础分支）"
type: feature
created: 2026-10-06
---

# Project 设置：新建 Workspace 的项目级默认（隔离模式、基础分支）

> **读者：** 要给项目配置"新建 Workspace"默认行为的实现者——三项偏好里 host 已存在，本 issue 交付隔离模式与基础分支的项目级配置，并决定设置页怎么组织。

## 目标

在 Project 设置里为"新建 Workspace"配置项目级默认，全部可选（默认 Automatic = 维持现状）：

1. **优先 Host**：已有 —— 062 的 `DefaultHostSection`（packages/app/src/screens/project-settings-screen.tsx:162，`AppSettings.defaultHostByProject`，viewKey → serverId）。067 补齐了侧栏"+"入口对它的应用。本 issue 不重做，只决定设置页是否把它与新两项归组展示。
2. **隔离模式**：Local（原目录）还是 New worktree。
3. **基础分支**：隔离模式为 New worktree 时，默认基于哪个分支。

## 现状怎么工作

- 隔离模式：`useWorkspaceIsolation`（packages/app/src/screens/new-workspace-screen.tsx 内）读 `useFormPreferences().isolation`——**全局**记住上一次手动选择，默认 `local`；无项目级覆盖。schedule 表单复用同一偏好，本 issue 不动它。
- 基础分支：new-workspace 的 ref picker（`branchSuggestionsQuery` / `baseItem`）实时解析 repo 默认分支，无记忆、无项目级默认。
- 设置存储先例：`defaultHostByProject` 存 AppSettings（AsyncStorage，仅 app 侧），键为项目 viewKey。

## 方向（设计时敲定）

- 存储沿用 `defaultHostByProject` 模式：AppSettings 加 `newWorkspaceIsolationByProject` 与默认分支的对应 record（键 = viewKey）；Automatic = 删键。
- 消费端优先级对齐 062 语义：手动选择 > 项目设置 > 全局记忆/实时默认；hydrate 后平滑迁移，与 host pin 同款。
- 基础分支仅在被选 host 上存在时生效；分支被删则回落实时默认（陈旧值不迁移）。
- 设置 UI：三项是否归组成一个"New workspace 默认值"分区，随设计定；host 项可直接移入复用。

## 影响面

- **必须改**：AppSettings schema 与存储测试；Project 设置 UI；new-workspace-screen 的隔离解析与 base picker 默认值。
- **需要验**：067 的侧栏偏好链不回归；schedule 表单的隔离偏好不受影响；多 host 项目在偏好 host 离线时的回落。
- **侧栏"+"入口必须覆盖**：这是最高频入口（067 同路径，route 携带 projectId/serverId 进 screen）。隔离与分支的项目级默认实现在 screen 解析层即可覆盖该入口，但验证必须包含它——不能只在无 route 参数的全局入口验证。
- **仍未知**：基础分支是否也要作用于 schedule 表单（倾向不，保持本 issue 范围）。

## 验证

- 单测：存储 schema、隔离解析优先级（手动 > 项目 > 全局）、分支默认值回落。
- 人工 e2e：为某项目设 worktree + 固定分支，新建 Workspace 确认默认值；切 Automatic 确认回到现状行为。入口至少覆盖：侧栏项目行"+"与全局"New workspace"。

## 执行记录

### 2025-06-27 实现（受管理 Do）

存储与解析：

- `AppSettings`（packages/app/src/hooks/use-settings/storage.ts）新增 `newWorkspaceIsolationByProject: Record<string,"local"|"worktree">` 与 `defaultBaseBranchByProject: Record<string,string>`，DEFAULTS 为 `{}`，schema 用 `z.record(...).catch({})`，坏值整体回落 `{}`。
- 新文件 packages/app/src/screens/new-workspace-isolation.ts：`resolveInitialIsolation({manualIsolation, projectIsolation, rememberedIsolation})`，优先级 manual > 项目默认 > 全局记忆 > "local"；`projectPinnedValue(record, viewKey)` 读项目键值（空键/空值返回 null）。
- packages/app/src/screens/new-workspace-picker-item.ts 新增 `pinnedBasePickerItem(branchDetails, pinnedBranch)`：按分支名匹配 detail，refName 优先 `refs/remotes/origin/<name>`，无 remote 用 `refs/heads/<name>`；`branchSuggestionsEnabled({pickerQueryEnabled, hasPinnedBranch, clientReady, hasSourceDirectory})`：pin 了基础分支时分支建议查询在 picker 未打开时也跑；`resolveNewWorkspaceBaseItem({selectedItem, pinnedBaseItem, checkoutStatus})`：base 链唯一所有者（手动选择 > 项目 pin > checkout 默认），picker 勾选与创建请求共用。

消费端（packages/app/src/screens/new-workspace-screen.tsx）：

- `useWorkspaceIsolation` 的 isolation 改经 `resolveInitialIsolation`，传入项目默认。
- `useNewWorkspaceInitialContext` 返回 `projectPinKey`（routeProject?.viewKey ?? lastActiveProjectKey，与 host pin 同键）。
- `pinnedBaseItem` 与创建路径 checkoutRequest 都走 `resolveNewWorkspaceBaseItem`，两处不再各写一条三元链。

设置 UI（packages/app/src/screens/project-settings-screen.tsx）：

- `DefaultIsolationSection`：Automatic/Local/New worktree，Automatic=删键；失败 toast `settings.project.defaultIsolation.saveFailed`。
- `DefaultBaseBranchSection`：分支列表来自 `getBranchSuggestions({cwd: repoRoot, limit: 50})`（targetHost = pinned host ?? project.hosts[0]），Automatic=删键。
- 两个 Section 不限 hostCount 渲染。

i18n：9 locale 的 `settings.project.defaultIsolation.*` 与 `settings.project.defaultBaseBranch.*`（defaultHost 块后）。

验证：vitest 三文件 103/103（new-workspace-isolation / new-workspace-picker-item / storage）；typecheck 全绿；lint 0/0；format 过。

未做（按 issue 范围）：e2e 覆盖侧栏"+"入口；见下方待办。

### 2026-10-06 审查修复（ponytail 过度设计审查 + 正确性审查，均无 blocker）

过度设计审查（总评"偏胖"，接受 F1-F4）：

- 删除 packages/app/src/screens/new-workspace-isolation.ts 及其测试：resolveInitialIsolation 内联回 useWorkspaceIsolation（一行 ?? 链，优先级注释保留）；projectPinnedValue 内联为 screen 内 useMemo 解构查找（运算符进回调作用域，过 NewWorkspaceScreen complexity≤20）。
- 删除 branchSuggestionsEnabled，主分支查询 enabled 回退为纯 pickerQueryEnabled（该函数本是为 pin 查询存在的，SF1 改用独立查询后失去意义；pickerQueryEnabled 另有 githubPrSearchQuery 消费者，保留）。
- 删除 projectPinKey 别名，useNewWorkspaceInitialContext 直接返回 pinViewKey。
- project-settings-screen 提取 useProjectRecordPersist（persist 失败 → console.error + toast），DefaultHost/DefaultIsolation/DefaultBaseBranch 三段 18 行 handleChange 收敛为一段；payload 与文案键仍在各 section 构造。

正确性审查 SF1（pin 分支被查询窗口静默丢弃）：主分支查询 limit 20 且被搜索过滤（queryKey 含搜索词），设置页列表却是 limit 50——排名 21-50 的 pin 永不生效；搜索时 pin 不在结果里则勾选行与创建请求悄悄回落。修复：新增独立 pinnedBaseBranchQuery（queryKey ["pinned-base-branch", serverId, cwd, pin]），按 pin 名精确查询（服务端 suggestions 是子串过滤，存在必中）；pinnedBaseItem 改从该查询结果解析，不再受主窗口影响。

其余：隔离 options 补 id 与 selectedDisplay（SelectField 类型要求）；resolveNewWorkspaceBaseItem 补 4 用例（手动 > pin > checkout 默认 > null）。跳过：加载中显示"自动"（与 062 host section 一致）、refs/remotes/origin 硬编码（继承自 buildBranchPickerItems 的既有假设）。

验证：vitest 123/123（new-workspace-picker-item 29 + sidebar-project-row-model 20 + storage 74）；typecheck 全绿；lint 触碰 7 文件 0/0（NewWorkspaceScreen complexity 20/20）；format 过。

## 关闭结论（2026-10-06）

判断：目标达成。三个项目级默认（Host / 隔离模式 / 基础分支）全部落地且可选（Automatic=删键）；设置页与创建路径共用同一解析（resolveNewWorkspaceBaseItem、useWorkspaceIsolation 的 ?? 链），不会各写一条三元链漂移。

验证摘要：vitest 123/123（new-workspace-picker-item 29 + sidebar-project-row-model 20 + storage 74）；typecheck 全 workspace 绿；lint 触碰 7 文件 0/0（NewWorkspaceScreen complexity 20/20）；format 过。硬性要求的侧栏“+”入口路径与 067 同链路（buildPreferredServerIdsByProjectViewKey + resolveNewWorkspaceTarget），单测已覆盖三态。

回写位置：byissue/spec/workspace.md「新建 Workspace 默认值」节（用户可依赖的行为语义；解析链实现细节留代码）。

遗留：e2e 自动化（侧栏项目行“+”与全局入口）实现时按范围外搁置，现依赖人工验证；若后续要补，并入现有 e2e 套件而非单开 issue。
