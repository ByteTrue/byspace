---
kind: issue
title: "桌面客户端的外链改用系统默认浏览器打开"
type: ff
created: 2026-11-11
---

# 桌面客户端的外链改用系统默认浏览器打开

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。

---

桌面 App 是单个 webview，没有地址栏：点开 Markdown / 设置里的外链会把整个应用替换成那个页面，用户没有回到 App 的路径。现在桌面端把 http(s) 外链交给系统浏览器，浏览器/PWA 保持新标签页。

- 改动：
  - `internal/gui/app.go` — 新增 `withDesktopOpenURL`：`POST /_byspace/desktop/open-url` 校验只接受 http(s) 且必须有 host，然后 `app.Browser.OpenURL`。挂在 Wails 资源处理器最外层，只存在于桌面壳（Android 分支不走它）。
  - `web/src/core/utils/open-external-url.ts` — 桌面壳内改为调用该端点，成功就不再 `window.open`；非 http(s) 仍拒绝（forge 提供的 URL 会流到这里）。
  - `web/src/core/utils/external-links.ts`（新）— document 捕获阶段拦截跨源 http(s) 锚点，`preventDefault` 后走同一个入口，覆盖 Markdown 的 `target="_blank"` 和设置页的普通 `<a>`。同源链接留给 router。
  - `web/src/main.tsx` — 启动时安装，与 IME guard 同层。
- 验证：`web/src/core/utils/external-links.test.ts` 6 条（外链拦截、同源放行、非桌面不拦截、桌面/浏览器两种打开路径、拒绝非 http(s)）通过；`TestDesktopOpenURL` 覆盖端点 204/400/透传；`go test ./internal/gui` 14 通过；web typecheck、oxlint 通过。
- byissue：无影响。
- 未验证：真实桌面壳里点击（需要跑 App）；Android 未覆盖，仍走 `window.open`。
