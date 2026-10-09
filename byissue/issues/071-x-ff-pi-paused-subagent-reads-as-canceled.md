---
kind: issue
title: "修复 pi paused 子代理永远显示 running（pill 常驻 1 working）"
type: ff
status: closed
created: 2026-10-09
---

# 修复 pi paused 子代理永远显示 running（pill 常驻 1 working）

## 预期与实际

预期：主会话完成后 subagents 轨的「N working」徽标随之清零。

实际：pi 子代理超时被 pi-subagent 暂停后，BySpace 里该行永远显示 running，pill 常驻「1 working」，用户无法从徽标判断主会话是否已完成。

## 根因

pi-subagent 对超时/轮次上限的处置是**杀掉子进程**并把任务置为 `paused`（`state.status = "paused"` 后 `done(pausedResult())`），exit 消息 `{ status: "paused" }` 就是该任务最后一次状态上报；恢复只能走 `subagent({ resume })`，产生**新的任务 id** 与新行。BySpace 的 `mapPiSubagentStatus` 把 `paused` 映射成 `running`（注释称 "paused is not terminal, so it reads as running"），于是旧行永远等不到终态。本会话实录：`sub_d23d654796d3` 超时 → exit status=paused → 卡 running；resume 产生的 `sub_22525c61f176` 自行 completed，旧行无人收。

spec 中「paused/pending 显示为 running」当时是有意取舍，但漏算了「paused 的恢复是新 id，旧行没有终态路径」。

## 修了什么

packages/server/src/server/agent/providers/pi/agent-subagents.ts：`mapPiSubagentStatus` 把 `paused` 从 running 分支移到 canceled（进程已被杀、pi 侧 `failed: false`，canceled 是诚实映射；UI 归 done 桶、可被「Archive finished subagents」收容），注释钉住原因。agent-subagents.test.ts 断言翻转为 canceled。

## 怎么验证的

- `npx vitest run packages/server/src/server/agent/providers/pi/agent-subagents.test.ts --bail=1` 16 绿。
- 真实 transcript 核实：本会话 5 条 subagent-exit，4 条终态 + 1 条 `sub_d23d654796d3 status=paused`，与根因链一致。
- `npm run typecheck` 全过；lint 0/0；format 过。

## 对 byissue/ 的影响

byissue/spec/agent-conversation.md：paused 显示为 running 的既有结论改写为 canceled，并记录原因。
