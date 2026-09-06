---
kind: issue
title: "Daemon 重启后 workspace terminal 标签全部消失"
type: bug
status: closed
created: 2026-06-11
---

# Daemon 重启后 workspace terminal 标签全部消失

> **读者：** 跨会话接手的人——「要做成什么、别碰什么、现状与方案是否还成立、怎么验、关了要回写哪里」。
> **自检：** 目标与范围 · 当前证据 · 现状怎么工作 · 方案 · 验证 · 执行记录 · 关闭回写。

## 做成以后是什么样

Daemon 重启（崩溃被拉起、自动更新、手动重启、Windows 睡眠导致的 daemon 死亡）后，workspace 的 terminal 标签按原 id/名称/cwd 自动恢复为全新 shell 会话。运行中的进程和 scrollback 不复活（VS Code 同款语义）；客户端 layout 里持久化的 `terminalId` 无需迁移即对上。

**范围：** 包含 daemon 侧元数据持久化、启动恢复、守护性过滤（cwd 失效/workspace 已归档则丢弃）；不包含 detached PTY supervisor（tmux 模式，方案 B）、scrollback 持久化、客户端改动。

**归属：** 独立 issue；相关真相 `codestable/spec/terminal.md`（快照与恢复）、`docs/data-model.md`（存储设施）。

## 为什么现在做 / 当前坏在哪

用户报告（Windows）：睡眠唤醒后 workspace 全部 terminal 标签消失；手动重启 daemon 后同样消失。

- 预期：daemon 重启后 terminal 标签还在（agent 对话都能恢复，唯独 terminal 全没）。
- 实际：`listTerminals` 完全由活会话推导，daemon 一死标签必然清空。
- 证据链：PTY 在 fork 出的 worker 进程（`worker-terminal-manager.ts`），daemon 死 → IPC 断 → worker 主动 `killAll()`（`terminal-worker-process.ts:347`）；元数据（id/cwd/workspaceId/name/command/args）无任何落盘；客户端 tab 是 daemon 实时列表的纯视图（`use-workspace-terminals.ts`）。

睡眠本身只是 daemon 死亡的触发方式之一；daemon 存活时 PTY 是内核对象，不应消失。若用户机器日志显示 daemon 唤醒时崩溃，崩溃属另一条线，不在本 issue。

## 现状怎么工作

`TerminalManager`（bootstrap 创建，worker 模式）持有全部会话；所有变更路径（create、exit、kill、title、activity）都会 emit `terminalsChanged`，事件携带该 cwd 桶的权威列表。已知例外：`killAll()` 本地移除 record 后 exit 事件被去重，不再 emit——发生在优雅停机，无影响。`bootstrap.ts` 停机时调用 `terminalManager.killAll()`。

## 方案与实现安排

1. `TerminalSessionStore`（`$BYSPACE_HOME/terminals/terminals.json`）：zod strictObject 数组 `{id, cwd, workspaceId, name, command?, args?}`；`load()` 容错（损坏→空+日志），`replace()` 原子写且内部串行化。
2. 持久化 decorator `createPersistingTerminalManager(inner, store, logger)`：包装 `createTerminal`（成功后 upsert，取 `session.id`/`session.name`）；订阅 `terminalsChanged` 做移除镜像（事件桶内 id 不在 live 集合 → 删记录）；序列化后无变化则跳过写盘。其余方法透传。
3. `restorePersistedTerminals`：registry bootstrap 之后执行。逐条过滤（cwd 目录不存在 → 丢弃；workspace 不存在或已归档 → 丢弃），经 decorator `createTerminal` 按原 id 重建，最后 `replace()` 回写幸存集合。整体 best-effort，失败只记日志不阻塞启动。
4. bootstrap 接线：manager 创建处包一层；`bootstrapWorkspaceRegistries` 之后 restore。
5. `docs/data-model.md` 目录布局补一行。

**不碰的边界：** 不持久化 env（activity token 每次创建由 manager 重新注入；用户 env 继承属 agent 路径）、不持久化 title/rows/cols、不动 worker 生命周期、不改协议消息。

## 验证

- 单测：store 往返 + 损坏文件容错；wrapper 用真实 in-memory manager（真 PTY，同 `terminal-manager.test.ts` 惯例）验证创建→落盘、kill→移除；restore 用文件桩验证过滤（缺 cwd、归档 workspace、正常三条）与按原 id 重建。
- 用原来的坏法再看一眼：模拟 daemon 重启 = 新建 manager + 同一 store → restore 后 `getTerminals` 返回同 id 标签（修复前为空）。
- `npx vitest run` 仅跑新增/相关测试文件；typecheck + lint 全仓。

## 执行记录

- 2026-06-11：诊断完成（见上），方案 A 经用户确认，建 issue。
- 2026-06-11：实现完成。
  - 新增 `packages/server/src/terminal/terminal-session-store.ts`：`$BYSPACE_HOME/terminals/terminals.json` 的 zod schema + 原子写 store（写串行化，损坏文件 load 抛错带 cause，写入失败后队列仍可用）。
  - 新增 `packages/server/src/terminal/terminal-persistence.ts`：`createPersistingTerminalManager` decorator（createTerminal 成功后 upsert；订阅 `terminalsChanged` 镜像移除；`killAll` 视为停机、冻结镜像以保留记录）与 `restorePersistedTerminals`（registry 就绪后按原 id 重建，cwd 失效/workspace 归档则丢弃，best-effort）。竞态处理：create 返回时终端已退出则不落记录。
  - `bootstrap.ts`：manager 包 decorator，`bootstrapWorkspaceRegistries` 后执行 restore（构造期 await，listen 前终端就位）。
  - 测试 12 项（真实 PTY）：store 往返/并发/写失败恢复/损坏拒绝；wrapper 创建落盘、自退移除、瞬时退出不落盘、killTerminalAndWait 移除、killAll 保留；restore 双 boot 原 id 复原、四类记录过滤。全绿；typecheck、lint、format 通过。
  - `docs/data-model.md`：目录布局补 `terminals/`，Runtime-only Terminal Sessions 节补元数据持久化段落。

## 关闭时

- **关闭判断**：目标达成。实现 + 验证 + 独立 review 完成：12 项真实 PTY 测试全绿；typecheck / lint / format 全仓通过；reviewer subagent 结论 MERGE，零 MUST-FIX / SHOULD-FIX（移除镜像、killAll 冻结、restore 顺序、id 冲突、写队列等 8 项均有 file:line 核实）；代码已提交 `e3f264814`，pre-commit 钩子全过。
- **回写位置**：`codestable/spec/terminal.md` 新增「重启恢复」节并补历史证据链接；`codestable/spec/index.md` Terminal 条目更新；`docs/data-model.md` 已随实现更新（目录布局 + 持久化语义）。
- **遗留**：Windows 睡眠真机验证未做——若唤醒后 daemon 存活但标签仍消失，属重连路径的另一个 bug，另开 issue；若 daemon.log 显示唤醒时崩溃，崩溃单独修。方案 B（detached worker 保活进程，保留运行中进程）未排期，需要时另立事项。
