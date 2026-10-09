---
kind: issue
title: "本地 daemon 判定重做：回环 endpoint 语义取代页面 origin 语义，清死代码"
type: refactor
created: 2026-09-28
---

<!-- 读者：跨会话接手的人。目标与范围 · 现状怎么工作 · 方案 · 验证 · 关闭回写 -->

# 本地 daemon 判定重做：回环 endpoint 语义取代页面 origin 语义，清死代码

## 为什么做

057 破案后发现 `use-is-local-daemon.ts` 的判定（浏览器 origin === host 的 directTcp endpoint）度量的是「你在哪打开网页」，却被四处当「这个 daemon 是不是我的本机 daemon」用。用户主力从云端 Web（relay）管理本地与远程主机，此时所有「本机优先」行为静默失效。

**拍板（用户，2026-09-28）：** 判定依据改为「该 host 的 directTcp endpoint 是否为回环地址」（host registry 本来就记着 endpoint，host-chooser 界面也在展示它）；「页面由哪个 daemon 服务」这个真正的 origin 问题保留 origin 判定。两个语义分家。

## 语义分家

**问题一：「这个 daemon 是不是本机（回环）daemon」→ endpoint 回环判定。** 消费点：

- `settings-screen.tsx`（729/876）：host 列表本机优先排序 + 默认选中回退
- `hosts/host-chooser.tsx`、`components/hosts/host-picker.tsx`：local-first 排序
- `workspace/workspace-screen.tsx`：本机 host 不显示 badge
- `app/settings/[section].tsx`：旧路由 `/settings/daemon` 重定向到本机 daemon 设置页
- `open-project-screen.tsx`：配对设备瓦片 + PairDeviceModal 的 serverId（配对本身支持 relay，云端 Web 下不应隐藏）

**问题二：「这个 host 是不是正在给页面服务的 daemon」→ 保留 origin 判定。** 唯一消费点：

- `host-page.tsx` `!isLocalDaemon` → `UpdateDaemonCard`：页面由该 daemon 服务时，更新会重启 daemon 杀掉页面自身；云端打开时页面由云端服务，更新卡显示且更新安全。**此项不得换成回环判定**（换掉会把「云端更新家里 daemon」这个成立场景错误隐藏）。

**接受的限制：** ssh 隧道等把远程 daemon 映射到本机回环端口的注册方式会被判为「本机」。后果仅限排序/badge/重定向等展示层，且配对等功能经隧道本就可用；不做指纹级本机验证（web 无此能力）。

**死代码（同主题顺带清理，issue 025 Electron 退役残留）：** `open-in-editor/button.tsx`、`open-in-editor/directory.ts`、`components/file-explorer-pane.tsx`、`git/diff-pane.tsx` 四处把 `useIsLocalDaemon` 喂给 `useDesktopOpenTargets`（空 shim，`targets` 恒空、`isAvailable` 恒 false）与 `planWorkspaceOpenTargets` 的 desktop 源。删除这四处对 hook 的消费与 `isLocalExecution` 管道；`desktop-open-targets.ts` shim 本体与其余消费不在本 issue 范围。

## 方案

`packages/app/src/hooks/use-is-local-daemon.ts` 重排为两组 API：

- **回环语义（名字回归直觉）**：`useLocalDaemonServerId()` / `useLocalDaemonServerIdState()` 重写为「首个 directTcp endpoint 为回环地址的 host」；`isLoopbackEndpoint` 用 protocol 的 `normalizeLoopbackToLocalhost(normalizeHostPort(endpoint))` 判定（转换后以 `localhost:` 开头即回环；socket/pipe 等非法 endpoint 捕获后返回 false）。
- **origin 语义（改名讲实话）**：`useServingDaemonServerId()` / `useServingDaemonServerIdState()` / `useIsServingDaemon(serverId)` 承接原 origin 实现；`browserOriginHost()` 不动。

消费点改 import：上表问题一的 6 处用回环语义；`host-page.tsx` 用 `useIsServingDaemon`（`RemoveHostSection` 的 `isLocalDaemon` prop 与文案语义随查随定：讲「这台设备」的用 serving，讲「这台机器」的用回环）。

## 验证

- 单元：hook 测试重写——回环 endpoint（localhost / 127.0.0.1 / [::1] / 127.x 段）命中、LAN IP 与 relay-only 不命中、registry 未加载时 pending、非法 endpoint 不崩。
- `npm run typecheck`、`npm run lint`、`npm run format`、相关 vitest 文件。
- 浏览器：dev app（origin 127.0.0.1:8081 ≠ endpoint 6778，旧判定必然失效的场景）验证修复后本机语义恢复——open-project 屏的配对瓦片出现（旧判定下必隐藏）、host 设置页正常。

## 执行记录

### 2026-09-28 · 实现与验证

- **hook 重排**（`use-is-local-daemon.ts`）：`useLocalDaemonServerId(State)` / `useIsLocalDaemon` 重写为回环语义（纯函数 `resolveLocalDaemonServerId` + `isLoopbackEndpoint` 可直接测）；origin 语义改名为 `useServingDaemonServerId(State)` / `useIsServingDaemon`。回环判定复用 protocol 的 `normalizeLoopbackToLocalhost`（127.0.0.1 / 0.0.0.0 / ::1 / :: → localhost；127.0.0.2 等非常规回环不命中，与 origin 判定的既有口径一致，非 127.x 段全匹配）。
- **消费点**：五个回环语义消费点函数名未变，零改动自动切换语义；`host-page.tsx` 改用 `useIsServingDaemon`，`RemoveHostSection` prop 改名 `isServingDaemon`（文案讲「本设备的 localhost 连接/内置 daemon」，保持 serving 口径）。
- **死代码清理**：`open-in-editor/button.tsx`、`directory.ts`、`file-explorer-pane.tsx`、`diff-pane.tsx` 移除 `useIsLocalDaemon` 与 `isLocalExecution` 管道；`planner.ts` 删掉 `isLocalExecution` 入参（desktop 源只由 `canUseDesktopBridge` 门控）；`useDesktopOpenTargets()` 改无参签名；`directory.ts` 顺带删掉不再使用的 `serverId` 入参。
- **planner 测试**：删「suppresses desktop targets for remote execution paths」——它断言的是 Electron 时代语义，desktop 源现只由恒为 false 的 bridge 可用性门控，remote 抑制分支已不存在；「bridge unavailable」用例保留，覆盖同一路径。
- **验证**：hook 测试重写（`isLoopbackEndpoint` 各种回环拼法 / LAN / relay / 非法输入；`resolveLocalDaemonServerId` 回环命中、relay-only 不命中）+ planner 测试 = 20 个全绿；`host-connection.test.ts` + `host-routes.test.ts` 62 个全绿；typecheck / lint / format 全绿。
- **浏览器实测**（dev daemon 6778 + Metro 8081，origin 127.0.0.1:8081 ≠ endpoint，旧 origin 判定必失效场景）：open-project 屏「Pair device」瓦片出现（旧判定下隐藏，057 轮快照可证）；host 设置页 Overview 正常、Service hosting 开关不受影响。
- **偏差记录**：issue 测试计划里写「127.x 段命中」，实际复用 protocol 归一化后只有 127.0.0.1 / 0.0.0.0 / ::1 / :: 命中——与原 origin 判定口径一致，不做 127/8 全段扩展；已接受。

### 2026-09-28 · 关闭

用户验收通过后授权关闭。目标达成（回环语义上线、serving 语义只剩唯一合法消费点、死代码链清理）；范围未扩。毕业回写检查：hook 语义与可见性规则均可从代码重建，按准入判据不进 project spec；`docs/` 无 origin 判定引用，无需同步。无有界简化遗留（ssh 隧道误判已在范围节声明为已接受限制）。

## 制度记忆影响

- 057 的结论（能力门控取代本机门控）不变；本 issue 处理的是同一根因的其余消费点。
- 关闭时检查 `docs/architecture.md` 等是否提及 origin 判定，如有则同步。
