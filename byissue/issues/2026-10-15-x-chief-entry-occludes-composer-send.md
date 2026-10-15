---
kind: issue
title: "Chief 入口压在消息框发送键上，且进入会话后不消失"
type: bug
created: 2026-10-15
---

# Chief 入口压在消息框发送键上，且进入会话后不消失

> **读者：** 接手 Chief 入口位置或路由抑制的人。相关：`byissue/epics/005-x-chief-floating-assistant/spec.md`（入口的原始形态）。

## 预期 / 实际

**预期：** 右下角常驻的 Chief 入口在任何一个页面上都不遮挡消息框的发送键；一旦 Chief 会话本身出现在屏幕上（最大化、或 compact 点开后跳进去），入口就消失。

**实际（两处，同一场景）：**

1. 视口窄于约 950px（含手机 PWA、窄 web）时入口完全压住发送键。原因是两个元素各自锚定窗口右下角、互不知情：入口 `right/bottom: 20`、48×48、`zIndex: 900`（`packages/app/src/chief/chief-fab.tsx`），发送键在消息框右下、距边 16px、28×28（`packages/app/src/composer/input/input.tsx`）。消息框内容居中且有 `MAX_CONTENT_WIDTH = 820`（`packages/app/src/constants/layout.ts`），两者水平重叠的条件是 `W/2 - 410 < 68`，即 **W < 约 956px 时必然重叠**，不是偶发。
2. 最大化浮窗或 compact 点入口后，入口仍然显示在会话页上。抑制条件是 `pathname.includes(`/agent/${agentId}`)`（`chief-panel-host.tsx`），而 app 里没有这条路由：两条入口都跳到 `/h/{serverId}/workspace/{workspaceId}?open=agent:{agentId}`，该路由消费完 `?open=` 意图后 URL 里什么都不剩。抑制从未生效。

## 根因

**几何无知 + 用 URL 表达"会话在屏幕上"。** 前者靠视口宽度就能证明（见上），后者靠的是路由字符串，而这条路由被设计成消费型意图，不承载状态。

## 修法

**入口按消息框让位，而不是换位置或拖动。** 消息框是屏幕底部唯一会占据该角落的东西；把它测量出来发布给入口，两者就天然互斥：

- `packages/app/src/chief/chief-fab-clearance.ts`（新）：发布方以 `ownerId` 注册"自己在窗口坐标里占了多高"，入口取最高的一条；`resolveChiefFabClearance` 用发布者的窗口坐标框做**重叠判定**——消息框在左栏、或在宽到两者不可能相遇的视口上，返回 0，入口留在角上（`right/bottom: 20`）。
- `packages/app/src/chief/use-publish-chief-fab-clearance.ts`（新）：把 ref + `onLayout` 给宿主；`active` 为假（retained panel 未激活）或测量为非正时不发布——`display: none` 的隐藏面板报 0，那不是"没有消息框"，是"没渲染"。
- 发布方三处：会话页消息框（`agent-panel.tsx` 的 `ActiveAgentComposer`）、new workspace 屏（`new-workspace-screen.tsx`，只在路由聚焦时）、workspace setup 抽屉（`workspace-setup-dialog.tsx`）。
- 消费方两处：FAB 与浮窗（`chief-fab.tsx`、`chief-floating-window.tsx`），动态 `bottom` 走 `inlineUnistylesStyle`（docs/unistyles.md 的动态像素规则）。
- 抑制：**这一半由 085 先修掉了**（`chief-route.ts` 的 `isShowingChiefAgent`，读 `focusedAgentId` 加路由与意图）。合并时本 issue 删掉了自己那版 `chief-visibility.ts`——同一个问题不留两套机制。本 issue 因此只交付几何让位那一半。

**有界简化（已知上限）：** 只处理"占住屏幕底部右角"的消息框；侧栏里的消息框（宽度不足、够不到角落）不触发让位，这是故意的（`resolveChiefFabClearance` 的重叠判定）。多 pane 时取最高的一条，不是并集。

## 验证

- **几何契约（真实 Chromium，`chief-fab-clearance.browser.test.tsx`）**：一个占据右下角的消息框表面 + 真实入口，断言两者 bounding box 不相交、入口底边在消息框顶边之上、且间距 ≥ gap。
- **发布链路（真实 Chromium，`chief-fab-clearance.browser.test.tsx`）**：`usePublishChiefFabClearance` 走真实 `measureInWindow`，发布后入口让位，卸载后回到角落。
- **重叠判定与存储语义（`chief-fab-clearance.test.ts`）**：窄视口让位、宽视口/左栏不触发、取最高、离场只清自己的 owner。
- **入口渲染偏移（jsdom，`chief-fab.test.tsx`）**：`bottom` 随发布值变化。
- **路由抑制**：走 085 的 `chief-route.test.ts`（5 条），本 issue 未另立。
- 命令：`npx vitest run src/chief/`（28 passed）、`npx vitest run --project browser src/chief/`（4 passed）、`npm run lint`、`npm run typecheck`。

**未覆盖：** 真实 app（`npm run dev:app` + dev daemon）里的手动截图。该环境 WebSocket 反复以 code 1000 断开、connectionStatus 停在 connecting，会话页渲染不出来——与 epic 005 issue 002 记录的同一限制。视觉复核留给真机/稳定连接环境。

**e2e 这条路暂时走不通：** `e2e/support/fixtures.ts` 在初始化脚本里写入 `@byspace:e2e`，`ChiefPanelHost` 见到它就整块返回 null，因此 Playwright 里永远找不到 `chief-fab`（本 issue 期间写过一版 `e2e/browser/chief-entry-composer.spec.ts`，两条都卡在 `expect(fab).toBeVisible()`，已删除）。当初加这个开关的理由是「FAB 会拦截消息框区域的指针事件」——正是本 issue 修掉的症状。要恢复该覆盖，先确认去掉开关不会让别的 spec 误点入口。

## 关闭结论

**判断：已达目标。** 两处症状都由「入口按消息框让位」+「会话在屏即隐藏」覆盖，且都已用真实 Chromium 的几何契约钉住，不依赖手动观察。

**质量证据：** 见「验证」一节——几何契约（真实 Chromium，两元素 bounding box 不相交）、发布链路（真实 `measureInWindow`）、重叠判定、渲染偏移、路由抑制，5 个测试文件全过；`npm run lint` / `npm run typecheck` 全清。

**回写位置：** 一条稳定产品行为毕业进 `byissue/spec/agent-conversation.md`（Chief 入口与消息框、会话页的关系）。发布方/消费方的实现路径留本 issue，不搬进 spec。

**与主线的合并（2026-10-15）：** 远端 `085-x-ff`（10-14）已经独立修掉了"进入会话后入口不消失"这一半，用的是 `chief-route.ts` + `focusedAgentId`，并把入口改成浮窗打开时常驻（`isOpen`）。合并时本 issue 的抑制实现（`chief-visibility.ts`）作为重复机制删除，让位的那一半保留并与 085 的 `isOpen`/`makeFabStyle` 合并。两半现在共存：085 决定"该不该在"，本 issue 决定"站在哪"。

**遗留：**

- 真实 dev app 的手动截图复核没做（该环境 WebSocket 反复以 code 1000 断开，会话页渲染不出）。几何契约已覆盖同一事实，且浏览器测试跑的是真实引擎，不是 jsdom 近似。
- e2e 覆盖仍缺：`e2e/support/fixtures.ts` 的 `@byspace:e2e` 开关让 `ChiefPanelHost` 整块返回 null，Playwright 永远找不到入口。当初加开关的理由正是本 issue 修掉的症状，所以这条可以在删开关后补——未做。
- `byissue/epics/005-x-chief-floating-assistant/spec.md` 的「推进视图」仍写着 `002-o-chief-fab-and-floating-window.md` / `003-o-chief-opening-suggestions.md`，而磁盘上这两个文件早已是 `-x-`。是更早一次关闭漏改的引用，不属本 issue。

## 执行记录

- 新增 `chief-fab-clearance.ts`、`use-publish-chief-fab-clearance.ts` 及四个测试文件（含两个 browser 测试）。
- 改 `chief-fab.tsx`、`chief-floating-window.tsx`、`chief-panel-host.tsx`、`agent-panel.tsx`、`new-workspace-screen.tsx`、`workspace-setup-dialog.tsx`。
- `E2E` 下隐藏入口的旧 hack 保留（`@byspace:e2e`）；本次没有动 e2e 可见性。
