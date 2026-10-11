---
kind: issue
title: "Tunnels 列表首次加载卡 Loading"
type: bug
status: open
created: 2026-10-11
---

# Tunnels 列表首次加载卡 Loading

> **读者：** 接手前端查询层的人。现象、已排除项、待查方向都在下面，不需要重跑双机环境。

## 现象

打开 `/tunnels`（侧栏 BySpace 菜单或命令中心进入）时，隧道列表区显示 `Loading...`，**列表不出现**。同一时刻：

- `client.listTunnels()` RPC 直查**正常返回**（`[{tunnelId: "srv_...:3000", state: "connected", localPort: 65379}]`）
- `getDaemonConfig()` 正常（`tunnel.enabled = true`）
- 两个 host 的 `connectionStatus` 都是 `online`，`getClient` 都返回 client

**刷新页面同样复现**，不是长驻页面的状态累积。

## 已排除

- **不是 RPC 层**：同上，直查返回正确数据。
- **不是连接层**：两个 host 的 `activeClient.connectionState.status === "connected"`、`password` 都在。
- **不是本批次改动**：`hooks/use-tunnels.ts`、`data/query.ts`、`tunnels/aggregated-tunnels.ts` 均未改动。
- **不是环境冲突**（这条花了不少时间排除）：曾经怀疑 `EXPO_PUBLIC_LOCAL_DAEMON` 注入的无密码连接与手工配对的带密码 host 打架，但换成不注入 override 的启动方式后**同样复现**。

## 为什么既有 e2e 没挡住

`packages/app/e2e/browser/tunnels-screen.spec.ts` 断言的是**添加流程**：`tunnels-add` 按钮 → 填表 → `tunnels-row-outbound` 出现。添加成功后走的是 `refetch`，那条路径正常。**列表的首次渲染（无隧道 → 有隧道之前的那一帧）没有断言覆盖**。

## 根因（已定位并修复）

三个缺陷叠在一起，缺一个都不会有这个症状：

1. **aggregate 把"还没问"当成"没有"**：`fetchAggregatedTunnels` 只在 `!hasAskableHost && hasSettlingHost` 时返回 `connecting`，而 `hasSettlingHost` 只认 `connectionStatus === "connecting"`。运行时把 host 的连接状态和它的 client 分两次 tick 发布，于是存在一个窗口：状态已是 `online`、client 还没挂上。旧代码在这个窗口里既不算 settling（状态不是 connecting）、也问不到东西（client 为 null），直接返回 `loaded: []`。**schedules 有一道收尾保护 `if (data.length === 0 && hasSettlingHost) return connecting`，tunnels 漏了。**

2. **queryKey 看不见第二个 tick**：key 由连接状态拼成，而"online 无 client"和"online 有 client"的状态串**完全相同**，所以 aggregate 即使正确返回了 `connecting`，key 不变 → React Query 不重跑 → 那个 `connecting` 被永久缓存，页面停在 Loading。

3. **React Compiler 冻结了 key 的计算**（真正的主因）：`app.config.js` 开了 `reactCompiler: true`。两个 hook 都用 `useMemo(..., [..., version])` 配合 `void version;` 把 `useSyncExternalStore` 的版本号当依赖提示——这个写法对编译器不可见，编译器认为 `store.getSnapshot()` / `store.getClient()` 是纯读，于是把整个 memo 提升并缓存，**key 冻结在第一次渲染的值**。实测同一帧内 `runtime.getSnapshot()` 读到 `online/online`，而 memo 出来的 key 仍是 `connecting|online`，连续 12 次渲染不变。

**为什么既有 e2e 没挡住**：添加流程的 spec 走 `refetch`，不依赖 key 变化；而这个 bug 只在"首次加载时隧道已存在"的路径上出现。

## 修复

- `aggregated-tunnels.ts`：补齐 schedules 那道收尾保护；`isTunnelHostSettling` 把"无 snapshot"和"online 但无 client"都算作未定；一次读取 host 视图，避免同一次计算里两次读取互相矛盾。
- `host-runtime.ts`：新增 `useHostRuntimeClientReadyKey`（client 挂载状态进 queryKey），并给它与 `useHostRuntimeConnectionStatuses` 都加 `"use no memo"`，绕开编译器对可变 store 读取的错误缓存。`useHostRuntimeConnectionStatuses` 是**既有 hook**，同样被冻结——schedules 等所有用它拼 key 的地方都受影响。

## 验证

- 新增 e2e `tunnels-list-first-load.spec.ts`：隧道在页面加载前就存在（经 D1 的 RPC 建，不经 GUI），断言列表行直接出现、无 "No tunnels yet"。修复前稳定失败，修复后连跑通过。
- 新增 `aggregated-tunnels.test.ts` 6 例：online 无 client、无 snapshot、connecting、正常加载、真空、全 offline。
- 既有添加流程 spec 仍通过；`src/hooks` + `src/tunnels` + `src/schedules` 405 个单测通过。

## 同类风险（未在本 issue 处理）

`void <var>;` 当依赖提示的写法在仓库里还有若干处（`use-projects.ts`、`use-agent-history.ts`、`use-aggregated-agents.ts`、`panel-instance-attributes.ts`、`strategy-web.tsx`、`provider-diagnostic-sheet.tsx`）。它们的 memo 是否也被编译器冻结未逐一验证，但机制相同。建议单独排查。
