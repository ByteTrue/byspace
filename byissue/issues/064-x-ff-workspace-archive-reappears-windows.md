---
kind: issue
title: 工作区 archive 后在 Windows 上又出现
type: ff
created: 2026-10-03
---

# 工作区 archive 后在 Windows 上又出现

## 做了什么

用户报告：工作区 archive 之后又突然出现在侧栏，看起来像没删干净，只在 Windows 出现。

真机证据（~/.byspace/daemon.log，2026-10-02）：

- 14:51:04.724 `Workspace archived`（`wks_7213b2a7a3edaee5`，curvy-tiger）
- 14:52:08.917 `Worktree disk removal failed during archive; workspace already archived`，`EBUSY: resource busy or locked, rmdir 'C:\Users\byte\.byspace\worktrees\08kvr4qm\curvy-tiger'`
- 14:52:08.918 `ws_slow_request archive_workspace_request durationMs 64516`

归档 RPC 真实耗时 64.5s，而 `packages/client/src/daemon-client.ts` 的 `DEFAULT_SESSION_RPC_TIMEOUT_MS = 60_000`：客户端先在 60s 处超时，`archiveWorkspaceOptimistically` 的 catch 无条件 `restoreOptimisticallyHiddenWorkspace`，把快照加回 store 和 ReplicaCache。daemon 侧其实已归档成功（`~/.byspace/projects/workspaces.json` 的 `archivedAt = 2026-10-02T14:51:04.716Z`，此后未再改动），remove 事件早已发过、不会重发 → 幽灵工作区一直挂着，Changes 面板继续对已被摘掉 `.git` 的残留目录轮询，报 `Not a git repository`。

Windows 独有的原因：删 worktree 的 `removeDirectoryWithRetries`（`packages/server/src/utils/worktree.ts`）在 Windows 上被 EBUSY 打穿（有进程持句柄），整个归档被拖过 60s；其它平台秒回。而持句柄的正是 daemon 自己——file-observer 用 `node:fs.watch(recursive)`（`packages/server/src/utils/file-observer/internal/native-recursive.ts:47`）订阅 worktree 目录，Windows 上该句柄让 rmdir 必 EBUSY。

## 改了哪些

第一轮（超时与回滚语义）：

- `packages/client/src/daemon-client.ts`：新增 `ARCHIVE_WORKSPACE_TIMEOUT_MS = 5 * 60 * 1000`（对齐 `CHECKOUT_GIT_METADATA_TIMEOUT_MS` 先例），`archiveWorkspace` 传入。
- `packages/app/src/workspace/workspace-archive.ts`：`archiveWorkspaceOrThrow` 在 daemon 明确回 `error` 时抛 `WorkspaceArchiveRejectedError`；catch 里只有这种"daemon 拒绝"才回滚快照；超时/传输层未知失败改为保持隐藏 + `clearWorkspaceArchivePending` + `refreshWorkspaceDirectory`，让 daemon 权威状态决定去留。

第二轮（EBUSY 根因 + 删除失败可见）：

- `packages/server/src/utils/worktree.ts`：`removeDirectoryWithRetries` 退避延长为 [0,100,300,700,1500,3000,5000,8000]（约 19s），给句柄关闭留时间。
- `packages/server/src/server/workspace-git-service.ts`：新增 `releaseWatchersForCwd(cwd)`，关闭该 cwd 上未被引用的 working-tree watch 与 workspace target（fs.watch 句柄的持有者）。
- `packages/server/src/server/checkout-diff-manager.ts`：新增 `closeForCwd(cwd)`，关闭 Changes 面板订阅的 diff watcher。
- `packages/server/src/server/workspace-archive-service.ts`：`ArchiveDependencies` 加可选 `releaseWorkspaceWatchers` / `closeDiffWatchersForCwd`；`maybeRemoveDirectory` 在删目录前释放这两类 watcher；`ArchiveResult` 加 `directoryError`，磁盘删除失败不再静默，错误信息随归档响应返回。
- `packages/server/src/server/session.ts`：`handleArchiveWorkspaceRequest` 注入两个释放回调（`workspaceGitService.releaseWatchersForCwd` / `checkoutDiffManager.closeForCwd`），响应 payload 带 `directoryError`。
- `packages/protocol/src/messages.ts`：`ArchiveWorkspaceResponseMessageSchema` 加可选 `directoryError`（旧 daemon 不带该字段，wire 兼容）。
- `packages/server/src/server/websocket-server.ts`：fallback noop 桩补 `releaseWatchersForCwd`。
- `packages/app/src/workspace/workspace-archive.ts` + `use-workspace-archive.ts`：daemon 回 `directoryError` 时抛 `WorkspaceDirectoryRemovalError`——工作区保持归档不回滚，toast 提示用户手动清理（i18n key `sidebar.workspace.toasts.archiveDirectoryRemovalFailed`，9 locale 全部补齐）。
- `packages/server/src/server/file-explorer/observer.ts`：新增 `closeForCwd(cwd)`——file-explorer 按文件订阅也持 worktree 内目录的 fs.watch 句柄，是继 workspace-git-service、checkout-diff-manager 之后的第三个持有者，前两轮漏掉；`WorkspaceFilesSession.closeFileWatchersForCwd` 透传，归档服务在删目录前调用。新增测试断言三个释放回调都在目录删除前、以正确顺序被调用。

句柄链条核对（为何 teardown 不用再改）：`teardownArchivedWorkspace`（session.ts:5147）→ workspace-git-observer `removeForWorkspaceId` → `removeForCwd` → `registerWorkspace` 的 `unsubscribe` → `removeWorkspaceListener` → `closeWorkspaceTarget` → `removeWorkspaceWorkingTreeLink`，workspace listener 清空时 working-tree target 的 `workspaceKeys` 已同步清空。`releaseWatchersForCwd` 是删目录前的强制兜底。

## 怎么验证的

- `npx vitest run src/workspace/workspace-archive.test.ts`（packages/app）：6 passed（含 "keeps the workspace hidden when the archive outcome is unknown"、"keeps the workspace hidden when the archive succeeded but the directory removal failed"）。
- `npx vitest run src/daemon-client.test.ts`（packages/client）：119 passed（含 "waits five minutes for an archive, which outlives the default session RPC timeout"）。
- `npx vitest run src/server/workspace-archive-service.test.ts` + `src/server/checkout-diff-manager.test.ts`（packages/server）：17 + 12 passed。
- server/client/app 三包 typecheck 0 error；`npm run lint` 0 warnings 0 errors；`npm run format:check` 通过。
- 未在真机复验（需要再次触发 EBUSY 归档）。

## 对 byissue/ 的影响

- 未沉淀 archive 流程事实；spec/workspace.md 仍不覆盖归档语义。archive 后目录残留的场景现在对用户可见（toast），但"残留目录如何清理/是否自动重试"仍未定，留给后续 issue。
