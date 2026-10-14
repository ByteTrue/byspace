---
kind: issue
title: "Chief 第 2 轮：角色选择器改为下拉且默认无角色，FAB 在浮窗打开时保持可见"
type: ff
created: 2026-10-14
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# Chief 第 2 轮：角色选择器改为下拉且默认无角色，FAB 在浮窗打开时保持可见

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。
> **自检（四答即可，可合成短段，勿空标题凑节）：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `byissue/` 有无影响。

---

用户提了两个交互问题，一起改。

**角色选择器。** 之前在 draft Composer 里是一个开关：按一下在「无角色」和「Chief」之间切。改成与模型、思考强度同构的下拉——默认「无角色」，点击展开列表，标题栏显示当前值。原来那种一次点击就改状态的写法把「看看有什么角色」变成了「改变了一次选择」，而且第二个角色出现时无法表达。

有个坑：`resolveHasAnyControl` 原来写的是 `hasRole: Boolean(selectedRole)`，默认无角色会让整个工具栏判定为「没有控件」。已改为看这个界面是否提供角色——「无角色」是选项，不是空态。密度预算（`layout.ts`）也补上了 role 一项，否则窄宽度下它会挤掉邻居；新增 `showRoleLabel`，在 tight 档与 mode 标签同时消失。

**没有写新控件，先抽了公共的。** 第一版把 `mode-control.tsx` 抄成 `role-control.tsx`，用户追问「能不能复用」时才发现抄的是机制而不是组件：`AgentControlTrigger` + `Combobox` + open 态 + 「选中即关闭」这套握手，mode/thinking/role/每个 select 型 feature 各写了一遍。抽出 `composer/agent-controls/option-control.tsx`（`ComposerOptionControl`）后：

- `mode-control.tsx` 从 323 行降到 271 行，触发器/Combobox/开关态/handleSelect 全部删掉（收进 `option-control.tsx`，181 行），只剩数据装配 + 键盘循环 + 搜索。`role-control.tsx` 因此缩到 72 行
- `index.tsx` 的 thinking（toolbar 与 sheet 两处）、select 型 feature（desktop 与 sheet 两处）改为调用同一控件，各删一段重复的触发+Combobox JSX
- `role-control.tsx` 本身缩到约 70 行，只剩「选项从哪来」和标签

留了两个口子，因为它们确实是差异：`open`/`onOpenChange`（mode/thinking 的开关由父级 `openSelector` 统一仲裁，避免两个下拉同时开）与 `hint`/`hintShortcut`（mode 要显示循环快捷键）。tooltip 内容用字符串而非 JSX，因为 `.oxlintrc.json` 开了 `react-perf/jsx-no-jsx-as-prop`。

**角色清单改成 daemon 目录。** 用户指出布尔门不合适、后面肯定会加角色，这次一起改掉。协议新增 `features.agentRoleNames: string[]`（daemon 侧由 `listAgentRoleNames()` 供给，就是内建注册表的顺序），旧的 `features.agentRoles` 布尔保留给 0.20.0 的已发布客户端，两处都打了 COMPAT 标签。app 侧 `resolveAgentRoleNames()` 是个三态解析：有目录读目录 → 只有布尔则退回 `["chief"]`（0.20.0 的注册表就这一个）→ 都没有返回 null 作为能力门。Chief FAB 的显示条件也从读布尔改成 `roleNames.includes("chief")`。标签仍由 app 决定：认识的走 i18n，不认识的把名字连字符拆开首字母大写——永远不出现裸 i18n key。

**FAB 常驻。** `chief-panel-host.tsx` 原来写的是 `{!showWindow && !isOnChiefAgentPage ? <ChiefFab/> : null}`，浮窗一开按钮就消失，于是只能在右上角 X 关闭。改成只要不在 Chief 全屏页就常驻，用 `isOpen` 传入当前开合状态，底色变为 `surface2` 表示「已打开」，无障碍标签在 open/close 之间切换。同一位置同一点击即可开可关。

- 改动：`packages/app/src/composer/agent-controls/option-control.tsx`（新）— 列表型 Composer 控件的公共壳：触发器 + Combobox + open 态 + 选中即关闭
- 改动：`packages/app/src/composer/agent-controls/role-control.tsx`（新）+ `role-control.test.tsx` — 角色下拉，只有「选项从哪来」与标签
- 改动：`packages/app/src/composer/agent-controls/mode-control.tsx` — 改用 `ComposerOptionControl`
- 改动：`packages/app/src/agent-controls/roles.ts`（新）+ `roles.test.ts` — `resolveAgentRoleNames()` 三态解析与「无角色」哨兵值单独放一份纯数据模块，于是这条约定能在 node 环境下被测试；控件文件本身引 `combobox`（内含 JSX/module 级 DOM 处理），node 项目直接 import 会 SyntaxError
- 改动：`packages/app/src/agent-controls/use-agent-roles.ts`（新）— 从 `server_info` 读目录的 hook
- 改动：`packages/app/src/agent-controls/labels.ts` — 新增 `formatAgentRoleLabel()`：认识的角色走 i18n，其余按名字格式化
- 改动：`packages/protocol/src/messages.ts`、`packages/server/src/server/websocket-server.ts`、`packages/server/src/server/agent/agent-roles.ts` — 新增 `agentRoleNames` 目录（含 `listAgentRoleNames()`），`agentRoles` 布尔保留并标 COMPAT
- 改动：`packages/app/src/composer/agent-controls/index.tsx` — draft 路径接线（desktop + sheet），删除 `handleRoleToggle`/`roleBadgeActive`，`hasRole` 改为按界面是否提供角色判定，thinking 与 select 型 feature 也改走公共控件
- 改动：`packages/app/src/composer/agent-controls/layout.ts` + `layout-context.tsx` — 新增 `hasRole` 预算与 `showRoleLabel` 档位
- 改动：`packages/app/src/agent-controls/icons.ts` — 新增 `AgentRoleIcon`（`UserRound`）
- 改动：`packages/app/src/chief/chief-fab.tsx` — `isOpen` prop、`fabOpen` 底色、开关语义的无障碍标签、模块级 `makeFabStyle`（memo 要求稳定引用）
- 改动：`packages/app/src/chief/chief-panel-host.tsx` — FAB 在浮窗打开时不再卸载；角色门改为读目录里的 `chief`
- 改动：`packages/app/src/hooks/use-agent-form-state.ts`、`packages/app/src/composer/draft/input-draft-core.ts` — 把 `roleNames` 从 `server_info` 贯通到 draft 控件
- 改动：9 个 i18n 资源 — 新增 `chief.open`
- 验证（对抗性审查后重跑）：`packages/app` 552 个测试文件 / 4759 用例全绿（含 `role-control.test.tsx` 5 条、`roles.test.ts` 7 条、`option-control.test.tsx` 5 条、`chief-route.test.ts` 5 条、`layout.test.ts` role 预算断言）；`packages/protocol` wire-compat 14 条、`packages/server` `home-workspace.test.ts` 13 条 + `agent-roles.test.ts` 3 条 + `websocket-server.relay-reconnect.test.ts` 19 条；`typecheck` / `lint` / `format:check` 全绿。

## 浏览器实测（bsk，dev daemon 6778 + Expo 8081）

在真实 Chromium 里跑了一轮，六条都当场看到：

1. **Home 命名**：侧边栏 project 显示 `BySpace-WorkSpace`，其下工作区显示 `Chief`（084 的修复，真机渲染确认）。
2. **角色选择器存在且是下拉**：draft Composer 里是 chip「Chief」+ 下箭头，不是原来的开关。
3. **默认「无角色」**：展开后列表为 `No role` / `Chief`，`No role` 在前。
4. **选择回填**：点 `Chief` 后 chip 文案变成 `Chief`，不再显示「无角色」。
5. **FAB 常驻**：打开浮窗后 FAB 仍在右下角同一位置，无障碍名变成 `Close Chief`；再点同一点即关闭，名字变回 `Open Chief`。
6. **浮窗不再无限转圈**：浮窗里加载出真实内容（头部 host 名、最大化、关闭，正文空态，底部消息框 + 模型 `Claude Fable 5.1`），关闭再打开同样正常。

**目录驱动这一条是单独证伪过的**，因为它最容易「看起来对了」：只广告 `chief` 时，读目录和读旧布尔位的结果一模一样，界面上分不出来。所以临时往 daemon 的注册表里塞了一个 `code-reviewer`（重启 dev daemon），刷新页面后列表自动变成 `No role` / `Code reviewer` / `Chief`，选中后 chip 显示 `Code reviewer`；删掉该角色再刷新，列表回到两项。全程 app 侧一行未改——「daemon 加角色不用发 app 版本」这句话是实测的，不是推出来的。

仍未实测：compact 形态（底部 sheet）下的角色选择器；touch 设备的 hover 行为。开发时窗口宽度一直在桌面断点。

## 无障碍名补当前值

角色 chip 的无障碍名原本固定是 `Select agent role`，不含当前值——mode/thinking 用的是 `selectWithValue`，屏幕阅读器听不出当前选的是哪个；chip 上明明写着 `Chief`。改成 `selectWithValue`（`role-control.tsx`），并顺手在 **provider 触发条**上补同一个缺口：它可见文本是服务商名，无障碍名只有 `Select agent provider`。9 个语言资源各加两键（`provider.selectWithValue`、`role.selectWithValue`），**无角色是选项不是空态**——未选角色时读作 `Select agent role (No role)`。

`role-control.test.tsx` 加两条断言：选了角色读 `(Chief)`，没选读 `(No role)`。

补完无障碍名之后，`agentControls.provider.select` 与 `agentControls.thinking.select` 就成了死键（调用点全改用 `selectWithValue`），9 个语言各删两行。`agentControls.role.select` **保留**——它同时是 role 下拉的表头标题，不是死键。

顺带扫了一次全仓 i18n 死键（1896 个键，脚本比对键串是否出现在任何源码文件里）。结果见下方「未做」——扫描器对模板拼接的键不可靠，只挑出了`provider.select` / `thinking.select` 这两条能人工确认的；另有 16 条候选（`serviceUrl.*`、`projectPicker.browse`、`newWorkspace.fields.*`、`common.loading` 等）也查不到引用，但其中`serviceUrl.title`、`projectPicker.placeholder` 被 `resources.test.ts` 的迁移批次断言钉着，说明这批键的性质是「迁移时批量加、部分接上了」，不是能一键删的垃圾。

## 对抗性审查（三个子代理分工，逐条核实后处理）

三个 reviewer 分头审（协议+daemon、app 控件、Chief/可见性/i18n），每条结论我自己复核过才动手。**修掉的**：

1. **角色在创建路径被整段丢掉**（reviewer 报为 should-fix，实为功能级缺陷）。创建页选的 Chief 只经「后台创建」路径传出去；前台路径（`submitWorkspaceDraft` → `setPending` → draft tab 自动提交）三条链上都没有 role：`PendingWorkspaceDraftSubmission` 没这个字段，`WorkspaceDraftTabSetup` 没有，`resolveFormState` **声明了 `initialValues.role` 却从不消费它**。于是用户在唯一有意义的场景里选了角色，创建的却是普通 agent，且 daemon 对未知/缺失 role 静默降级——没有任何反馈。修法：role 贯通 pending store / tab setup / `resolveFormState`（新增 `resolveRole()`，userModified 优先）、`sameInitialValues` 纳入 role、持久化 schema 加可选 `role`（COMPAT 标注，旧树缺该键否则解析失败）。测试锁在 `resolve-agent-form.test.ts`（两条：采纳初始 role、用户改的 role 压过初始值）。
2. **`ComposerOptionControl` 每次选中让父级 `onOpenChange` 收到两次 `false`**。Combobox 选中后自己再关一次，父级回调被调两次（`onDropdownClose` 是 focus，会起两条并发重试循环）。修法：只在该变时通知。写测试时**又抓出一个我自己引入的缺陷**——受控模式下 `openRef` 从未与 prop 同步，第一次关闭被当成「无变化」丢掉；改成每次渲染用解析后的 open 播种 `openRef`。
3. **compact 下 FAB 浮在 Chief 面板上**。判据只认 `/agent/<id>` 子串，而 compact 的 FAB 导航目标是 `/h/<s>/workspace/<ws>?open=agent:<id>`，于是手机上加号按钮永远压在消息框上（HEAD 就有，但 085 原先的说法「只在会重复整页的地方隐藏」对 compact 是错的）。

   第一版修法（认 `?open=` 意图参数）**在真实浏览器里被证伪**：workspace 路由消费完这个参数就把它从地址栏抹掉（`stripHostWorkspaceRouteEchoSearchFromBrowserUrlAfterCommit`），所以它只覆盖导航后的最初几帧，按钮随后又回来。改成三信号合一（`isShowingChiefAgent`）：`focusedAgentId`（workspace screen 写进 session store 的**持久**信号，也是意图最终落成的东西）→ agent 路由 → `?open=` 意图参数。6 条测试。`focusedAgentId` 那条是必需的，另两条单独都不够——这只有在浏览器里跑才会发现。

4. **Home project 命名会接管用户的项目**（协议 reviewer 的 blocking，我写探针复现了）。`createWorkspaceForDirectory` 按 rootPath 复用任何已存在的 active project，所以用户自己加过 `~/.byspace` 时，Home 落进**他的**项目，而 `customName === null` 会把他的项目改名为 `BySpace-WorkSpace`。修法：只在「Home 是该 project 唯一的 workspace」时才命名。
5. **`ensureHomePresentation` 读旧快照写新记录**：判定用调用方 list 的旧 `title`、写入重读的 `record`，启动瞬间的用户改名会被盖掉。改成重读后再判定，且已是当前值就不写（原先每次 boot 都空写一次 + 广播 mutation）。
6. COMPAT 标签格式：我原先写的 `added in v0.20.x` 无版本无日期，违反 `docs/protocol-compatibility.md`；还无故把 `agentRoles` 的日期从 04-13 改成 04-14。已恢复原日期，并区分「shim」与「永久字段」——`agentRoleNames` 不是兼容层，标成 COMPAT 会在清理时被误删。
7. 健壮性与死代码：`AGENT_ROLE_LABEL_KEYS` 走原型链（`"constructor"` 会把函数塞给 i18n）改用 `Object.hasOwn`；删掉 `AgentControlSelector`/`ActiveSheet` 里我加的 `"role"` 死成员（role 自管 open，不进仲裁）；删掉 role 里多余的 sheet 分支。
8. 补 `option-control.test.tsx`（5 条）：公共壳的 open/close 契约原先零覆盖，role 的测试又把 Combobox 整个 mock 掉，所以第 2 条能漏过去。新测试的假 Combobox 可切换「是否自己关闭」，保证控制权归属被测。
9. 补 server 侧断言：catalog 真的被广告出去（原先删掉 `websocket-server.ts` 那行不会有测试变红）；补 archived Home 的测试。

**复核后否掉的（不修，附理由）**：

- 「role 下拉没接 `openSelector` 仲裁」——`openSelector` 从来只承载 `provider`/`thinking`，`mode`/`model` 同样在 union 里却从未被赋值；role 自管 open 与既有设计一致，**不是回归**（死成员那条已单独修）。
- 「`resolveAgentRoleNames` 信任非数组」——入站 `server_info` 由 zod 校验，到不了这里；且有单测覆盖空目录与旧布尔。
- 「`formatAgentRoleLabel` 用模块级 i18n.t 会在切语言时不刷新」——与同文件既有的 `formatThinkingOptionLabel` 同模式，不是新问题。
- 「`role.selectWithValue` 的 8 个非英语语言还是英文」——`role` 整个块在 HEAD 里就是英文（只有 zh-CN 翻译过），新键跟随同块风格；要翻就得整块翻，属于独立的翻译批次。
- 宽度预算按 `"No role"`/`"Chief"` 估、而 role 名来自 daemon 开放目录——`toolbarValue` 有 `flexShrink` + `numberOfLines={1}`，只会截断不会溢出，只是密度判定偏差。

**仍未做**：`role.select` 整块的非英语翻译（见上）；CLI `byspace agent run --role` 不校验角色名（见文末）。

### 修复后的浏览器复验（第二轮，dev daemon 6778 + Expo 8081）

两个最重的修复单独做了端到端验证，因为单测只覆盖到函数层：

- **创建路径丢角色（第 1 条）**：在创建页选 Chief → 选模型 → 发送，走的是前台路径（即修复前会丢失 role 的那条）。创建后直接读 daemon 的 agent 记录：`config.role: "chief"`、`labels: {"byspace.agent-role": "chief"}`。修复前这条链上没有 role。user 自己的 Home Chief 记录（`config.role: null` + 同一 label）作为对照，证明不是环境里既有数据造成的错觉。
- **compact FAB（第 3 条）**：`bsk emulate --device iphone-14`（390px 视口）下进入 Chief agent，FAB 连续 4 次采样全部隐藏；切到普通 workspace 立刻回来。桌面宽度下照常显示。第一版修法在这个场景里是失败的（按钮仍显示），改三信号后才通过。

验证用的探针 agent 与 workspace 已归档清理；6777 的 daemon 全程未动。

## 对 `byissue/` 的影响

已同步 `spec/agent-conversation.md`「控件状态」：角色选择器只在 draft Composer 出现、默认「无角色」、且是列表而非开关；已运行会话不能改角色（角色在创建时决定提示词注入）。

已同步 `docs/protocol-compatibility.md`「能力门一次」：新增一条通则——**需要知道「提供什么」而不只是「有没有」时，广告名单而不是布尔**。布尔会迫使 app 自己维护一份 daemon 拥有的清单，daemon 一加条目，早一个版本发布的 app 就落后。`features.agentRoleNames` 是这条的样板。

第 1 轮（Home 命名 + 浮窗转圈）的痕迹在 `084-x-ff-chief-home-naming-and-floating-window-spinner.md`，本条是同一批用户反馈的第二轮，未合并进 084 以免混淆两条独立根因。

仍未做（需求没出现）：CLI `byspace agent run --role` 没有校验 —— 传不存在的角色名会被 daemon 静默降级成普通 agent。同样的静默降级发生在 app 发一个 daemon 不认识的角色名时。结构上是有意的（陈旧客户端不该因为 daemon 删了一个角色就发不出请求），但「用户选了角色却没生效」这件事目前没有任何可见反馈。
