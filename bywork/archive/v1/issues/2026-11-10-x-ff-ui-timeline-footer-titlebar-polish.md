---
kind: issue
title: "美化时间线工具调用行、协议支持思考耗时并在概览与单行呈现、侧栏底栏按钮与顶栏对齐"
type: ff
created: 2026-11-10
---

# 美化时间线工具调用行、协议支持思考耗时并在概览与单行呈现、侧栏底栏按钮与顶栏对齐

时间线里的工具调用与思考行统一占满对话列宽（外层 `-mx-2 w-[calc(100%+16px)]` + 触发器 `px-2 py-1.5` 行高 `32px`，让悬停背景向两侧 gutter 外扩而不把首尾字形往里推；右侧箭头加 `-mr-1` 光学微调补偿 SVG 内部留白，使左侧工具图标与右侧 `>` 箭头分别与正文左右边缘同轨对齐在 `x=362` 与 `x=1166`），工具名设 `shrink-0 font-medium min-w-20` 防止被长参数挤压成 `S...`，参数摘要改为 `font-mono text-xs` 单行截断并对齐在同一左轨，打开文件按钮置于箭头左侧且桌面端悬停显现，连续工具行间距从 `0px` 调为 `4px`、与上下正文间距从 `4px` 调为 `12px`。协议在 `reasoning` 项增加可选 `durationMs?: number`，Go 守护进程在合并推理分片（`mergeReasoningChunks`）时基于起止时间戳计算耗时毫秒并输出，前端流式追加与归一（`appendThought`/`markThoughtReady`）同步计算 `durationMs`。在「全部折叠」（`overview`）档位下，将 `thought`（`Thinking`）纳入 `GroupableItem` 一并折入连续的 `OverviewToolCallGroup`，并在概览标题行开头显示 `Thought for 17s, ...`（无耗时回退 `Thought`）；独立的思考行完成后在右侧参数轨显示耗时（如 `Thinking  17s`）。侧栏底栏的 `Add project` 去掉文字，改用与其他底栏按钮一致的 `SidebarIconButton` 并以 `mr-auto` 靠左。macOS 顶栏红绿灯居中高度从 `52.0` 调为 `49.0`（补偿 `NSButton` 内 `12pt` 圆点偏下 `1pt` 与 `ScreenHeader` `1pt` 底边框），`SidebarTopBar` 补 `pb-px`，使红绿灯、左折叠按钮、标题与右侧分栏按钮同落于 `y = 25.25pt`（2x 下 `50.5px`）水平中线。

- 改动：`packages/protocol/src/agent-types.ts`、`packages/protocol/src/messages.ts` — 协议 `reasoning` 时间线项补充可选 `durationMs?: number` 并重编 AOT 校验器与声明。
- 改动：`internal/agent/sdk/types.go`、`internal/server/timeline_projection.go`、`internal/server/timeline_page_test.go` — Go `TimelineItem` 支持 `durationMs`，投影层合并 reasoning deltas 时按首末时间戳计算总毫秒数并单测覆盖。
- 改动：`internal/agent/pi/pi.go`、`internal/agent/pi/history.go`、`internal/agent/pi/pi_test.go` — Pi 会话记录思考起止（首帧 `activeThinkStart`），收到 `message_end` 或工具/正文接管时写回 `DurationMs`；从转录重放时读取 `message.durationMs`。写回只落在时间线行上、不重发整行文本（否则客户端会把全文追加第二遍），刷新后的耗时可从时间线读取。
- 改动：`internal/agent/providers/mock_cycle.go` — Mock 每次思考补足长推理段落（≥2 段），使 `ten-second-stream` 的思考时长稳定超过 1 秒，便于观察耗时展示。
- 改动：`web/src/core/types/stream.ts`、`web/src/core/types/stream.test.ts` — 前端流式状态记录思考起止并计算/透传 `durationMs`。
- 改动：`web/src/core/components/message.tsx`、`web/src/core/agent-stream/spacing.ts`、`web/src/core/agent-stream/spacing.test.ts`、`web/src/core/agent-stream/view.tsx`、`web/src/core/tool-calls/detail-level/overview/view.tsx` — 时间线工具行全宽对齐、工具名保宽加粗、参数等宽降噪、单条思考行完成显示耗时、补齐行间与段落间距及单测。
- 改动：`web/src/core/tool-calls/detail-level/grouping.ts`、`web/src/core/tool-calls/detail-level/overview/model.ts`、`web/src/core/tool-calls/detail-level/overview/summary.ts`、`web/src/core/tool-calls/detail-level/nested-codemode.ts`、`web/src/core/i18n/resources/*.ts`（9 个 locale）及对应单测与 `web/e2e/browser/timeline-detail-level.spec.ts` — `overview` 档位把 `thought` 收拢进工具调用概览组；耗时按四舍五入到秒、最少显示 `1s`（此前 `>= 1000ms` 的整数门槛把 953ms 这类亚秒思考吞掉，回退成无秒数的 `Thought`）。
- 改动：`web/src/sidebar/sidebar-footer.tsx` — `Add project` 改为靠左纯图标按钮 `SidebarIconButton`。
- 改动：`internal/gui/titlebar_darwin.go`、`web/src/core/components/sidebar/sidebar-header-row.tsx` — 修正 macOS 原生红绿灯纵向居中高度与侧栏顶行底内边距。
- 改动：`web/e2e/browser/thought-duration.spec.ts`（新增）— 概览组标题与组内 `Thinking` 行都须带秒数。
- 改动：`docs/development.md` — 补一句：只跑 `npm run build --workspace=@bytetrue/web` 不会改变守护进程 origin 提供的界面（二进制内嵌 UI 未重编），刷新后仍是旧页面。
- 验证：前端单测全绿；Go 测试 659 例全绿（含新增 `finalizeThinkLocked` 与投影耗时单测）；`make build && make build-app` 通过；`npm run typecheck`、`npm run lint`、`npm run format:check`、入站与出站字段对齐审计（0 缺口）通过；重建 `web/dist` 后在 Chromium 跑 `thought-duration.spec.ts` 实测通过并截图确认：概览行 `Thought for 2s, read 1 file, and searched 1 time`，展开后 `Thinking  2s`；对运行中的守护进程实测 `fetch_agent_timeline` 返回 `reasoning` 项 `durationMs: 2088`（Mock）与 `2143`（真实 Pi 转录）。
- 真机窗口：本轮 `BySpace Dev.app` 已用重编后的二进制重启；macOS 屏幕处于锁定状态，Cua Driver 拒绝驱动窗口、截图也只有锁屏的全黑画面，所以窗口内的像素未经本轮确认。作为替代，用 Chromium 打运行中守护进程提供的真实界面（同一份 `web/dist`）截图确认：概览行显示 `Thought for 2s, read 1 file, and searched 1 time`，展开后 `Thinking  2s`。解锁后刷新窗口即可看到同样结果。
- byissue：无 spec 变更（对齐 `docs/protocol-compatibility.md` 与 `docs/design.md` 既有规则）；更新 `byissue/notes/016-verification-tools-report-false-failures.md` 补充静态产物重建陷阱。
