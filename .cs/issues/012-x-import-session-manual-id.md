---
kind: issue
title: "Import Session sheet：workspace 内支持手动填 provider + session ID 导入"
type: feature
status: closed
created: 2026-08-01
epic: ""
---

# Import Session sheet：workspace 内支持手动填 provider + session ID 导入

## 目标

在已经打开 workspace 的场景下，Import Session sheet 除了现有"最近会话"自动扫描列表，还能让用户直接选 provider + 填 session/thread ID 完成导入，等价于 CLI 的 `byspace agent import <id> --provider <p>`（cwd 隐式取当前 workspace 目录，不需要用户输入）。

## 范围

- 包含：
  - `packages/app/src/components/import-session-sheet.tsx` 内新增一个"手动导入"区块：Provider 下拉 + Session/Thread ID 输入框 + 提交按钮。
  - 该区块仅在调用方传了 `cwd`（即从 `workspace-screen.tsx` 打开）时渲染；`open-project-screen.tsx`（无 ambient cwd 的全局 Home 入口）不受影响，行为不变。
  - Provider 下拉复用该 sheet 已有的 provider 数据源（`useProvidersSnapshot` → `providersToFetch`/`filterProviders`），不新增数据获取。
  - 提交调用现有 `client.importAgent({ providerId, providerHandleId, cwd, workspaceId? })`，复用现有导入成功/失败副作用（关闭 sheet、失效缓存、`onImportedAgent`/`onImported` 回调、通用失败提示）。
  - 新增 i18n 文案，需要同步全部 8 个语言资源文件（`en/ar/es/fr/ja/pt-BR/ru/zh-CN`，`resources.test.ts` 强制 key 一致）。
- 不包含：
  - 全局 Home 导入入口（`open-project-screen.tsx`，无 ambient cwd）的手动导入 —— 需要手填目录/选工作区，本轮明确不做。
  - 任意路径输入 / 目录选择器 / 工作区选择器。
  - 对"最近会话"自动扫描列表本身的改动（无论是过滤、排序还是 subagent 噪声问题 —— 见下方"讨论过程"，本轮不碰）。
  - 对 session ID 的格式校验 —— 合法性完全交给后端 `importAgent` 报错。

## 归属

- 独立 issue（非 epic）。
- 来源 talk：`.cs/talks/002-import-session-manual-id.md`

## 背景与证据

用户会用命令行直接跑 agent（例如装了 pi-subagents 扩展的 Pi），想把这类 CLI 会话转成 BySpace 托管 agent。UI 的 Import Session sheet 目前 100% 依赖自动扫描列表（`fetchRecentProviderSessions`/`listImportableSessions`），没有任何"手动填 provider + session ID"的入口；CLI 的 `byspace agent import <id> --provider <p> --cwd <path>` 在 UI 里没有等价物，每次都要手输完整命令。

讨论过程中曾提议顺带修复"Pi + subagent 扩展场景下最近会话列表混入 subagent 子会话"的问题（收紧 Pi session scanner 只扫两层目录）。用户否决：pi 原生没有 subagent 概念，当前观察到的嵌套存储格式只是用户装的这一个第三方扩展的实现细节，不是稳定契约，其它 subagent 类扩展完全可能用别的落盘方式，通用过滤规则做不到。这部分不追踪为 BySpace 改动，仅记录在 talk 里备查。

## 现状如何工作

打开 workspace → 点击 Import → `workspace-screen.tsx` 以 `cwd={workspaceDirectory}` `workspaceId={normalizedWorkspaceId}` 打开 `ImportSessionSheet` → sheet 用 `useProvidersSnapshot` 拿到该 host 启用的 provider 列表，对每个 provider 调 `fetchRecentProviderSessions` 拼出候选列表，点击某一行调用 `client.importAgent({ providerId, providerHandleId, cwd: entry.cwd, workspaceId? })`。cwd 是 `importAgent`/`importProviderSessionNow` 唯一必填项，workspace 由 cwd 在后端 `runInImportWorkspace` 里 find-or-create，没有单独的 workspace 输入。

`open-project-screen.tsx` 的全局 Home 入口打开同一个 sheet 时不传 `cwd`/`workspaceId`，每行导入用该行自己扫描到的 `entry.cwd`。

## 影响范围

- 必须修改：`packages/app/src/components/import-session-sheet.tsx`；8 个 i18n 资源文件新增 `importSession.manual.*`；`packages/app/e2e/import-session-manual.spec.ts`（新增）。
- 需要验证：新增 Playwright e2e（真实 daemon + 浏览器，见下）；`resources.test.ts`（key 同步 + 非英语翻译比例）。
- 仍待调查：无（现有代码路径已读清楚，见下方实现设计）。

## UI 变化 / 实际与预期

- 角色与入口：在已打开的 workspace 内点击 Import，sheet 顶部（筛选行之上）新增一个常驻小区块，不需要额外点击展开；`cwd` 为空（全局 Home 入口）时该区块整体不渲染，其余不变。
- 图示状态：目标

```text
┌ Import Session ──────────────────────────────┐
│                                        ↻      │
├────────────────────────────────────────────────┤
│ Import by session ID                           │
│ [ pi ▾ ]  [ Session or thread ID___________ ]  [Import] │
├────────────────────────────────────────────────┤
│ [All ▾]  ← 现有 provider 筛选（>1 provider 时才有）│
│                                                  │
│  ……现有"最近会话"列表 / 状态 / 空状态，不变……      │
└──────────────────────────────────────────────────┘
```

- 交互与关键状态：
  - Provider 下拉：复用 sheet 已有的 `Combobox`/`ComboboxItem` 机制（和现有 provider 筛选下拉同款），选项来自 `filterProviders`；只要有 ≥1 个可用 provider 就显示为可点的下拉（不因为只有 1 个选项就退化成静态文本，避免多一条分支）。
  - 提交按钮：`sessionId` 为空或没有可选 provider 时禁用；提交中禁用整块（复用现有 `importMutation.isPending` —— 和现有行点击导入共用同一个 mutation，行点击和手动提交互斥地共享 pending 态，和现有"导入中禁用所有行"的语义一致）。
  - 失败：复用现有 `importSession.status.failedImport` 通用提示（现状对行点击导入失败也只显示通用文案，不展示后端具体错误文本，手动导入保持同样克制，不新增错误文案分支）。
  - 成功：复用现有 `onSuccess`（失效 `recent-provider-sessions` 查询、关闭 sheet、`onImportedAgent`/`onImported`），sheet 关闭后本地表单状态不需要显式清空；`visible` 变 false 时清空 `sessionId`（并入现有"筛选重置" `useEffect`，不新增一个 effect）。
- 稳定约束：全局 Home 入口（无 `cwd`）不出现该区块，行为 0 改动。
- 仅作示意：具体间距/圆角与现有 sheet 保持一致，不单独设计。

## 质量目标

- 不新增：不做 session ID 格式校验（YAGNI，交给后端报错，和现状一致）；不做手填目录（用户已明确排除）。
- 易用性延续现状：失败态、禁用态、loading 态都复用 sheet 已有模式，不新增用户需要理解的新状态种类。

## 方案判断

- **表单实现方式：不套用 `docs/forms.md` 的"表单模型 + adapter + useSyncExternalStore"金标准范式。** 该文档面向的是有多字段级联、create/edit 双态、异步分辨率的"非平凡表单"（golden example 是 schedule 表单）。这里只有 2 个字段、1 个提交动作、无级联/无双态，且要扩展的宿主组件（`import-session-sheet.tsx`）本身也不是那条产品线的一部分、现状就是用局部 `useState`/`useEffect`（例如 `!visible` 时重置 `selectedProvider` 的现有 effect）。选择继续用局部 `useState`，把新状态并入现有 reset effect，和宿主文件现状保持一致，不引入新架构。
- **Provider 选择控件：不用 `components/ui/select-field.tsx` 的 `SelectField`。** 该组件更强大（自带 `Field` 标签/hint/error），但直接复用本文件已有的 `Combobox`/`ComboboxItem` + 自制 trigger 模式（和现有 provider 筛选下拉同款代码形状）足够，零新依赖。
- **Session ID 输入：用原生 `TextInput` + 本文件已有的 `StyleSheet.create` 补样式**，不引入 `FormTextInput`。
- **Provider 下拉不因"只有 1 个 provider"退化成静态文本。** 现有筛选下拉有 `showFilter = filterProviders.length > 1` 这条规则，但那是"筛选一个只有一项的列表没有意义"；手动导入的下拉是"选导入目标"，即使只有一项，让用户点一下确认也不算浪费，比多加一个分支判断更省。
- **手动导入和行点击导入共用同一个 `importMutation`**，把 `mutationFn` 的入参从 `FetchRecentProviderSessionEntry` 收窄成 `{ providerId, providerHandleId, cwd }`（`importingSessionKey` 现有派生逻辑只读这两个字段，不受影响）；避免复制一份几乎一样的 `onSuccess`/失效缓存/关闭逻辑。
- **验证方式：真实 Playwright e2e，不是 JSDOM 组件测试。** `docs/testing.md`「两类测试，没有第三类」明确把"JSDOM + `@testing-library` 挂载组件、mock 被测模块"归为"正在淘汰的 slop"；这个改动是 RPC-backed UI（调用 `importAgent`），文档原话"RPC-backed UI should use an app Playwright test with a real browser, network, and daemon whenever feasible"直接适用。执行中一度先按 `import-session-sheet.test.tsx` 现有的 JSDOM 套路加了 4 个用例（能跑通），但确认这条测试哲学后撤回，改写真实 e2e——见下方"执行记录"的偏差记录。

## 实现设计

### 这次要怎么做

`import-session-sheet.tsx` 内新增：

1. 本地状态：`manualProvider: string`（默认空，取值时 fallback 到 `filterProviders[0] ?? ""`）、`manualSessionId: string`。
2. 把 `importMutation.mutationFn` 的参数类型从 `FetchRecentProviderSessionEntry` 收窄为 `{ providerId: string; providerHandleId: string; cwd: string }`；`handleImportSession`（行点击）改为传 `{ providerId: entry.providerId, providerHandleId: entry.providerHandleId, cwd: entry.cwd ?? "" }`。
3. 新增 `handleManualImport`，构造同样形状的对象（`cwd` 取 sheet 的 `cwd` prop，这条路径下恒为非空字符串）并 `importMutation.mutate(...)`。
4. 新增本地小组件 `ManualImportSection`（与文件里已有的 `RefreshAction`/`SheetEmptyState`/`ImportSessionSheetRow` 同级别的展示型子组件），props 只含渲染需要的数据和回调，不直接持有 mutation。
5. `{cwd ? <ManualImportSection ... /> : null}` 插入在现有 `{showFilter ? ... : null}` 之前。
6. 现有"`!visible` 时重置 `selectedProvider`"的 `useEffect` 里一并 `setManualSessionId("")`。
7. i18n：`importSession.manual.{sectionTitle,providerPlaceholder,idPlaceholder,submit}`，8 个语言文件都要加（不是只加 `en.ts`）。

### 功能 / 责任怎么分工

- Provider 列表来源、mutation、缓存失效：留在 `ImportSessionSheet`（现状已经这样）。
- `ManualImportSection`：纯展示 + 本地 combobox 开合状态，不知道 `client`/`queryClient`。

### 请求 / 数据 / 调用怎么走

`ManualImportSection` 提交 → `handleManualImport`（父组件）→ `importMutation.mutate({ providerId, providerHandleId, cwd })` → `client.importAgent(...)` → 成功走现有 `onSuccess`（invalidate + close + 回调），失败走现有 `importMutation.isError` → `SheetStatusMessages` 的 `importErrored` 通用文案。

### 哪些边界不碰

- `open-project-screen.tsx`、`workspace-screen.tsx` 两个调用点：零改动（新区块由 `cwd` 是否传入自然门控）。
- `import-session-sheet-view-model.ts`：不改（手动导入不走这些聚合/空态函数）。
- 协议层（`ImportAgentRequestMessage`/`importAgent`）：不改，字段已够用。

### 质量目标如何落实

不适用新增质量目标；延续现有 sheet 的失败/禁用/loading 表现（见上方"质量目标"）。

### 一步步怎么改

1. 加 i18n key（8 个文件）。
2. 收窄 `importMutation` 入参类型 + 改 `handleImportSession` 调用点。
3. 加 `manualProvider`/`manualSessionId` 状态 + 并入现有 reset effect。
4. 写 `ManualImportSection` 子组件（复用 `Combobox`/`ComboboxItem`/`filterOptionIcons`）。
5. 插入渲染位置，接 `handleManualImport`。
6. 补 e2e 测试（见验证）。

### 怎么确认做对

- `npm run typecheck --workspace=@bytetrue/byspace-app` / `npm run lint -- <改动文件>`
- `npx vitest run packages/app/src/i18n/resources.test.ts --bail=1`
- `npm run test:e2e --workspace=@bytetrue/byspace-app -- import-session-manual.spec.ts`（真实 daemon + 浏览器，targeted spec，不跑整个 e2e 套件）

## 验证

- [x] `cwd` 为空（Home 全局入口）时该区块不渲染，两个调用点零改动——人工读码 + typecheck/lint 确认，未单独起 e2e（不涉及本次改动的可观察行为分支）。
- [x] `cwd` 已知时手动区块渲染，可选 provider + 填 ID + 提交，调用真实 daemon 的 `importAgent` 并成功导入。—— Playwright e2e `packages/app/e2e/import-session-manual.spec.ts`：真实 daemon + 浏览器，seed 一个空 workspace，选 `mock` provider + 填任意 session ID + 提交，断言 sheet 关闭且 workspace 新增 1 个 agent tab。
- [x] 失败态：同一 provider + 同一 session ID 再导一次，sheet 不关闭、显示通用失败文案，不产生第二个 tab。—— 同一 e2e 用例里复用同一个 `mock` session id 二次提交，断言页面出现 "Could not import selected session."、sheet 仍可见、agent tab 数量还是 1；daemon 日志确认命中 `import-sessions.ts` 的 "Provider session is already imported" 分支。
- [x] `resources.test.ts` 全绿（8 语言 key 同步、翻译比例、占位符一致）。—— `npx vitest run packages/app/src/i18n/resources.test.ts --bail=1`：29 passed。
- [x] `npm run typecheck`、`npm run lint` 通过。—— `npm run typecheck --workspace=@bytetrue/byspace-app`、`npm run lint -- packages/app/src/components/import-session-sheet.tsx packages/app/e2e/import-session-manual.spec.ts`：均 0 error。
- [x] 既有 `import-session-sheet.test.tsx`/`import-session-sheet-view-model.test.ts` 全绿，无回归（未改动这两个文件的既有内容）。—— `npx vitest run <三个文件> --bail=1`：80 passed（i18n 29 + view-model 30 + sheet 现有 17 各自不变的既有用例）。

## 执行记录

- 按实现设计落地：`packages/app/src/components/import-session-sheet.tsx` 新增 `ManualImportSection`（展示型子组件，复用 `Combobox`/`ComboboxItem`/`filterOptionIcons`/`filterTrigger*` 样式）+ `useManualImportState`（状态与提交逻辑的自定义 hook）；`importMutation.mutationFn` 入参收窄为 `{ providerId, providerHandleId, cwd }`，行点击 `handleImportSession` 同步改造；`{manualImport.show ? <ManualImportSection .../> : null}` 插入在筛选行之前。8 个 i18n 资源文件新增 `importSession.manual.{sectionTitle,providerPlaceholder,idPlaceholder,submit}`。
- **偏差 1（执行中发现，非目标变化）**：原设计把 `resolvedManualProvider`/`manualProviderLabel`/`isManualSubmitting`/`handleManualImport` 直接写在 `ImportSessionSheet` 组件体内；`npm run lint` 报 `ImportSessionSheet` 圈复杂度 22（上限 20）。改为抽出 `useManualImportState` 自定义 hook（连同 `manualProvider`/`manualSessionId` 状态和 `!visible` 重置 effect 一并搬入），把手动导入表单的状态与派生计算收进它自己的函数作用域，不再计入宿主组件复杂度；`ImportSessionSheet` 恢复到只调用 `useManualImportState(...)` 一次。对应 `code-design.md`「先改善可修改性，再实施行为变更」，未改变任何已确认的外部行为/UI。
- **偏差 2（用户明确要求后的返工，非目标变化）**：验证方式最初按 `import-session-sheet.test.tsx` 现有的 JSDOM + `@testing-library` 套路加了 4 个单测（provider 下拉、cwd 有无、空 ID 不提交、成功调用 `importAgent`），全部通过。用户随后明确要求做 Playwright e2e；复核 `docs/testing.md`「两类测试，没有第三类」后，判断这类 JSDOM 组件测试属于文档里"正在淘汰"的第三类，且这个改动本质是 RPC-backed UI，文档要求这类改动"whenever feasible"用真实浏览器+daemon 的 Playwright 测试。撤回新增的 4 个单测（`import-session-sheet.test.tsx` 恢复到改动前逐字节一致，`git diff` 为空），改写 `packages/app/e2e/import-session-manual.spec.ts`：用 `mock` provider（`listImportableSessions` 恒为空、但 `resumeSession` 对任意 ID 无条件成功，见 `.cs/notes/001-mock-provider-for-import-e2e.md`）在同一条用例里覆盖成功导入 + 重复导入失败两条路径，不需要真实 Claude/Codex/OpenCode/Pi 凭据，默认 CI 就能跑（不是 `.real.spec.ts`）。为了让 e2e 能点选具体 provider 选项，给 `ManualImportSection` 里的 `ComboboxItem` 补了一个 `testID={`import-session-manual-provider-option-${option.id}`}`（此前没有；vitest 单测靠的是测试替身自己编的 testid，跟真实组件无关，删掉单测后这条信息也一并作废）。
- 未触碰：`open-project-screen.tsx`、`workspace-screen.tsx`、`import-session-sheet-view-model.ts`、协议层，均按设计保持零改动。

## 关闭回写

- project spec（`.cs/spec/index.md`）：不加条目。该文件的粒度是产品边界/大架构事实（发行边界、Terminal、Agent Timeline、身份与发布……），没有为单个 UI 能力开小节的先例；这次是给已有 Import Session 能力加一种入口方式，不是新的产品边界或架构事实，不匹配这份 spec 的粒度。这个判断本身就是这次关闭的结论，不再留"以后再补"的待办。
- notes：`.cs/notes/001-mock-provider-for-import-e2e.md`——记录 `mock` provider 是这个仓库里写非 `.real.spec.ts` 导入类 e2e 的确定性首选，以及 `ComboboxItem` 默认不带 `testID` 这个坑，供以后写类似 e2e 时直接查。
- AGENTS.md / CLAUDE.md：不改，没有新的启动期短规则要注入。
- tools：无。

## 关闭结论

- 关闭判断：目标（workspace 内手动填 provider + session ID 导入）已实现且验证通过；范围未扩大（全局 Home 入口、路径输入、workspace 选择器均按讨论时的排除项保持未做）；已选的两项质量目标（不做格式校验、复用现有失败/禁用态语义）均已兑现，无遗留质量缺口。
- 验证摘要：真实 Playwright e2e（`import-session-manual.spec.ts`，真实 daemon + 浏览器）覆盖成功导入与重复导入失败两条路径，均通过；`resources.test.ts`（8 语言 key 同步）、既有 `import-session-sheet.test.tsx`/`import-session-sheet-view-model.test.ts`（80 用例，无回归）、`typecheck`/`lint` 全部通过。
- 回写位置：project spec 明确判断为不加条目（理由见上）；坑点回写到 `.cs/notes/001-mock-provider-for-import-e2e.md`。
- 遗留事项：无新建 issue。问题1（Pi subagent 噪声）在 talk 阶段已判定为通用方案不成立、不追踪；全局 Home 入口的手动导入是本轮明确排除项，用户需要时可另开新 issue，不在此预留占位。
