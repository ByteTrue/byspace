---
kind: issue
title: "pi codemode 的嵌套工具调用在 BySpace 里重复显示成独立工具行"
type: ff
created: 2026-09-30
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# pi codemode 的嵌套工具调用在 BySpace 里重复显示成独立工具行

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。
> **自检（四答即可，可合成短段，勿空标题凑节）：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `byissue/` 有无影响。

---

pi 的 `codemode` 脚本里 `await tools.bash(...)` 时，BySpace 会多显示一条独立的 `Shell` 行；pi TUI 只显示 codemode 那一行（嵌套调用渲染在父行内部）。复现会话 `01a0f12f-2a72-747d-ad7a-4068fff50ef5`。

**预期**（pi 官方语义，`docs/extensions.md:148`）：`ctx.executeTool()` 的嵌套调用会发出 `tool_execution_start/update/end`，三个事件都带 `parentToolCallId`，`toolCallId` 形如 `<parent id>/<n>`；这些 id **不出现**在 transcript 的 tool calls / tool results 里，也不新增 transcript 条目。TUI 因此在 `case "tool_execution_start"` 里直接 `if (event.parentToolCallId) break`（`dist/modes/interactive/interactive-mode.js:2827-2831`）。

**根因**：`packages/server/src/server/agent/providers/pi/rpc-types.ts:164-205` 的 `PiAgentSessionEvent` 三个 `tool_execution_*` 变体都没有 `parentToolCallId` 字段，于是 `packages/server/src/server/agent/providers/pi/agent.ts:2273` 的 `case "tool_execution_start"` 把每个嵌套 bash 都当成独立 tool_call 发到 timeline。历史回放路径不受影响——嵌套调用按官方说明不进 transcript，所以重载会话本来就只显示 codemode 一次，**重复只发生在实时流**。

- 改动：`packages/server/src/server/agent/providers/pi/rpc-types.ts` — 三个 `tool_execution_*` 变体各加 `parentToolCallId?: string`（可选，纯 TS 类型无 zod，向后兼容）。不加 `COMPAT` 标记：嵌套调用是 pi 的稳定语义，字段只会长期在，不是待拆的 shim。
- 改动：`packages/server/src/server/agent/providers/pi/agent.ts:2274` — `case "tool_execution_start"` 首行 `if (event.parentToolCallId) return;`。**必须在 `activeToolCalls.set` 之前**，嵌套 id 才不进 map。
- 改动：`packages/server/src/server/agent/providers/pi/agent.ts:2372` — `handleToolExecutionEnd` 同样守卫。这处不能省：它有 `?? parseToolArgs(event.toolName, null)` 兜底，start 被过滤后 end 仍会 emit 出一条 `completed` 行。
- `case "tool_execution_update"` 不需要改：它先 `activeToolCalls.get(event.toolCallId)`，嵌套 id 从不入 map，天然短路（与 TUI 的 `pendingTools` 同理）。
- 前端与 protocol 不需要改：过滤后根本没有嵌套行到达，`ToolCallBase` 的 index signature 也让新字段天然兼容。
- 验证：新增 `packages/server/src/server/agent/providers/pi/agent.test.ts` 用例「ignores nested tool calls that codemode scripts run」，emit 一条 codemode + 三条带 `parentToolCallId: "call-1"` 的嵌套事件，断言 timeline 只有 codemode 的 running/completed 两条。**做过变异验证**：临时删掉 agent.ts 的两处守卫重跑，断言如预期失败并打出多余的 `callId: "call-1/0"` bash 行，恢复后 97/97 绿——不是恒真断言。
- 验证：`npm run typecheck`、`npm run lint`、`npm run format:files`（三个文件）全过；`npx vitest run packages/server/src/server/agent/providers/pi/ --bail=1` 142 例全绿。
- 验证（真实 pi 0.99.1，in-process daemon + `bytetrueapi/deepseek-flash`）：项目 `.pi/settings.json` 写 `{defaultTools:["+codemode"], codemode:{mode:"only"}}` 后发同一条 `echo HELLO_PI_TEST`。修复前 canonical timeline = codemode running → **bash completed（shell）** → codemode running → codemode completed；修复后 = codemode running → codemode completed，**没有任何 shell 行**。直连项目设置（plain `defaultTools` 列表）下修复后仍是单条 bash completed，直连路径未受影响。
- 验证（真实 e2e 回归）：`packages/server/src/server/daemon-e2e/pi.real.e2e.test.ts` 新增「codemode-only project keeps nested tool calls out of the timeline」，断言有且仅有 codemode 一行、无其它工具行，并断言该行输出里有 `echo` 的回显标记。
- **review 修正（同一分支第二个 commit）**：上面探针用的 `defaultTools: ["+codemode"]` 是 **modifier 列表**，`dist/core/settings-manager.js:40-70` 的 `mergeDefaultTools` 会把它**追加**到宿主全局选择上，只有含 plain 名的列表才替换。所以该写法在本机（全局已有 codemode 与 DEFAULT_TOOL_NAMES）碰巧成立，换个全局选择就把 bash 变得不可调，测试会空转通过。e2e 现在钉 plain 列表 `[...PI_DIRECT_TOOLS, "codemode"]`。
- **顺手发现（必须记）**：同文件 4 个直连工具映射用例（bash/read/write/edit）原先不写项目设置，继承运行机器的全局 `~/.pi/agent/settings.json`。在本机（全局 `codemode.mode: "only"`）实测修复前 4 passed、修复后 3 failed（read/write/edit，`expected undefined to be defined`）——它们是靠 bug 泄漏的嵌套行意外通过的，测的不是自己声称的直连映射。已给这 4 个用例加 `writePiSettings(cwd, { defaultTools: PI_DIRECT_TOOLS })` 钉住直连工具；CI 无 `pi` 二进制故这些 real e2e 在 CI 被 skip，只有本机能看见差异。
- 环境事实：真实 e2e 必须显式传 `PI_REAL_TEST_MODEL`（本机 pi auth 为空、无 OPENROUTER_KEY，默认模型跑不通）。去重依赖 pi 版本会下发 `parentToolCallId`（本地 0.99.1 已验证）；字段是可选类型，更旧的 pi 不发该字段时嵌套行会复现。
- 未做：daemon 侧隔离用户全局 pi 设置（不该做——BySpace 跑的就是用户的 pi，全局设置生效是产品行为；确定性由测试自己用项目级 pin 解决）。
- 未做：`docs/extensions.md:148` 说的嵌套调用列表（上游记在 tool result 的 `nestedCalls` 上，含 name/arguments/status/durationMs）本仓库未读取，父行不展开它。上游 `NestedCallRecorder` 有 maxCalls 256、maxArgumentBytesPerCall 8KiB、maxArgumentBytesTotal 32KiB 的上限。
- 已知残留：宿主若装了 `exposure: "codemode"` 的 MCP server，pi 会自行激活 codemode 工具（`dist/extensions/mcp/index.js:255-285` `ensureDiscoveryActive`），绕过项目 `defaultTools`；那是宿主配置差异，不为它加防御代码。
- byissue：`byissue/spec/agent-conversation.md`「运行与加载指示」新增一条嵌套调用契约（不单独成条目、只显示父行、id 不进 transcript 故历史回放天然只有父行），历史证据列表加本文链接。
- **后续（2026-10-01）**：本文的实时流过滤因可读性回退——折叠时间线只剩 codemode 行，看不出模型实际做了什么。嵌套行恢复独立显示，实时/回放差异成为有意取舍，见 [062](062-x-ff-restore-pi-codemode-nested-rows.md)。
