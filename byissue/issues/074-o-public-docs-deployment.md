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

issues/073-x-web-into-relay-worker.md cutover 期间钉死的事实：`public-docs/`（用户文档 + SDK 文档源）**没有任何部署链路**——不在任何 workflow、任何构建脚本里。线上 `app.byspace.cc.cd/docs/*`（被 `packages/client/README.md`、`SECURITY.md` 引用的 SDK 文档 URL）现在被 SPA 回落兜成 index.html，是**功能性坏链**：用户点开文档链接，得到的是 BySpace app 本体。

Pages 时代它同样是坏链（同一回落行为），所以这不是 073 引入的回归——它只是让这个真空显形了。

## 做成以后是什么样

- `app.byspace.cc.cd/docs/<name>` 返回 `public-docs/<name>.md` 的渲染产物（或重定向到真实的文档站）。
- `docs-links.test.mjs` 的 `EXTERNAL_ROUTES`（`/changelog`、`/download`、`/docs`）指向真实存在的位置，而不是注释里说的"external site"（实际不存在）。
- 文档随发布更新（或文档站独立更新），不再需要手工动作。

## 现状与证据

- `public-docs/*.md` 带 frontmatter（`title/nav/order/category`）——是某个静态文档框架的源格式，但仓库里没有该框架的构建配置。
- `scripts/docs-links.test.mjs` 只校验链接存在性，不部署；byissue/ 明确跳过。
- 引用坏链的位置：`packages/client/README.md`（`app.byspace.cc.cd/docs/sdk`）、`SECURITY.md`、`public-docs/web-ui.md` 内部互链（`/docs/connectivity` 等）。
- 托管侧（073 后）：`byspace-relay` Worker 的 `[assets]` 只服务 `packages/app/dist`；`/docs/*` 落进 SPA 回落。

## 方案（已拍板：并入 relay Worker，同一域名同一部署单元）

`app.byspace.cc.cd/docs/*` 与 `/changelog` 由 `byspace-relay` Worker 的同一份 `[assets]` 服务——不新建 Worker、不新域名、不引文档框架。与 073 的「一个部署单元」哲学一致，发布链零改动（`build:web` 之后 `wrangler deploy`，docs 随发版原子上线）。

技术可行性三事实（2026-10-10 实证）：

- relay Worker 只处理 `/ws` `/health`，`/docs/*` 落 assets 路由，有真实文件时优先于 SPA 回落——这正是修复坏链的机制。
- `sw.js` 是 push-only、无 fetch handler（文件头注释写明刻意如此），不会劫持 `/docs` 导航。
- 同 origin 无 CORS；`markdown-it` 已是 app 依赖，35 个 md 渲染为纯静态 HTML，无需 Astro/Starlight（体量不配，且违背从简原则）。

实现要点：

- **渲染管线**：小 mjs 脚本（读 `public-docs/` + `CHANGELOG.md`，markdown-it 渲染，frontmatter `title/nav/order/category` 生成导航与 SEO 头），输出 `packages/app/dist/docs/` 与 `dist/changelog.html`；挂在 `build:web` 之后（`build:docs` 或并入同一步）。
- **模板**：每页极简 HTML（站点头 + 导航 + 内容 + 内联小 `<style>`，色板复用 app 主题 tokens，不依赖 app bundle）。
- **`docs-links.test.mjs`**：`EXTERNAL_ROUTES` 里删 `/docs`、`/changelog`；`/docs/thing` 按仓库内 `public-docs/thing.md` 校验（现有行为），修掉「external site」的误导注释。
- **`/download` 显式不做**：目前无真正可直接下载的产物（只有 npm 包与容器镜像，无 GitHub Release 二进制），空壳页比坏链更差。等有可下产物时再开（引用处维持指向 GitHub Releases 或直接删链接）。

遗留边界（实现时处理）：

- `packages/client/README.md`、`SECURITY.md` 里的 `/docs/sdk` 引用 URL 验证。
- `public-docs/sdk/` 的相对链接在渲染后的路径正确性。
- `CHANGELOG.md` 大小（渲染单页可能偏大，必要时分版本截断——实现时看产物体积再定）。

## 验收

- `app.byspace.cc.cd/docs/sdk` 等引用 URL 返回真实文档内容（HTTP 200 + 文档 body，非 index.html）。
- `docs-links.test.mjs` 的 EXTERNAL_ROUTES 与真实部署位置一致。
- 发布流程（release.md）覆盖文档更新路径。

## 决策记录

- **2026-10-10** 用户拍板：从 issues/073-x-web-into-relay-worker.md 的尾巴独立成 issue，发现现场保留在其执行记录里。
