---
kind: issue
title: "修复 Pi 终端活动在空闲对话框关闭后永久卡在「进行中」"
type: ff
created: 2026-10-11
---

# 修复 Pi 终端活动在空闲对话框关闭后永久卡在「进行中」

## 预期与实际

预期：LLM 回复完成（turn 结束）后，终端标签从「进行中」回到空闲。

实际（用户报告，已在真实 daemon 上复现）：只要在**没有 agent run 活跃**时发生过一次 `ctx.ui` 对话框（空闲时打开 pi-vendor 模型选择器、pi-subagent、pi-background-terminal、pi-image-gen、pi-vision 等扩展对话框再关闭），标签状态就变为 `needs-input`（开）→ `working`（关），且**永不恢复**。

## 根因

BySpace 的 Pi 扩展把 `ui_prompt_end` 无条件映射为 `running`。该映射只为「run 进行中被对话框打断」设计：关掉对话框后 run 继续，`agent_settled` 会兜底。但当对话框在空闲时打开（pi 1.1.0 起扩展对话框生态大量使用 `ctx.ui`）：

1. 对话框关闭 → `ui_prompt_end` → 上报 `running` → daemon tracker 变为 `working`。
2. 之后**没有任何 run 会发出 `agent_settled`**。
3. pi 仍是 shell 前台进程，OSC 633 `D`（前台命令结束）不触发，`activityTracker.interrupt()` 兜底失效。
4. 状态永久卡在 `working`。

## 改了哪些

- `packages/server/src/terminal/agent-hooks/pi/pi-extension.ts`：扩展跟踪 run 活跃状态（`agent_start` 置真、`agent_settled` 置假）；`ui_prompt_end` 仅在 run 活跃时报 `running`，否则报 `idle`。空闲对话框关闭后回落到空闲，等待中的 `needs-input` 注意也被清掉。
- `packages/server/src/terminal/agent-hooks/pi/pi.test.ts`：新增两条回归——空闲对话框序列报 `needs-input → idle`；run 内对话框序列保持 `running → needs-input → running → idle`。
- `docs/terminal-activity.md`：更新 Pi 事件映射说明。
- 已把修复后的扩展源码直接写入 `~/.pi/agent/extensions/byspace-terminal-activity.ts`（与 installAgentHooks 将写入的内容一致），daemon 重建重启后由对账接管。

## 怎样验证

- 单测：`npx vitest run packages/server/src/terminal/agent-hooks/pi/pi.test.ts --bail=1` → 14 passed。
- typecheck + lint 全绿。
- 实机复现（dev daemon 终端 + 临时探针扩展 `/uiprobe` 打开 `ctx.ui.select`）：
  - 修复前：对话框关闭后 `working` 卡死 >40s 不恢复（pi TUI 已回空闲提示符）。
  - 修复后：同样操作序列 `needs-input` → `idle`，正常回合仍 `working → idle(finished)`。
- 附带发现：扩展的上报队列会把同一微任务窗口内的连续状态合并为最新一条，测试断言按「事件间等待 flush」编写。

## 审查

子代理审查结论：可合，无必须处理项。两条建议均已落地：`pi.ts` 的 `PI_EVENT_STATES` 加注释说明 `ui_prompt_end` 实际状态由扩展按 run 活跃度决定，`it.each` 移除该行的过时断言；`session_shutdown` handler 顺手归零 `runActive`（保留上报 promise 返回值，`session_shutdown` 的等待契约不破坏）。审查确认：入队无竞态、daemon 端 needs-input→idle 收敛无误触 transition、wire schema 未动无需 COMPAT、已安装扩展与源码逐字节一致。

## 对 byissue/ 的影响

无 spec 违背；`docs/terminal-activity.md` 的 Pi 映射段落已同步。
