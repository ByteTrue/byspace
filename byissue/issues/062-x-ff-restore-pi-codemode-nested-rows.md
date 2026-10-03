---
kind: issue
title: "回退 061 的 pi codemode 嵌套调用过滤：恢复独立工具行显示"
type: ff
status: closed
created: 2026-10-01
closed: 2026-10-01
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# 回退 061 的 pi codemode 嵌套调用过滤：恢复独立工具行显示

061 把 codemode 嵌套工具调用从实时时间线过滤掉（只渲染父行，对齐 pi TUI 的显示方式）。上线后体验反而回退：折叠的时间线全是 codemode 行，看不出模型实际做了什么；旧行为（每条嵌套调用一个独立行）更可读。用户要求回退。

**范围：只回退 061 的行为守卫部分；061 的测试卫生（e2e 项目设置钉扎）与文档记录保留。**

- 改动：`packages/server/src/server/agent/providers/pi/agent.ts` — 删除 `tool_execution_start` 与 `handleToolExecutionEnd` 里对 `event.parentToolCallId` 的两处守卫，嵌套调用恢复为独立时间线条目。
- 改动：`packages/server/src/server/agent/providers/pi/rpc-types.ts` — 三个 `tool_execution_*` 变体删除 `parentToolCallId?: string`（无消费方，回到 061 之前的类型形状）。
- 改动：`packages/server/src/server/agent/providers/pi/agent.test.ts` — 「ignores nested tool calls」翻转为「streams nested tool calls that codemode scripts run as their own rows」，钉住恢复后的行为，防止未来再被无感收敛掉。
- 改动：`packages/server/src/server/daemon-e2e/pi.real.e2e.test.ts` — codemode-only 用例改断言嵌套 bash 行出现（含 `echo HELLO_PI_TEST` 的 shell 行），名称改为 streams nested tool calls as their own rows。061 加的 `writePiSettings`/`PI_DIRECT_TOOLS` 设置钉扎全部保留，与本次行为无关。
- 保留的已知差异：嵌套 id 不进 transcript，重载回放只显示父行——实时流与回放不一致是有意的取舍（可读性 > 一致性）。
- 验证：`npm run typecheck` 过；4 个改动文件 `npm run lint` 0 警告；`npx vitest run packages/server/src/server/agent/providers/pi/agent.test.ts --bail=1` 97 例全绿；真实 e2e（`PI_REAL_TEST_MODEL=bytetrueapi/deepseek-flash`，本地 23000 代理，pi 0.99.2）单跑 codemode-only 用例通过——canonical timeline 再次出现嵌套 shell 行。
- byissue：`byissue/spec/agent-conversation.md` 嵌套调用契约改回独立行显示并注明实时/回放差异；061 追加回退指针；证据列表加本文链接。

## 追加：呈现层折叠（方案 A+C）

回退后平铺的独立行解决了 061 的不可读，但暴露新问题：codemode 会话整屏都是 `codemode` 行，分不清哪次调用干了什么。折中：daemon 不过滤、照常流出独立行，只在行上打标，由 App 呈现层折叠。

**打标（daemon，协议零改动——timeline payload 的 `metadata` 已是开放 record）**

- `rpc-types.ts`：`tool_execution_*` 三变体加 `parentToolCallId?: string`，`PiAgentMessage` toolResult 分支加 `nestedCalls?: unknown`（均 COMPAT(piNestedToolCalls)：pi ≥0.99 才带，可选键向后兼容）。
- `tool-call-mapper.ts`：`buildPiNestedToolCallMetadata(toolCallId, nestedCalls?)`——id 含 `/` 则 `parentToolCallId` 取根祖先（`slice(0, indexOf("/"))`，孙调用直接归到顶层调用）；`nestedCalls.calls` 非空则算 `nestedSummary`（edited/command/read/search/other/byspace 计数，与 overview 摘要同口径）。
- `agent.ts` `emitToolCallEvent`：实时行接 metadata（实时时 result 还没有 nestedCalls，只有 parentToolCallId）。
- `history-mapper.ts`：回放父行从 tool result 顶层 `nestedCalls`（pi 把嵌套列表记在 toolResult message 上，且晚于 `tool_execution_end`——实时父行拿不到，只有回放有）算 `nestedSummary` 写进 metadata。踩坑：nestedCalls 不能塞进 `parseToolResult`，passthrough 会把它整个保留进 `detail.output`。

**折叠（App，`tool-calls/detail-level/nested-codemode.ts`）**

- `projectNestedCodemodeCalls` 在 detail-level 投影之前跑：带 `parentToolCallId` 的行按父行 item id 分桶移出 tail（孤儿保留原位），每组用 overview 的 `buildOverviewGroup` 造组（run.id 加 `nested:` 前缀防与 overview 展开态撞键）；summary/isLoading 只算子行，防双计。codemode-in-codemode 中间层行被吸收、不建组。
- `view.tsx`：`renderSingleToolCallItem` 先查嵌套组，命中则渲染 [父行, ...子行]。初版复用 `OverviewToolCallGroupView` 的默认收起徽标，后按用户反馈改为默认展开 + 缩进竖轨（见下节）；overview/detail 两模式都生效；`useChatOutline` 吃原始 tail（嵌套行无 timelineCursor，跳转不会落空）。
- 回放无子行时用父行 `metadata.nestedSummary` 构造只含父行的组，徽标显示同样的摘要。
- Mock 扩展：`mock-load-test-agent.ts` 的循环队列（`buildCycleQueue`）中注入 `codemode` 及其嵌套调用（`find`、`read`、`bash`），完成时带 `nestedSummary`，方便本地免 Key 查看效果。

## 追加：默认展开 + 缩进竖轨（取代折叠徽标）

折叠徽标上线后读错了：收起时看不出模型做了什么，展开后子行与父行同缩进平铺，像是 Code Mode 用了一次 Bash、下面又单独用了一次 Bash。用户要求默认展开、并且 UI 上要能体现包含关系。

改法只有渲染层（projection 不动，`run.calls` 仍是 `[parent, ...children]`）：

- 摘要格式化抽到 `packages/app/src/tool-calls/detail-level/overview/summary.ts` 的 `formatOverviewSummary(summary, t, { capitalize })`，overview 顶层组与嵌套父行共用；嵌套父行传 `capitalize: false`，副标签接在标签后保持小写。
- `ToolCall` 加可选 `summaryOverride`，覆盖 `presentation.summary` 作徽标副标签与点击进面板的摘要（`areToolCallPropsEqual` 里比较）。
- `view.tsx` 的 `renderNestedToolCallGroup`：父行走 `renderSingleToolCallRow`（带 summaryOverride），子行放进 `stylesheet.nestedCodemodeChildren`（`marginLeft` 6 + `paddingLeft` 12 + `borderLeftWidth` 1 的竖轨 + `gap` 4）并始终渲染。嵌套组没有展开态，`expandedToolCallGroupIds` 只服务 overview 顶层组。回放组（无子行）只渲染父行。

**验证（本版）**：`npm run typecheck` 六包全过；全量 `npm run lint` 3383 文件 0 警告、`npm run format:check` 过；`summary.test.ts` 4 例 + `nested-codemode.test.ts` 6 例全绿；新增 e2e `packages/app/e2e/browser/nested-codemode-rows.spec.ts` 通过——父行徽标带「ran 1 command」，glob/read/bash 三行子行无需点击即可见，子行 x 比父行缩进 ≥16px，并截图留证。

**验证（折叠版）**：typecheck、lint（3360 文件 0 警告）、format 过；`agent.test.ts` 97 绿（断言子行带 `parentToolCallId`）、`history-mapper.test.ts` 6 绿（新增 nestedCalls→nestedSummary 回放用例）、`nested-codemode.test.ts` 6 绿（新建，折叠/孤儿/归根/回放兜底）；真实 e2e（`PI_REAL_TEST_MODEL=bytetrueapi/deepseek-flash`）codemode 用例断言嵌套行 `metadata.parentToolCallId` 出现在 canonical timeline，通过（首跑 fail 是 finally 清理临时目录 rmSync EPERM 的 Windows 句柄抖动，重跑绿）。
