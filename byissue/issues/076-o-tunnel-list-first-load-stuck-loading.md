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

## 待查方向

`useTunnels` 的返回在 `query.data?.status` 既非 `connecting` 也非 `loaded` 时给出 `{status:"loading"}`——也就是 `query.data === undefined`。而 `fetchAggregatedTunnels` 在"两个 host 都 online 且有 client"时**必然返回 `loaded`**（该函数已逐行核对）。所以嫌疑集中在查询**没有被执行或没有完成**：

1. `useFetchQuery` 的 `dataShape: "list"` 会挂 `placeholderData: keepPreviousData`，配合 `staleTimeMs: 5000`；hosts 从 `[]` → `[a,b]` 与 `connectionStatusKey` 从 `connecting|connecting` → `online|online` 会连续换两次 queryKey，中间查询可能被取消而最后一次没落地。
2. `connectionStatusKey` 进 queryKey 是 062 修"冷深链卡 connecting"时加的；那条路径修好了，这条没有。
3. 需要验证的是 **React Query 缓存里那个 key 的实际状态**（`query.state.status` / `fetchStatus` / `data`）。当时调试时 `queryClient` 没有暴露到 window，无法直接读。

## 验证口径

- 新增 e2e：**页面加载时隧道已存在**（daemon 预置一条隧道，不经过添加流程），断言列表行直接出现——这条用例应当能复现当前的 Loading。
- 修好后单测覆盖 `useTunnels` 在 queryKey 连续变化下的返回序列。
