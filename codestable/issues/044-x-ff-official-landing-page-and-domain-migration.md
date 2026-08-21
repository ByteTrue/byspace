---
type: ff
status: closed
created: 2026-08-21
closed: 2026-08-21
title: Official landing page and byspace.cc.cd domain migration
---

# 044-x-ff-official-landing-page-and-domain-migration

## 做了什么

1. **域名体系迁移至 `byspace.cc.cd`**：
   - 根域名与落地页：`https://byspace.cc.cd`
   - Web 客户端 (Stable)：`https://app.byspace.cc.cd`
   - Web 客户端 (Beta)：`https://app-beta.byspace.cc.cd`
   - E2EE Relay (Stable)：`relay.byspace.cc.cd:443`
   - E2EE Relay (Beta)：`relay-beta.byspace.cc.cd:443`
   - 配置 Cloudflare Pages 与 Cloudflare Workers Custom Domains，全量完成 SSL 证书生成与 HTTP 200 验证。
2. **构建与上线官方落地页 (`packages/website`)**：
   - 采用 React 19 + Vite + Tailwind CSS + Framer Motion 纯静态架构，800ms 极速构建纯静态产物（零服务器运行时依赖）。
   - 实现交互式多 Agent 工作区模拟器 (`HeroMockup`)、光标互动蝴蝶 Canvas 粒子引擎 (`butterfly.tsx`)、三机透视浮动手机展示 (`PhoneShowcase`)。
   - 实现端到端加密架构拓扑图（Client <-> Relay <-> Hosts 动态贝塞尔曲线）、多 Provider 切换器、Worktree 审查流、本地语音波形与命令行演示。
   - 部署至 Cloudflare Pages 项目 `byspace-landing` 并成功绑定根域名 `https://byspace.cc.cd`。
   - 接入 monorepo 统一构建与类型检查。

## 改了哪些

- `packages/website/`：完整落地页工程（`index.html`, `src/App.tsx`, `src/main.tsx`, `src/styles.css`, `src/components/`, `vite.config.ts`, `package.json`, `wrangler.toml`）。
- `packages/protocol/src/release-channel.ts` & `connection-offer.ts`：更新默认生产与测试域名。
- `packages/relay/wrangler.toml`：更新 Cloudflare Worker Custom Domain 路由规则。
- `package.json`、`README*.md`、`SECURITY.md`、`docs/`、`public-docs/`：清理所有旧域名引用。

## 怎样验证

1. `curl -I https://byspace.cc.cd` -> 返回 HTTP 200。
2. `curl -I https://app.byspace.cc.cd` -> 返回 HTTP 200。
3. `curl -I https://relay.byspace.cc.cd/health` -> 返回 HTTP 200。
4. `npm run build --workspace=@bytetrue/byspace-website` -> 静态资源顺利生成至 `packages/website/dist`。
5. `npm run typecheck` & `npm run lint` & `npm run format` -> 0 错误 0 警告。
6. `npx vitest run packages/server/src/server/daemon-e2e/connection-offer.e2e.test.ts packages/protocol/src/release-channel.test.ts --bail=1` -> 全部通过。

## 对 codestable 的影响

- 更新 `codestable/spec/index.md` 身份与发布段落中的 Web / Relay 正式端点。
