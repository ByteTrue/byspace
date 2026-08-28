---
kind: issue
title: "导入 Web-only 源码并建立绿色构建"
type: feature
status: closed
created: 2026-08-27
closed: 2026-08-27
---

# 导入 Web-only 源码并建立绿色构建

## 做成以后

在 byspace 仓库执行一次干净依赖安装和 Web build，会从复制来的 Paseo Web 生成可安装的浏览器静态产物。构建不需要 `packages/desktop`、Node daemon、iOS/Android 工程或原生发布工具，页面和 manifest 使用 byspace 名称。

这是代码迁移的第一条正式骨架，不同时重写前端 client/protocol 或实现 Go daemon。

## 范围与边界

**导入：**

- `packages/app` 的共享/Web 源码、assets、public、Web 配置、浏览器单元/E2E 测试；
- `packages/client`、`protocol`、`relay`、`highlight`、`plugin`；
- 最小根 workspace、TypeScript 配置、构建脚本、许可证与 Web 依赖补丁。

静态导入确认 `expo-two-way-audio` 只从 `.native.ts` 动态加载，Web build 不需要该 workspace，因此不复制它。

**不导入：**

- `packages/desktop`、`server`、`cli`；CLI 将由 Go 重写；
- iOS/Android 应用工程、Fastlane、Maestro、EAS 与原生发布脚本；
- Paseo 的 Git/CI/release 配置和与本 Issue 无关的维护脚本；
- `packages/website` 与 Relay Worker 部署，它们仍在产品范围，但不属于 Web app 的首个构建闭包。

共享源码中的 `.native.*`、`.ios.*`、`.android.*` 和 browser-safe `src/desktop` adapter 暂不按名字批量删除；只有 Web 构建与 import graph 证明不需要时，才在后续裁剪。

## 实现方案

1. 先在 Paseo 参考仓库运行现有 `@getpaseo/app` Web build，记录上游基线是否绿色。
2. 只复制 Git 跟踪的选定 workspace 文件，避免带入 `node_modules`、`dist`、缓存和用户本地配置。
3. 将本仓库内部 package namespace 从 `@getpaseo/*` 机械改为 `@byspace/*`，版本从上游发布号改为新的项目初始版本；暂不重命名协议字段、类型名和存储 key 中的 `Paseo`，避免把品牌迁移与协议迁移绑在一起。静态审计已找到 451 个含内部 namespace 的文件，统一机械改名，避免维护双 namespace alias。
4. 根 `package.json` 只保留这六个 workspace 和真实需要的 build/typecheck/test 命令；保留 Apache-2.0 许可证和修改归属。
5. 用 Web-only Expo config 取代原生发布 config，保留 `expo-router`、Web favicon、typed routes 与 React compiler；manifest、HTML title 和默认可见名称改成 `byspace`。
6. 以复制的 upstream lock 为解析种子，按裁剪后的 workspace 重新生成 `package-lock.json`，再用 `npm ci` 证明干净安装。
7. 依次运行依赖 package build、app Web export、typecheck 和适合当前闭包的测试；只修复由导入和命名造成的问题。

## 风险穿刺

| 风险 | 怎样算打通 |
| --- | --- |
| Web 实际依赖被排除的 server/desktop package | 静态导入审计无此依赖，干净 Web build 成功 |
| Metro/Expo 在 Web build 时仍加载原生 app config | Web-only config 能导出，仓库没有 native app 工程和发布脚本 |
| 内部 package 改名破坏 workspace exports | 所有依赖 package build/typecheck 通过，源码无 `@getpaseo/*` import |
| lock 裁剪后补丁版本漂移 | `npm ci` 和 postinstall patch 成功，锁文件无 absent workspace link |
| “纯 Web”裁剪误删共享能力 | app export 通过，browser tests 在真实 Chromium 中全部通过 |

## 验收与质量证据

- `npm ci`
- `npm run build:web`
- `npm run typecheck`
- 相关 workspace tests；若上游测试硬依赖 Node daemon，只运行浏览器闭包可独立验证的部分并记录缺口
- `packages/app/dist/index.html`、`manifest.json` 和静态 assets 存在
- `rg '@getpaseo/'` 不命中产品源码和 package manifests；许可证/迁移证据中的历史引用除外
- `find`/workspace 审计确认没有 `packages/desktop`、`packages/server`、`packages/cli`、app `ios/`、`android/`、Fastlane、Maestro 或 EAS
- 产物可由静态 HTTP server 加载到应用壳；本 Issue 不要求连接 daemon

## 有意留下的兼容层

- `Paseo*` 类型名、协议 message type、环境变量与存储 key 暂保留；Go 协议 fixture Issue 决定哪些兼容、哪些版本化迁移。
- PWA 只保证可安装 manifest，不新增离线 Service Worker。
- 图标先保留上游资产以验证构建，但不能作为 byspace 最终品牌资产发布；正式视觉替换另行设计。

## 执行记录

- 参考源固定为干净的 Paseo commit `a8734a972495cf343f628d1017e87775767aade5`。初始复制 2,479 个受 Git 跟踪文件，排除 62 个 EAS/Fastlane/Maestro/native module config 文件。
- 尝试运行参考仓库的 `@getpaseo/app` Web build，但该干净工作树没有安装依赖，首先在 `@getpaseo/highlight` 以 `tsc: not found`（exit 127）停止；它没有形成“上游绿色”证据，也不是源码构建失败。为避免修改参考工作树，本轮没有在那里补装依赖，而以 byspace 的 `npm ci` 加完整构建链验证复制闭包。
- 最终 workspace 闭包为 `app`、`client`、`protocol`、`relay`、`highlight`、`plugin`；内部 namespace 全部改为 `@byspace/*`，没有复制 `desktop`、`server`、`cli`、`website` 或 `expo-two-way-audio`。
- 根依赖和 lock 已按裁剪闭包重建；Web-only Expo config、PWA manifest、HTML title、默认 Relay 域名和 Cloudflare Worker 名称均切换到 byspace。`LICENSE` 保留 Apache-2.0，`NOTICE` 记录来源与修改范围。
- `npm ci` 成功并应用五个 Web 所需补丁；`npm run build:web` 从 3,104 个模块导出 `packages/app/dist`，静态 HTTP smoke 验证 title 与 manifest 可读。
- 全 workspace typecheck 通过；单元/Worker 测试合计 646 个 test files、5,667 个 tests 通过，另有 1 个 Worker test file / 1 个 test 按上游条件跳过；lint 为 0 error、6 个上游/生成代码 warning。
- package tree 通过 `npm ls --all`。生产依赖审计为 0 critical、18 high、12 moderate、1 low；其中高危余项主要由 Expo 54 工具链和 markdown 渲染链带入，修复要求 Expo major 升级或上游依赖变更，未在本导入 Issue 内做破坏性升级。
- 初始 Playwright 1.58.2 拒绝为 Ubuntu 26.04 安装浏览器。升级到已支持 Ubuntu 26.04 的 Playwright 1.62.1 后，从官方 Google Chrome for Testing artifact 安装并校验 Chrome Headless Shell 151.0.7922.34；11 个 browser test files / 103 个 tests 全部通过。

## 关闭结论

Web-only 源码闭包已经以可重复的干净安装、静态导出、类型检查、单元测试、真实 Chromium 浏览器测试、依赖树和范围审计证明，达到本 Issue 目标。保留的 Paseo 协议/类型/存储兼容层继续作为下一步 Go 协议 fixture 的迁移标尺；品牌图标与依赖审计余项作为明确残余风险保留，不伪装为已完成。
