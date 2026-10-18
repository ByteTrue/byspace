---
kind: issue
title: "BySpace 导航改为悬浮下拉菜单，砍掉就地展开"
type: ff
created: 2026-10-16
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# BySpace 导航改为悬浮下拉菜单，砍掉就地展开

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。
> **自检（四答即可，可合成短段，勿空标题凑节）：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `byissue/` 有无影响。

---

左上角 `BySpace` 按钮点开后在按钮下方**就地展开成导航行**，把 Workspace 列表往下推；收起时又推回来，而每次点击的结果本来都是自动收起。改成菜单引擎的悬浮下拉：锚在按钮下方，打开与关闭都不移动列表；chevron 由「右/下」翻转为「下/上」；当前所在页由该行的勾标出（就地展开时它根本看不见，因为默认收起）。

- 改动：`packages/app/src/components/sidebar/sidebar-nav-menu.tsx` + `sidebar-chief-button.tsx` — `SidebarNavMenu` 用 `MenuRoot`/`MenuTrigger`/`MenuSurface`，条目是普通 `MenuItem`，触发器改为顶栏左侧紧凑按钮 `[BySpace ⌄]`；`Chief` 从下拉菜单中提出来，作为顶栏右侧常驻按钮 `[🤖 Chief ●]`（同步显示 Home workspace 实时运行/待处理状态指示器，并绑定全局快捷键 `⌘J` / `Ctrl+J`）。两个 shell 传 `panelActive`（原来的 `useSidebarNavDisclosure` 就地收进这个文件的 `useSidebarNavMenuOpen`）。
- 删除：`packages/app/src/components/sidebar/sidebar-nav-rows.tsx`、`packages/app/src/sidebar-nav/use-sidebar-nav-disclosure.ts`。
- 改动：`packages/app/src/components/left-sidebar.tsx` — 两个 shell 只留 `SidebarNavMenu`（compact 传 `onBeforeNavigate={closeSidebar}`）；删掉 `expandedNavRows` / `sidebarHeaderAreaExpanded` / `compactNavRows` 与展开分支，发丝线回到「行 + 线 = `HEADER_INNER_HEIGHT`」。
- 改动：`packages/app/src/components/sidebar/sidebar-header-row.tsx` — 只剩 settings 一个调用方，删掉只为导航行存在的 `compact` 变体、选中指示条、hover 快捷键与 `isActive`/`nativeID`/`accessibilityLabel` 口子。- 改名：`packages/app/src/sidebar-nav/model.ts` 的 `isDisclosureSidebarNavId` → `isMenuSidebarNavId`；`use-sidebar-nav-entries.ts` 的 `useSidebarNavDisclosureEntries` → `useSidebarNavMenuEntries`。
- 改动：`packages/app/e2e/support/helpers/sidebar-chrome.ts` — `openTopLevelNavMenu` 新增「等表面落位」轮询：锚定表面在测到 anchor 前停在 `-9999` 且带缩放入场动画，`toBeVisible` 对这两个都不敏感。`closeTopLevelNavMenu` 改用 Escape——菜单打开时铺满窗口的 backdrop 会吞掉对触发器的第二次点击。
- 改动：`packages/app/e2e/browser/sidebar-workspace.spec.ts` — 两个用例改写成「浮层」断言（portal 进 `#overlay-root`、打开前后 Workspaces 标题 y 不变、项高在 1px 内一致、Escape 关闭）；桌面「收起再重开」用例改用 `ControlOrMeta+b`（backdrop 盖住了折叠按钮），compact 的对应用例先 Escape 再点 ✕。
- 改动：`packages/app/src/styles/sidebar.ts` — 移除 PR #14 引入的 `SIDEBAR_LABEL_OPTICAL_OFFSET = -3`（该负偏移把 `BySpace`、`Chief`、底部 `Add project` 及设置侧栏行的文字硬上提 1.5~3px，导致相对相邻图标明显偏高），恢复自然 Flex 垂直居中对齐。
- 验证：`npx playwright test --project=browser e2e/browser/sidebar-workspace.spec.ts e2e/browser/sidebar-nav-settings.spec.ts` 全绿（顺手将 `sidebar-nav-settings.spec.ts` 的快捷键徽标断言改为按 `process.platform === "darwin"` 自适应断言 `⌘N`/`Ctrl+N` 与 `⌘J`/`Ctrl+J`）；连带消费者 `command-center-scroll.spec.ts`、`tunnels-list-first-load.spec.ts` 2 通过；单元测试 5 文件 208 用例全绿；`npm run typecheck`、`npm run lint`、`npm run format:check` 全绿。
- 对 `byissue/` 影响：已同步 `spec/workspace.md`（「点开后是悬浮下拉菜单，不是就地展开」及顶栏常驻 Chief 等条款）与 `spec/agent-conversation.md`（Chief 顶栏常驻入口、实时状态指示器与 `⌘J`/`Ctrl+J` 快捷键），并同步 `docs/menus.md`（原来拿它当「不该做成菜单」的正面例子，现在改写为判据 + 两个反例）。
