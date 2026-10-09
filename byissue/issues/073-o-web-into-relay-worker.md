---
kind: issue
title: "托管形态统一：Web 前端并入 relay Worker，Pages 退役"
type: feature
created: 2026-10-10
---

<!-- 读者：跨会话接手的人。目标与范围 · 根因证据 · 现状怎么工作 · 影响面 · 方案 · 验证 · 关闭回写 -->

# 托管形态统一：Web 前端并入 relay Worker，Pages 退役

## 为什么做

issues/061-x-self-hosted-web-relay-containers.md（PR #13）把自托管产物收敛成「一个容器、一个 origin」：`/` 静态 Web、`/ws` relay、`/health`，Node adapter 自带 `BYSPACE_WEB_DIR` 静态回落。官方托管却是两个平台、三个部署物：Cloudflare Pages 两项目（`byspace` / `byspace-beta`，自定义域 `app.byspace.cc.cd` / `app-beta.byspace.cc.cd`）+ relay Worker（`byspace-relay`，`relay.byspace.cc.cd`）。

用户拍板：合并有价值，核心动机是**官方托管产物与自托管产物形态统一**——「edge 是一个东西」，跑在 Cloudflare 是 Worker、跑在用户机器是容器，同一契约（`/` + `/ws` + `/health`）、同一 relay 核心（runtime-agnostic session core，`node-relay-e2e.test.ts` 断言与 Worker parity）。外部事实：Cloudflare 官方方向是 Workers static assets，Pages 处于维护态，晚迁不如早迁。

无账号系统、不商业化，一切从简。

## 做成以后是什么样

- `app.byspace.cc.cd` 由 `byspace-relay` Worker 直接服务：`/` 返回 `packages/app/dist` 静态导出，`/ws` `/health` 走 relay 逻辑，全部同源。
- 域名不变：自定义域从 Pages 解绑绑到 Worker，origin 不变——已装 PWA、localStorage 里的 host 配置、`app.byspace.cc.cd/#offer=...` 配对链接全部不受影响（SECURITY.md:23 的 fragment 论断依旧成立）。
- 云端发布一条命令：构建 app dist → `wrangler deploy`，UI 与 relay 原子同步上线、`wrangler rollback` 一起回退。
- Pages 项目 `byspace` / `byspace-beta` 退役。
- 与 `docker/Dockerfile`（web+relay 同容器 :8080）构成同一形状的两份实现。

## 影响面与方案（按批次）

### 批次 1 · Worker 静态资源（唯一的真代码）

- `packages/relay/wrangler.toml`：`[assets]` `directory = "../app/dist"`（相对 wrangler.toml 解析）、`not_found_handling = "single-page-application"`（`app.config.js` `output: "single"`）、`run_worker_first = ["/ws", "/health"]`——**必须**，否则 SPA 回落会把 `/ws` 吞成 index.html（glob 形式实现时核对）。
- `cloudflare-adapter.ts` fetch 尾部：非 relay 路径 fall through `env.ASSETS.fetch(request)`，语义对齐 `node-adapter.ts` 的 webDir 回落。
- dist 关键文件核对：`index.html`、`sw.js`（SW scope 需同源根路径）、`manifest.json`、`schemas/byspace.config.v1.json`（docker/Dockerfile 已断言存在）。
- 免费层事实核实：static asset 请求的计费口径（实现时查当期 Cloudflare 定价页；个人用量远低于任何档位，仅记录依据）。
- **`app.byspace.cc.cd/docs/*`（public-docs）的部署链路未在仓库内**——无 workflow、无构建脚本。实现前查清它挂在哪：若在 `byspace` Pages 项目下，一并迁入 Worker assets；若是独立平台或手动部署，不受影响。

### 批次 2 · 部署管线与域名

- `packages/app/package.json` 的 `deploy:web` / `deploy:web:beta`（`wrangler pages deploy dist`）退役；部署入口收敛到 relay 侧：`packages/relay` 加 `deploy` / `deploy:beta` 脚本（构建 app dist → `wrangler deploy [--env beta]`）；`[env.beta]` 用 `name = "byspace-relay-beta"` + `app-beta.byspace.cc.cd` 自定义域（若 wrangler env 对 assets 配置覆盖有限制，退两份配置文件）。
- `.github/workflows/deploy-app.yml` 改为部署 Worker。**这改写既有约定**：`docs/release.md` 与 `docs/architecture.md` 的「无 workflow 部署 relay、手动 `wrangler deploy`」变为「app 发布管线部署 Worker（UI + relay 一起）；relay 紧急修复仍可手动 `wrangler deploy`」。
- 域名切换：先在 workers.dev 预览域验证批次 1，再低峰解绑 Pages 自定义域、绑到 Worker。DNS 传播窗口内可能短暂 503。

### 批次 3 · 文档与收尾

- `docs/release.md`：发布矩阵「Web/PWA | Cloudflare Pages」行、relay 手动部署约定段、checklist 对应项；`docs/development.md` deploy:web 段落；`docs/architecture.md` 生产 relay 部署描述。
- `public-docs/` 无需改（用户侧只认域名，域名不变）。
- Pages 两项目删除或保留一段只读期（Cloudflare 控制台操作，不进仓库）。
- 残留扫描：`rg -i 'cloudflare pages|pages deploy'` 除 CHANGELOG、`.github/release/`、byissue/ 历史外零命中。

## 风险与缓解

- **relay 是远程访问生命线**：合并后 UI 发布失误理论上可波及 relay——`wrangler deploy` 是原子版本替换，出问题 `wrangler rollback` 整体回退；直连 LAN 路径不经 Worker，始终可用。
- 域名切换窗口：低峰操作，先预览域后正式域。
- e2e：`packages/app` 的 relay-deployment playwright project 走本地 Node relay，不受影响；`packages/relay/src/e2e.test.ts` 走 wrangler dev，天然覆盖合并后的 Worker；资产服务可加一条 wrangler dev 冒烟（进 CI 或手动，实现时定）。

## 待拍板

1. beta 渠道去留：**建议保留**——release-beta 流程在用，`[env.beta]` 实现成本很低。若嫌两份配置烦，也可只留 stable，代价是 beta 发布不再有 Web 预览面。
2. 部署命令归属：**建议放 `packages/relay`**（wrangler 配置在那里），`packages/app` 只留 `build:web`；根目录加一条 `deploy:hosted` 别名即可。

## 验收

- `app.byspace.cc.cd` 打开即完整 UI，同源 `/ws` 完成 daemon↔手机 E2EE 配对全链路。
- 一次 `wrangler deploy` 同时更新 UI 与 relay；`wrangler rollback` 一起回退（各验证一次）。
- `rg -i 'cloudflare pages|pages deploy'` 无活文档残留；release checklist 与新事实一致。
- beta 渠道有明确处置结果（保留 `[env.beta]` 或删除，二选一落地）。

## 决策记录

- **2026-10-10** 用户拍板：合并有价值，核心动机是官方托管产物与自托管产物形态统一；无账号系统、不商业化、从简。脉络：multica 对比讨论（账号系统否决）→ Docker 镜像现状核对（当日修复 5 处文档残留：CLAUDE.md 文档表行、public-docs/security.md Docker 段、public-docs/web-ui.md 默认值、public-docs/configuration.md 默认值、docs/development.md 默认值）→ 本 issue。
