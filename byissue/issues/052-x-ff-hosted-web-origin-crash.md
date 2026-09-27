---
kind: issue
title: "修复线上 Web 在默认端口 origin 下启动即崩溃"
type: ff
status: closed
created: 2026-09-27
---

# 修复线上 Web 在默认端口 origin 下启动即崩溃

## 预期与实际

预期：打开 `https://app.byspace.cc.cd` 正常进入应用。

实际：v0.16.2 部署后，打开即白屏报错 `Invalid host:port (expected localhost:6777)`，崩溃点在 `CommandCenterRootActions` → `useImportSession` → `useHostChooser` 渲染路径，整棵组件树挂掉。局域网 `http://ip:6777` 或本地 `localhost:8081` 不受影响。

## 根因

`packages/app/src/hooks/use-is-local-daemon.ts` 的 `browserOriginHost()` 把 `window.location.host` 直接喂给 `normalizeHostPort`。HTTPS 默认端口（443）会被浏览器从 `location.host` 中省略，得到 `app.byspace.cc.cd`（无端口），而 `parseHostPort` 要求显式 `host:port`，正则不匹配即 throw。该 throw 发生在渲染期 `useMemo` 内，无 try/catch，直接炸掉启动渲染。

局域网/本地开发 origin 永远带端口，所以这个隐患只在「反代 + TLS 标准端口」部署形态下暴露。

## 改了哪些

- `packages/app/src/hooks/use-is-local-daemon.ts`：`browserOriginHost()` 在 `location.port` 为空时按 `location.protocol` 补回默认端口（https→443、http→80）再做归一化；origin 因此始终是可比较、可解析的 `host:port`。公开域名解析不出 local daemon 时正常返回 null，走既有的宿主选择逻辑。
- `packages/app/src/hooks/use-is-local-daemon.test.ts`：新增 5 个用例覆盖显式端口透传、443/80 默认端口补回、回环归一化、无 window 环境。

## 怎么确认好了

- `npx vitest run src/hooks/use-is-local-daemon.test.ts` 全绿（含复刻产线 origin `app.byspace.cc.cd:443` 的用例）。
- `npm run typecheck`、`npm run lint` 全绿。
- 排查期间发现本 checkout 的 `node_modules/@bytetrue` workspace 链接整体缺失（`build:client`/CLI typecheck 的 TS2307 同根因），根目录 `npm install` 恢复链接后重建 `build:server` 刷新过期 dist（旧产物还是 paseo 改名前的），typecheck 才转绿。

## 上线

随 v0.16.3（tag 5783c2a34）于 2026-09-27 发布：CI 绿、Publish npm / Deploy App / Docker / Release Notes Sync 全绿，npm latest 与 GitHub Release 均已就位，浏览器实测 `https://app.byspace.cc.cd` 首屏正常渲染，崩溃消失。
