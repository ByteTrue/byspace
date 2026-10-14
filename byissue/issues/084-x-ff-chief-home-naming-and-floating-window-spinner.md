---
kind: issue
title: "0.20.0 的 Chief：侧栏凭空多出的 project 名字迷惑人，浮窗永远转圈"
type: ff
created: 2026-10-14
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# 0.20.0 的 Chief：侧栏凭空多出的 project 名字迷惑人，浮窗永远转圈

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。
> **自检（四答即可，可合成短段，勿空标题凑节）：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `byissue/` 有无影响。

---

用户升级到 0.20.0 后，侧栏凭空出现一行 project，名字是 `~/.byspace` 的目录名（`.byspace`），点开浮窗永远转圈、最大化到全屏却正常。两个问题同源：都是 daemon 为 Chief 自动准备的那套东西没有按「用户会看到它」来收拾。

**命名。** Home 是 daemon 自建目录工作区，走的是不带 `projectId` 的 `createWorkspaceForDirectory`，于是它物化出的 project 只能拿到目录 basename——看起来就是用户自己加过的项目。现在 Home 创建时给该 project 写 `customName: "BySpace-WorkSpace"`，并把 workspace 标题落成 `Chief`（角色名，与内建 `chief` 角色、app 的 `agentControls.role.chief` 同一个词）。名称是 daemon 的表达、不是身份，所以**每次启动重新施加**，用来升级用户已在跑的旧记录；用户自己改过的名字是用户的，daemon 认出来就不碰（workspace 标题不在「本 daemon 发布过的标题集合」里即视为用户改名，project 有 `customName` 即视为用户改名）。

**转圈。** 根因不在 Chief 代码，而在「谁算可见」的契约只有一处实现。选择性 timeline 的 daemon 只订阅并追赶「某个界面登记为正在显示」的 agent，登记的**唯一**发布者是 workspace screen；浮窗直接渲染 `AgentConversationPanel`，不在那个布局里，于是这个 agent 既没订阅也没权威 history。而 `useAgentScreenStateMachine` 的首屏门要求权威 history 到位才肯渲染——无限 `boot`。最大化之所以正常，正是因为它跳进了 workspace screen。修法是把该契约提成可复用的注册口 `useVisibleAgentTimeline`，由渲染方自己登记、卸载即释放；浮窗调用它。owner 本来就按 source 取并集，因此与 workspace screen 并存而不打架。

- 改动：`packages/app/src/timeline/use-visible-agent-timeline.ts`（新）— 按 source 登记/释放「正在显示的 agent」，关掉唯一发布者假设；新增 3 个单测
- 改动：`packages/app/src/chief/chief-floating-window.tsx` — 浮窗渲染前登记自己的 agent
- 改动：`packages/server/src/server/home-workspace.ts` — `HOME_WORKSPACE_TITLE = "Chief"`、`HOME_PROJECT_NAME = "BySpace-WorkSpace"`、新增 `ensureHomePresentation`（启动时幂等施加，识别并跳过用户改名）
- 改动：`packages/server/src/server/home-workspace.test.ts` — 补 project 命名、旧标题升级、用户改名不被覆盖三类用例
- 验证：`home-workspace.test.ts` 9 passed；`use-visible-agent-timeline.test.tsx` 3 passed；`use-chief-agent.test.ts` 通过；`typecheck` / `lint` / `format` 全绿。**未在真实浏览器里点过浮窗**——转圈修复的证据是代码路径与单测，不是现场复现；下次连到 0.20.0+ 的 daemon 时应实测一次。

**待用户裁决：** `BySpace-WorkSpace` 这个拼写来自用户口述，落盘时未改动大小写；若要统一的 kebab-case 或别的写法，改名一行常量即可（已是 customName 的记录需要一次性改写，daemon 只在 `customName === null` 时注入）。

**改名撞坏了 e2e（CI 抓到，已修）。** 侧栏那一行的可访问名是把行内所有子控件标签拼起来的，改名后成了 `B BySpace-WorkSpace Create a new workspace for BySpace-WorkSpace Project actions`——末尾正好拼出子串 `WorkSpace Project`。而 `getByRole("button", { name: ... })` 默认是**大小写不敏感的子串匹配**，于是这一行和新建页真正的 picker（`accessibilityLabel="Workspace project"`）同时命中，Playwright strict mode 报两个元素，`workspace-model-restart.spec.ts` 红。触发条件是「项目名以 `Workspace` 结尾」，任何这样命名的用户项目都会踩，所以这是定位器的问题、不是名字的问题：修法是那 6 处加 `exact: true`（`project-grouping.ts` 早已这么写）。**本地单测全绿也发现不了它**——只有那个 spec 自起 daemon 且没设 `BYSPACE_DISABLE_HOME_WORKSPACE`，别的 e2e 都把 Home 关掉了，是本地与 CI 的真实差异。

## 对 `byissue/` 的影响

已同步 `docs/timeline-sync.md`「Selective and legacy delivery」：可见性是各界面自行登记的，不从 workspace 布局推断；未登记的 agent 既无订阅也无追赶，而首屏门等它。这是比代码位置更值得留的约束。

Epic 005 已关闭、三切片全交付，本改动不推进其边界，故落在根 `issues/`。Home 命名是 Epic 005 未定型部分的收敛，不改变其 spec 结论。

顺手发现（不在本次范围）：`packages/app/src/chief/chief-panel-host.tsx` 用 pathname 子串判断「当前就在 Chief 会话页」（`pathname.includes(\`/agent/${agent.agentId}\`)`），agent id 恰好是另一个路径片段的子串时会误判；实际 id 是 UUID，暂不构成问题。
