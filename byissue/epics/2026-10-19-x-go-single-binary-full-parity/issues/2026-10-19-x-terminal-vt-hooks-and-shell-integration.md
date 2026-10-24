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

## 验收与关闭（2026-10-21）

**验收结论：终端与 VT 部分交付；agent hooks 只做了 pi。**

交付：纯 Go VT 屏网格（行列 Cell 矩阵、光标、ANSI、scrollback、`SnapshotWithScrollback`）、
恢复三模式（`live` / `visible-snapshot` / `full-snapshot`）、输入模式重放
（`?2004h`/`?1000h`/`?1049h` 等）、5ms 输出合并窗口、尺寸归属
（手机打开同一终端不再把桌面 shell 压成手机宽度）、多 shell 检测（本机实测发现 7 个）、
终端 tab 跨重启恢复。

审计后补的两处：

- **`OnActivityChange` 回调从未被任何调用方设置** → 活动状态从不广播，侧栏把所有终端显示成
  idle；`attentionReason` 字段也不存在，所以「刚完成」和「一直空闲」分不开。
- **hook 安装无条件覆盖** → 会静默删掉用户自己放在同一路径的扩展。现在按 ownership marker 判定。

**未交付**：claude / codex / opencode 的 hook **安装**（配置文件改写）。`byspace hooks` shim
已经能接受这三家的事件，缺的是写配置那一步。
