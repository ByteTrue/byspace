# 前端栈：Vite + React + shadcn，唯一参照

## 结论

- 前端在 `web/`：Vite + React 19 + TS + Tailwind v4 + shadcn/ui（Radix）+ React Router。唯一宿主是标准浏览器与已安装 PWA，无平台门（Wails 桌面 WebView 与 Android WebView 壳已于 2026-11-19 退役）。
- shadcn/ui 是唯一组件参照，light + dark 一起改，布局不动。参照快照在 `design/references/shadcn/`（上游 commit b8d7baa15b1dca5716f13153e63795fc3d741f6b，2026-10-30），数值从快照抄，不凭印象。
- Expo（RN Web）已退役：2026-11-03 切换完成，逻辑在 web/src，packages/app + Expo + RN 依赖已删；旧实现只存在于 git tag `archive/expo-app`（`git show archive/expo-app:packages/app/src/<path>` 可查）。
- `web/src` 是一棵树、一个 `@/` alias、三种目录角色：`ui/` vendored shadcn（`npx shadcn add` 落点，永不 restyle）、`platform/` RN/Expo API 的网页替身、其余全是功能目录。`ui/` 与 `platform/` 只许 import npm 包与彼此，功能目录自由。规则由 `scripts/web-layout.test.mjs` 机械守住，不靠文档自觉。应用自建在 shadcn 之上的组件放 `widgets/`，不放 `ui/`。
- 2026-11-18 之前是 `~/`→`web/src` + `@/`→`web/src/core` 双 alias，那是 Expo 合并的残留（当时只处理了一个重名文件），分界后来失效（core→shell 620 处、shell→core 240 处）。已合并，`core/` 这一层不存在了。
- 路由表 `web/src/app/router.tsx` 的契约是「`archive/expo-app:packages/app/src/app` 里每个文件一条 path」，由 `scripts/web-routes.test.mjs` 从 `git ls-tree` 枚举后对账。2026-11-18 补回漏移植的三个 legacy 入口 `h/[serverId]/{settings,open-project,sessions}.tsx`——没有这个守卫，漏文件是静默的，`/h/<id>/settings` 会落到 `path: "*"` 再被启动逻辑送去 `/open-project`。`_layout.tsx` 是布局组件不是路由，枚举时排除。
- 三个共享目录的分工：浏览器/宿主 API 替身 → `platform/`；与领域无关的通用助手 → `lib/`；shadcn 之上的应用自建件 → `widgets/`。其余一律进功能目录。`utils/`、`hooks/`、`components/`、`stores/` 只剩真正跨域的模块（如 host-routes 被 14 个目录用）。判断归属看**领域**不看消费者数量：`device-timezone.ts` 只有 screens 用，但它是通用助手；只被另一个桶消费也不等于跨域，要一路走到功能目录才算。

## 依据

- 类型：用户决定（2026-10-31 两篇：先 shadcn 换肤再重写；重写独立大工程）。
- 被否决的相关方案：保留 Expo（为 Electron+native 共享而生，两者都退役后只剩负担）；Next/Remix（无 SSR 需求，要嵌进 Go）；Svelte/Solid（React 逻辑不可复用）；magpie 全手写 JS（UI 复杂度不匹配）；TanStack Router（约 20 页，一张路由表够）。更早失败的换肤尝试：Linear 局部换肤、Claude 暖羊皮纸、impeccable 选方向流程。
- 证据或复核方式：`bywork/archive/v1/decisions/2026-10-31-web-frontend-rewrite.md`、`2026-10-31-shadcn-restyle-before-frontend-rewrite.md`；`design/references/shadcn/README.md`；AGENTS.md「Platform gating」节。
- 适用条件：web/ 全部 UI 工作。换肤先行付出的代价（组件写两遍）已结清，样板页规格按 shadcn 主题变量记录供沿用。

## 重访条件

- 引入需要 SSR 或原生能力的新宿主。
- shadcn 参照快照需要升级（升级时更新 design/references/shadcn/README.md 的 commit 记录）。
