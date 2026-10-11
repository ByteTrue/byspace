---
kind: issue
title: "Tunnels 列表首次加载卡 Loading"
type: bug
status: closed
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

3. **React Compiler 冻结了 key 的计算**（真正的主因）：`app.config.js` 开了 `reactCompiler: true`。两个 hook 都用 `useMemo(..., [..., version])` 配合 `void version;` 把 `useSyncExternalStore` 的版本号当依赖提示——**编译器按数据流推导依赖，`void version;` 不产生任何数据流，被当成死代码删掉**，于是生成的缓存守卫里没有 `version`，而 `serverIds` / `store` 是稳定的，memo 算一次就永远返回缓存值。实测同一帧内 `runtime.getSnapshot()` 读到 `online/online`，而 memo 出来的 key 仍是 `connecting|online`，连续 12 次渲染不变。（单文件 Babel 编译对照见 docs/react-compiler.md。）

**为什么既有 e2e 没挡住**：添加流程的 spec 走 `refetch`，不依赖 key 变化；而这个 bug 只在"首次加载时隧道已存在"的路径上出现。

## 修复

- `aggregated-tunnels.ts`：补齐 schedules 那道收尾保护；`isTunnelHostSettling` 把"无 snapshot"和"online 但无 client"都算作未定；一次读取 host 视图，避免同一次计算里两次读取互相矛盾。
- `host-runtime.ts`：新增 `useHostRuntimeClientReadyKey`（client 挂载状态进 queryKey），并给它与 `useHostRuntimeConnectionStatuses` 都加 `"use no memo"`，绕开编译器对可变 store 读取的错误缓存。`useHostRuntimeConnectionStatuses` 是**既有 hook**，同样被冻结——schedules 等所有用它拼 key 的地方都受影响。

## 验证

- 新增 e2e `tunnels-list-first-load.spec.ts`：隧道在页面加载前就存在（经 D1 的 RPC 建，不经 GUI），断言列表行直接出现、无 "No tunnels yet"。修复前稳定失败，修复后连跑通过。
- 新增 `aggregated-tunnels.test.ts` 6 例：online 无 client、无 snapshot、connecting、正常加载、真空、全 offline。
- 既有添加流程 spec 仍通过；`src/hooks` + `src/tunnels` + `src/schedules` 405 个单测通过。

## 同类风险（已在本 issue 一并处理）

`void <counter>;` 当依赖提示的写法还有 6 处，已全部加上 `"use no memo"`。逐一编译验证的结果：

| 文件                                       | 编译器是否处理该函数             | 处理前状态                                                     |
| ------------------------------------------ | -------------------------------- | -------------------------------------------------------------- |
| `hooks/use-agent-history.ts`               | 是                               | **真冻结**（`runtimeVersion` 在编译产物里只剩声明处 1 个引用） |
| `panels/panel-instance-attributes.ts`      | 是                               | **真冻结**（`revision` 同上）                                  |
| `hooks/use-projects.ts`                    | 否（bail：render 期间读 ref）    | 侥幸安全                                                       |
| `hooks/use-aggregated-agents.ts`           | 否（bail：同上，11 处）          | 侥幸安全                                                       |
| `agent-stream/strategy-web.tsx`            | 否（bail：incompatible library） | 侥幸安全                                                       |
| `components/provider-diagnostic-sheet.tsx` | 否（bail：所在函数含 `finally`） | 侥幸安全                                                       |

**bail 是偶然的，不是设计**：只要未来某个重构去掉了触发 bail 的条件（比如把读 ref 挪出去、换个库），这些 memo 就会静默变成冻结的。所以 6 处都加了指令，而不是只修那 2 处。

## 关闭结论

三个缺陷都已修复并验证：aggregate 的收尾保护、queryKey 的 client 就绪信号、以及 React Compiler 对 key 计算的冻结（含既有的 `useHostRuntimeConnectionStatuses`）。同类风险的 6 处已一并加指令。

**质量证据**：`tunnels-list-first-load.spec.ts`（修复前稳定失败 → 修复后通过）与既有添加流程 spec 均通过；`src/hooks` + `src/tunnels` + `src/panels` + `src/schedules` 424 个单测通过；typecheck / lint / format:check 全绿。`agent-stream-ui.spec.ts` 的 3 例失败已在 stash 掉全部改动后复现于基线，确认非本 issue 引入。

**回写位置**：坑点进 [docs/react-compiler.md](../../docs/react-compiler.md)（新文档，AGENTS.md 表加索引）；本 issue 留执行历史与验证证据。前端查询层没有对应的 project spec 章节，无可毕业的稳定结论。

**遗留**：下面那 2 例既有 e2e 失败 + 1 例 flaky 未记录在任何 issue 里，需单独跟进。

## 验收时发现的既有失败（与本 issue 无关）

`agent-stream-ui.spec.ts` 有 2 例在**基线（stash 掉本 issue 全部改动）上同样失败**，已排除为本 issue 引入：

- `keeps the viewport fixed when delayed authoritative history arrives after scroll-away`（:195）
- `shows elapsed timer on first app-created running turn`（:385）

另有一例 `auto-scroll sticks to bottom across token bursts`（:58）在完整文件跑时偶发失败，单独跑稳定通过，基线同样——判为 flaky，非本 issue 引入。这三例都未记录在任何 issue 里，需要单独跟进。

## 知识沉淀

坑点写进 [docs/react-compiler.md](../../docs/react-compiler.md)，并在 AGENTS.md 的 docs 表加了索引行。文档包含：失败模式的编译产物对照、为什么没有更窄的修法（用值、当分支条件、去掉 useMemo 都不行）、如何用 Babel 单独编译一个文件看编译器到底做了什么、以及为什么不能只排查"当前被编译的"那几处。
