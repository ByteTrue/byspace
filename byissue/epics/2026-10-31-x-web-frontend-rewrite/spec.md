---
kind: epic
title: "前端重写：web/ 取代 Expo 版 packages/app"
created: 2026-10-31
---

# 前端重写：web/ 取代 Expo 版 packages/app

## 要改变什么

现状：前端是 `packages/app`，Expo + React Native Web + Unistyles + Expo Router，构建成静态文件嵌进 Go 二进制（`internal/webui/dist`）。`packages/app/src` 去掉测试一共 1227 个文件、约 25 万行；其中 491 个文件（约 7.8 万行）完全不依赖 React Native，其余 736 个直接或间接依赖。

目标：新前端 `web/` 功能和现版对等后接管 `internal/webui/dist`，删掉 `packages/app` 和 Expo、React Native 的全部依赖。为什么换、换成什么见 [decision](../../decisions/2026-10-31-web-frontend-rewrite.md)。

## 当前方案

- **技术栈：** Vite + React 19 + TypeScript + Tailwind CSS v4 + shadcn/ui（Radix）+ React Router + lucide-react。状态管理（Zustand）、请求缓存（TanStack Query）、多语言（i18next）、终端（xterm）、编辑器（CodeMirror）沿用现有的库。
- **代码共享：** `web/` 里 `~/` 指向自己的 `web/src`，`@/` 指向 `packages/app/src`，和现版里的写法一样，共享模块内部的 `@/` 引用照常解析。`web/src/overrides/` 下有同名文件时，`@/` 优先解析到它（Vite 插件和 TypeScript 的 `paths` 用同一个顺序），用来替换依赖 React Native 界面的模块，对外接口不变。几个只用到非界面 API 的第三方包在 `web/` 里换成网页实现：`react-native` 只提供 `AppState`、`Platform` 这类接口，不提供任何界面组件；`expo-router` 的跳转接口转到 React Router；`lucide-react-native` 换成 `lucide-react`。共享模块一旦引到 React Native 的界面组件，构建会直接报错，这个模块就得覆盖或重写。
- **地址和测试 ID 不变：** 页面地址照搬，配对链接、书签、PWA 不受影响；`data-testid` 照搬，现有 189 个 Playwright 端到端用例改个地址就能拿来验收新前端；有意改过的布局或交互，对应用例在切换时跟着改。
- **样式：** shadcn/ui nova 风格加 neutral 底色，数值以 `design/component-sheet.html` 和 `docs/design.md` 为准，包括 [UI 美化 Epic](../2026-10-31-o-ui-style-refresh/spec.md) 里记下的三处有意偏离。旧版没给 `lineHeight` 的文字用 `normal`，不写在 Mac 上量到的像素值：Mac 上 Chromium 和 WebKit 把字体的上下高度各自取整（14px 的 Geist 是 18px），Android、Windows、Linux 不取整（18.29px），写死的行在那里每行矮一点、往下累积。
- **预览和构建：** 开发时 Vite 跑在 8082，连开发版 daemon（6778）。构建产物在 `web/dist`，切换前不进 `internal/webui/dist`。

## 状态：已交付关闭（2026-11-05）

六步全部落地并在 `main`，用户 2026-11-04 完成整体验收，2026-11-05 授权关闭。现在只有 `web/` 一个前端，Expo 与 `packages/app` 已删（存档标签 `archive/expo-app`），界面组件用 shadcn 现成的（shadcn 没有的保留自写，清单见 issues/2026-11-03-x-shadcn-direct.md）。选中态、悬停、弹窗、通知的最终规则在 `docs/design.md` 与 `docs/hover.md`。

2026-11-05 再次核对：运行时源码没有 Expo / React Native 目录或 import，依赖锁文件中仅剩第三方包声明的可选 peer 元数据；历史注释和 ByIssue 证据保留对存档的引用。七个步骤事项均按各自验证记录交付关闭，后续 bug 单独立项。

## 必须守住

- 协议不动：只换前端，`packages/protocol` 和 `packages/client` 照用。
- 布局和交互以现版为基线，样式按 shadcn。明显不合理、能做得更好的布局或交互可以直接改（2026-11-01 用户放开，此前是「不借机改布局」），每处改动在批次汇报和对应事项的执行记录里单独写明改了什么、为什么。
- 旧版在切换前一直可用，`npm run dev:app`（8081）照常工作。
- 重写期间 `packages/app` 只修 bug；新功能等对应切片在 `web/` 落地后再做，否则新前端永远在追一个移动的目标。
- 逻辑代码不复制：要改就覆盖，不另抄一份。

## 推进视图

| 步骤                | 事项                                                                                                  | 做什么                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1 打通              | [连上 daemon、看列表、看对话、发消息](issues/2026-10-31-x-spike-connect-and-stream.md)                | 脚手架和共享机制；侧栏工作区列表；agent 对话的实时流、Markdown、工具调用；发消息。先做最难的部分，验证共享方式和流式性能 |
| 2 外壳和导航        | [根布局、页面地址、侧栏、快捷键、命令面板、主题、多语言](issues/2026-10-31-x-shell-and-navigation.md) | 全部页面地址、左包右框架、侧栏完整功能、快捷键、命令面板、主题、多语言                                                   |
| 3 工作区            | [标签页和分屏、对话、输入框、终端、文件、Diff、PR、代码审查](issues/2026-11-01-x-workspace.md)        | 标签页和分屏、对话里的各种卡片、输入框全部功能、终端、文件树、文件预览和编辑器、Diff、PR 面板、代码审查                  |
| 4 其余页面          | [设置、主机和配对、项目、历史、定时任务、隧道、欢迎页、全局弹窗](issues/2026-11-01-x-other-pages.md)  | 设置各分区、主机和配对（扫码）、项目、历史、定时任务、隧道、欢迎页、全局弹窗                                             |
| 5 手机、PWA、客户端 | [桌面窗口和 Android 用新前端，手机手势，PWA](issues/2026-11-02-x-mobile-pwa-clients.md)               | 手机布局和手势，PWA 安装和推送（旧版的 service worker 只做推送，不做离线缓存），Wails 桌面端和 Android 客户端集成        |
| 6 切换              | [端到端对新前端跑通，构建切到 web/，删除旧版](issues/2026-11-02-x-switch.md)                          | 端到端用例在 CI 上对 `web/` 跑通，用户逐页验收，构建切到 `web/`，删除 `packages/app` 和 Expo 依赖                        |

每一步做完给用户预览地址，验收后再做下一步。

2026-11-01 用户决定：先照旧版移植完（第 3 步漏掉的新建工作区页、第 4–6 步），简洁化的设计改版放到第 6 步切换之后单独做，不在本 Epic。

## 关闭条件

- 端到端用例对 `web/` 全部通过，不适用的逐个说明原因。
- 用户逐页验收过。
- `internal/webui/dist` 由 `web/` 构建，`packages/app` 和 Expo、React Native 依赖已删除。
- 只为 React Native Web 存在的文档（`docs/unistyles.md`、`docs/react-compiler.md`、`docs/expo-router.md` 等）删掉或改写，`AGENTS.md` 和 `docs/development.md` 同步。

合并候选：decision 004 的目录布局一节（前端已在 `web/`）；`docs/architecture.md` 的前端部分。

## 毕业回写

- `byissue/spec/index.md` →「边界与考量」：Web/PWA、Wails 桌面和 Android 共用一套 Web 前端，外壳只补平台便利，不保留独立原生客户端。
- `byissue/spec/notifications.md` →「每个平台走哪条」「约束」：通知平台表改为现有 Wails 客户端，删除 Expo/EAS 原生推送及已退役 iOS 壳的旧约束。
- `byissue/decisions/2026-10-31-web-frontend-rewrite.md`：过渡期共享机制更新为已完成的切换事实。
- Vision 的 web 优先和外壳边界未改变，无目标或候选关系需要改写；实现程度以本 Epic 的关闭状态为准。
- 无新增沉淀候选：稳定技术边界已在 docs，跨端产品边界已进 Project Spec，历史执行和踩坑留在本 Epic 与既有 notes。
