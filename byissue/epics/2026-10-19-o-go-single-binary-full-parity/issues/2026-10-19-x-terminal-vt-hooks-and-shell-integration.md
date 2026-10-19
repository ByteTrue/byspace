---
kind: issue
title: "终端 VT 屏幕网格快照、Input Mode 重放、Shell Integration 与 Agent Hooks 自动安装"
type: feature
created: 2026-10-19
---

# 终端 VT 屏幕网格快照、Input Mode 重放、Shell Integration 与 Agent Hooks 自动安装

## 目标与范围

对齐 `packages/server/src/terminal/` 的服务端虚拟终端屏幕网格快照（`0x04 OpcodeSnapshot`）、DEC 私有输入模式追踪与重放（`replayPreamble`）、OSC 633 命令边界追踪、终端 Agent Hooks 安装与 `POST /api/terminal-activity` 鉴权闭环。

## 执行记录

- 新增 `internal/terminal/vt.go`：
  - 实现纯 Go 虚拟终端缓冲区 `VTGrid`（维护行列 `Cell` 矩阵、光标位置、换行与滚屏），支持导出 `StateSnapshot` 并编码为 `0x04 OpcodeSnapshot` 二进制帧。
  - 实时追踪 `?1h/l`（application cursor keys）、`?2004h/l`（bracketed paste）、`?1000h/1006h`（mouse tracking）、`?1049h/l`（alternate screen）、`?25h/l`（cursor visible），生成断线重连所需的 `ReplayPreamble()`。
  - 实现 `EnsureAgentHooksInstalled` 自动写入 `~/.pi/agent/extensions/byspace-terminal-activity.ts`。
  - 实现 `Session.ValidateActivityToken` 恒定时间比对。
- 更新 `internal/terminal/pty.go` 与 `internal/server/runtime_services.go`：
  - 启动 PTY 时自动生成并注入 `BYSPACE_TERMINAL_ID` 与 `BYSPACE_TERMINAL_ACTIVITY_TOKEN`，在 `readLoop` 中扫描 OSC 633 `;C`/`;D` 自动切换 `working`/`idle`。
  - `POST /api/terminal-activity` 校验 loopback 来源与 token，状态变更时广播 `terminals_changed`。

## 验证

- `go test -v ./internal/terminal`：`TestVTGridSnapshotModesAndAgentHooks`、`TestFramesAndBacklog`、`TestPTYSessionEcho` 全部通过。

## 关闭候选

- 关闭时回写本 Epic `spec.md` 推进视图。
