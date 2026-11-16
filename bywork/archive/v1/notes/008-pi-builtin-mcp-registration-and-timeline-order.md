# 008：Pi 内置 MCP 加载期注册、可被顶掉、extension_error 早于订阅

> **读者：** 往 Pi 注入 MCP server 的人（BySpace 的 Pi provider、任何生成扩展的宿主）；写了注册却「没有工具」要定位的人。
> **自检：** 一句话结论 · 何时用 · 坑 · 相关位置。

---

**结论：** Pi 1.x 的 MCP server 由扩展在**加载期**用 `pi.registerMcpServer(name, config)` 注册，真正去连的只有内置 `mcp` 扩展（`{ name: "mcp", replaceable: true, builtin: true }`）。注册是 core API、永远成功；**内置扩展被顶掉或禁用时注册仍进 registry，但没有任何东西去连**，且 Pi 自己发的那条 `extension_error` 早于宿主订阅 RPC 事件，收不到。判断「连上了没有」只能看 server 进程侧或自己探。

**何时用：** 给 Pi agent 注入 MCP server；排查「注册了却没有工具」；决定告警点。

## 坑

- **注册成功 ≠ 有人连。** 任何注册同名 `mcp` command/tool/flag 的扩展（历史典型是 `pi-mcp-adapter`）会让 `dist/core/resource-loader.js:71 omitReplacedExtensions` 把整个内置 mcp 丢掉（warning 里写「so built-in extension `mcp` was not loaded」）；用户也能在 `pi config` 里禁用内置扩展。此时 `pi.registerMcpServer` 照常进 registry（core API，`dist/core/extensions/loader.js:376`），连接逻辑却只在 `dist/extensions/mcp/index.js` 里。
- **加载期抛错会带走整条扩展。** 注册非法名字、别人的名字、`mcpNamespace` 冲突（`a-b` 与 `a_b` 都映射成 `mcp__a_b`）都会抛；一个 server 的失败不能让同一条扩展里的其它桥（entry capture、tree、系统提示）一起不加载，所以必须**逐条** try/catch（循环外一个 try 会让全部注册随 loader 的 `discard()` 一起丢）。
- **别指望 `extension_error` RPC 帧。** 内置被顶掉时 Pi 会发一条 `MCP server "x" is registered, but no loaded extension connects MCP servers; another extension may have replaced the built-in MCP support`，但它在宿主订阅 RPC 事件之前就发出去了，订阅前到达的帧直接丢。告警只能自己造：在 `session_start` 里查 `getCommands()` 有没有 `sourceInfo.path === "builtin:mcp"` 的 `mcp` 命令，缺失就 `ctx.ui.notify(..., "warning")`。
- **配置形状以内置校验器为准。** `dist/core/mcp-servers.js:120-181`：`type: "sse"` 被拒（「legacy SSE transport is not supported; use the streamable HTTP URL」）；`auth`/`oauth` 必须是对象（传 `false` 必抛，这是 adapter 时代的形状）；HTTP 只写 `{ url, headers? }`、stdio 只写 `{ command, args?, env? }`，`type` 可推断。
- **不写 `exposure` 就是 `codemode`。** `getMcpToolExposure` 末尾是 `return config.exposure ?? "codemode"`（`dist/core/mcp-servers.js:103-113`）。Pi 没有全局默认项可设；`autoEnableCodemode` 默认 true，所以 codemode 曝光会让 Pi 自己激活 codemode 工具。`alwaysLoad`（Claude/Codex 的字段）在 Pi 上无对应物、静默失效。
- **扩展加载期没有日志 API。** `dist/docs/extensions.md` 里搜不到 logger/console，注册失败只能先攒着，等 `session_start` 的 `ctx` 到手再 `notify`。

## 可用的确定性观察点

注册后 session 一起来就连，**不需要任何模型调用**：起一个 stdio server 并打日志，2 秒内就有 `initialize` → `notifications/initialized` → `tools/list`。e2e 只需断言 `tools/list` 出现，不必让模型去调工具。

## 相关位置

- 生成方：`packages/server/src/server/agent/providers/pi/agent.ts` 的 `createPiBySpaceExtensionFile`（注册 + `reportMcpInjection` 告警）。
- 真机 e2e：`packages/server/src/server/daemon-e2e/pi.real.e2e.test.ts` 的 `connects MCP servers` 用例与 `PI_MCP_PROBE_SERVER_SOURCE`。
- 落地背景与穿刺证据：`../issues/067-x-pi-builtin-mcp.md`。
