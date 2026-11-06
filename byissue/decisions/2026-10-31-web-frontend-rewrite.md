---
kind: decision
title: "前端用 Vite + React + shadcn/ui 重写，放在 web/，过渡期直接引用 packages/app 的逻辑代码"
created: 2026-10-31
superseded-by: ""
---

# 前端用 Vite + React + shadcn/ui 重写，放在 web/，过渡期直接引用 packages/app 的逻辑代码

前端从 Expo（React Native Web）改成 Vite + React 19 + TypeScript + Tailwind CSS v4 + shadcn/ui（Radix）+ React Router，代码放在仓库根的 `web/`，也就是 [decision 004](004-go-single-binary-architecture.md) 定的前端最终位置。Expo 当初是为了和 Electron、原生移动端共用一套代码选的，这两者都已退役；现在三个宿主（Wails 桌面、Wails Android、浏览器）都是标准浏览器内核，React Native 这一层只剩成本。另外 shadcn/ui 是 UI 美化 Epic 定下的组件参照，在 Expo 里只能照着抄数值，换了技术栈才能直接用它的组件。

切换已于 2026-11-03 完成：业务逻辑已收进 `web/src`，`packages/app`、Expo 与 React Native 依赖及过渡期覆盖机制均已删除。旧实现只保留在 `archive/expo-app` 存档标签供追溯。

## 背景

用户的原话是：Expo 是 Electron 时期为了和移动端复用选的，现在对我们明显是负担；前端想学 Magpie 那种形式，但不用极端到全手写 JS，要新一点、对 AI agent 友好的现代技术栈。

没选的方案：

- 继续在 Expo 上改：解决不了上面的问题。
- Next.js、Remix：不需要服务端渲染，产物要嵌进 Go 二进制。
- Svelte、Solid：现有的 React 逻辑代码用不上。
- 像 Magpie 一样全手写 JS：BySpace 的界面复杂得多。
- TanStack Router：一共二十来个页面，React Router 一份路由表就够，不需要代码生成。
