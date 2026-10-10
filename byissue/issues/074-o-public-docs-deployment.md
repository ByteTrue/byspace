---
kind: issue
title: "public-docs 部署链路：/docs/* 当前是坏链，需要真实部署形态"
type: feature
status: open
created: 2026-10-10
---

<!-- 读者：跨会话接手的人。目标与范围 · 根因证据 · 现状怎么工作 · 影响面 · 方案 · 验证 · 关闭回写 -->

# public-docs 部署链路：/docs/\* 当前是坏链，需要真实部署形态

## 为什么做

073 cutover 期间钉死的事实：`public-docs/`（用户文档 + SDK 文档源）**没有任何部署链路**——不在任何 workflow、任何构建脚本里。线上 `app.byspace.cc.cd/docs/*`（被 `packages/client/README.md`、`SECURITY.md` 引用的 SDK 文档 URL）现在被 SPA 回落兜成 index.html，是**功能性坏链**：用户点开文档链接，得到的是 BySpace app 本体。

Pages 时代它同样是坏链（同一回落行为），所以这不是 073 引入的回归——073 只是让这个真空显形了。

## 做成以后是什么样

- `app.byspace.cc.cd/docs/<name>` 返回 `public-docs/<name>.md` 的渲染产物（或重定向到真实的文档站）。
- `docs-links.test.mjs` 的 `EXTERNAL_ROUTES`（`/changelog`、`/download`、`/docs`）指向真实存在的位置，而不是注释里说的"external site"（实际不存在）。
- 文档随发布更新（或文档站独立更新），不再需要手工动作。

## 现状与证据

- `public-docs/*.md` 带 frontmatter（`title/nav/order/category`）——是某个静态文档框架的源格式，但仓库里没有该框架的构建配置。
- `scripts/docs-links.test.mjs` 只校验链接存在性，不部署；byissue/ 明确跳过。
- 引用坏链的位置：`packages/client/README.md`（`app.byspace.cc.cd/docs/sdk`）、`SECURITY.md`、`public-docs/web-ui.md` 内部互链（`/docs/connectivity` 等）。
- 托管侧（073 后）：`byspace-relay` Worker 的 `[assets]` 只服务 `packages/app/dist`；`/docs/*` 落进 SPA 回落。

## 影响面与方案（待设计拍板）

三选一（按倾向排序）：

1. **并入 relay Worker**：构建静态文档产物进 assets（例如 starlight/astro build 到 `dist/docs`，或极简自研 md→html）。与 073 的"一个部署单元"哲学一致；代价是引入一个文档框架依赖。
2. **独立 Worker/Pages**：文档站单独部署。代价是回到两个部署物。
3. **砍掉 public-docs**：文档全部并入 app 内置（设置页/帮助页）或 GitHub README。最省，但丢独立文档 URL。

## 验收

- `app.byspace.cc.cd/docs/sdk` 等引用 URL 返回真实文档内容（HTTP 200 + 文档 body，非 index.html）。
- `docs-links.test.mjs` 的 EXTERNAL_ROUTES 与真实部署位置一致。
- 发布流程（release.md）覆盖文档更新路径。

## 决策记录

- **2026-10-10** 用户拍板：从 073 的尾巴独立成 issue。073 执行记录里保留了发现现场。
