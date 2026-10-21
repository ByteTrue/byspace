---
kind: issue
title: "终端活动 hook 只装了 pi，claude/codex/opencode 的配置改写未实现"
type: feature
created: 2026-10-21
---

# Agent Hooks 安装：其余三家

> **读者：** 让非 pi 的 agent 在终端里也能点亮活动指示灯的人。

## 现状

- `byspace hooks <agent> <event>` 这个 **shim 已经能接受四家的事件**，事件到状态的映射
  齐全（`running` / `idle` / `needs-permission`）。
- **只有 pi 的安装**（`EnsureAgentHooksInstalled` 写 `~/.pi/agent/extensions/byspace-terminal-activity.ts`，
  本轮补了 ownership marker 检查，不会覆盖用户自己放在同一路径的文件）。
- claude 的 `settings.json`、codex 的 `hooks.json`、opencode 的插件文件**改写逻辑未移植**。

## 用户可见的后果

在 BySpace 终端里跑 `claude` 或 `codex` 时，侧栏**不会显示进行中**——指示灯只在 pi 上工作。
而「终端里的 agent 在不在干活」正是这个指示灯要回答的问题。

## 每家要改的文件

| Provider | 目标                                                | 坑                                           |
| -------- | --------------------------------------------------- | -------------------------------------------- |
| claude   | `<home>/.claude/settings.json` 的 hooks 段          | 用户可能已有自己的 hooks，必须合并而不是覆盖 |
| codex    | `<home>/.codex/hooks.json`                          | 同上                                         |
| opencode | 插件目录（`opencode-plugin.ts` 显示是 JS 插件文件） | 文件名固定，覆盖前要确认是不是我们写的       |

三家的共同要求：**只增不删**，保留用户已有的 hook 项；安装失败要如实报错而不是静默跳过
（当静默跳过时，症状是「指示灯不亮」，而用户无从知道原因）。

## 验收

在 BySpace 终端里分别跑 claude / codex / opencode 各自的 agent：
侧栏出现进行中，结束后变为完成（`attentionReason: "finished"`）。

## 参考

- 已实现：`internal/terminal/vt.go` 的 `EnsureAgentHooksInstalled`、`internal/cli/hooks.go`
- Node 实现：`archive/packages/server/src/terminal/agent-hooks/{claude,codex,opencode}/`（6 个文件）
- 台账：同上 MISSING 表
