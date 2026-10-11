---
kind: issue
title: "e2e 在 Windows 上按 / 分割路径，项目行永远找不到"
type: bug
status: closed
created: 2026-10-11
---

# e2e 在 Windows 上按 / 分割路径，项目行永远找不到

> **读者：** 接手 e2e 基建的人。CI 只跑 ubuntu，所以这条链在 Windows 上从来没被验证过；三个 spec 因此在本机稳定失败，在 CI 稳定通过。

## 现象

在 Windows 上跑 `agent-stream-ui.spec.ts`、`launcher-tab.spec.ts` 时，凡是走 `withWorkspace()` → `navigateTo()` 的用例，都在 `workspace-setup.ts:80` 失败：

```
locator('[data-testid^="sidebar-project-row-"]')
  .filter({ hasText: 'C:\\Users\\byte\\AppData\\Local\\Temp\\stream-first-app-turn-timer-iGVSfi' })
Expected: visible
Error: element(s) not found
```

页面此时显示 “No projects yet”，但 daemon 里项目是建好的 —— 侧栏只是匹配不上。

## 根因

`packages/app/e2e/support/helpers/workspace-setup.ts:70` 的 `projectNameFromPath` 只按 `/` 分割：

```ts
return repoPath.replace(/\/+$/, "").split("/").findLast(Boolean) ?? repoPath;
```

Windows 路径用 `\\`，于是它返回**整条路径**而不是末段。产品侧算显示名用的是 `lastPathSegment`（`packages/server/src/server/project-key.ts:50`，按 `/[\\/]/u` 分割）—— 侧栏渲染的是 basename。`hasText` 是子串匹配，拿整条路径去匹配 basename 永远不中。

对照：`/tmp/byspace/foo` → `foo`（正确）；`C:\\Users\\...\\foo` → `C:\\Users\\...\\foo`（错误）。

## 为什么 CI 没挡住

`.github/workflows/ci.yml` 的 8 个 playwright shard 全部 `runs-on: ubuntu-latest`，Windows 上跑的是 server-tests 和 terminal-performance。这条路径在 Windows 上没有任何覆盖。

## 同类位置（同一 bug）

`packages/app/e2e/support/helpers/app.ts:142` 有同样的写法：

```ts
const basename = trimmedDirectory.split("/").findLast(Boolean) ?? trimmedDirectory;
```

这个文件紧邻的几行已经在处理 macOS 的 `/private/var` 前缀，说明它本就打算跨平台。

## 修复

两处都改成按 `/[\\/]/u` 分割，与产品侧的 `lastPathSegment` 对齐。不引依赖、不改产品代码。

## 验证

修复前在 Windows 上稳定失败、修复后通过；`launcher-tab.spec.ts` 的 2 例同因失败一并修复。CI（ubuntu）保持通过。

## 验收时另发现的两例（不同根因，未修）

这两例与路径分割无关，都在改动前后同样失败（已用 stash 对照），CI（ubuntu）上通过。

### `agent-stream-ui.spec.ts:58` — 内容高度不增长

`agent-stream-ui.spec.ts:58`（`auto-scroll sticks to bottom across token bursts`）在 Windows 上稳定失败（连跑 4/4），但**与上面的路径分割 bug 无关**，也已排除是本仓库近期改动引入：

- 失败点是 `waitForContentGrowth`：`contentHeight` 停在 532 不增长，10s 超时。
- 失败页面快照是 **“Workspace unavailable”**，不是列表匹配问题。
- 该用例走 `startRunningMockAgent`（`client.createWorkspace` + 直接 `page.goto(route)`），不经过 `withWorkspace`/`projectNameFromPath`。
- **对照实验**：在 `c1ad7e676`（本 issue 全部改动之前）上同样失败；同文件的 `:77`、`:369` 用同一个 helper 却通过；CI（ubuntu）上通过（14.6s）。

现象指向“页面认为 workspace 不存在 → 不渲染 agent 内容 → 内容高度不增长”。尚未定位到是路由解析、workspace 列表可见性还是 Windows 路径归一化。需要单独排查。

### `launcher-tab.spec.ts:229` — 终端内容超时

`launching a profile from the New tab menu drops its empty prompt argument` 在 `terminal-perf.ts:73` 超时（`Terminal content did not match predicate within 30000ms`）。走的是终端渲染链路，与路径分割无关；单独跑同样失败，基线（stash 掉本 issue 改动）同样失败。

## 相关

首次发现于 `076-x-tunnel-list-first-load-stuck-loading` 的验收（当时判定为既有失败、与本 issue 无关）。
