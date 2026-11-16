# 前端栈：Vite + React + shadcn，唯一参照

## 结论

- 前端在 `web/`：Vite + React 19 + TS + Tailwind v4 + shadcn/ui（Radix）+ React Router。三个宿主（浏览器/PWA、Wails 桌面、Android webview）都是标准浏览器引擎，无平台门。
- shadcn/ui 是唯一组件参照，light + dark 一起改，布局不动。参照快照在 `design/references/shadcn/`（上游 commit b8d7baa15b1dca5716f13153e63795fc3d741f6b，2026-10-30），数值从快照抄，不凭印象。
- Expo（RN Web）已退役：2026-11-03 切换完成，逻辑在 web/src，packages/app + Expo + RN 依赖已删；旧实现只存在于 git tag `archive/expo-app`（`git show archive/expo-app:packages/app/src/<path>` 可查）。

## 依据

- 类型：用户决定（2026-10-31 两篇：先 shadcn 换肤再重写；重写独立大工程）。
- 被否决的相关方案：保留 Expo（为 Electron+native 共享而生，两者都退役后只剩负担）；Next/Remix（无 SSR 需求，要嵌进 Go）；Svelte/Solid（React 逻辑不可复用）；magpie 全手写 JS（UI 复杂度不匹配）；TanStack Router（约 20 页，一张路由表够）。更早失败的换肤尝试：Linear 局部换肤、Claude 暖羊皮纸、impeccable 选方向流程。
- 证据或复核方式：`bywork/archive/v1/decisions/2026-10-31-web-frontend-rewrite.md`、`2026-10-31-shadcn-restyle-before-frontend-rewrite.md`；`design/references/shadcn/README.md`；AGENTS.md「Platform gating」节。
- 适用条件：web/ 全部 UI 工作。换肤先行付出的代价（组件写两遍）已结清，样板页规格按 shadcn 主题变量记录供沿用。

## 重访条件

- 引入需要 SSR 或原生能力的新宿主。
- shadcn 参照快照需要升级（升级时更新 design/references/shadcn/README.md 的 commit 记录）。
