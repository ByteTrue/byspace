---
kind: issue
title: "Pi provider 改用内置 MCP：扩展内 registerMcpServer 替代 pi-mcp-adapter 探测"
type: refactor
created: 2026-10-05
---

<!-- 读者：跨会话接手的人。目标与范围 · 现状怎么工作 · 方案 · 验证 · 关闭回写 -->

# Pi provider 改用内置 MCP：扩展内 registerMcpServer 替代 pi-mcp-adapter 探测

## 为什么做

用户报告「无法在 Pi agent 里看到 BySpace 注入的 MCP 工具」，排查发现不是 bug，而是前提失效：Pi 现在自带 MCP 支持（内置 `mcp` 扩展，读 `mcp.json` + 接扩展的 `pi.registerMcpServer()`），而 BySpace 的注入路径仍然是 Pi 还没有内置 MCP 时代的形状 —— 先探测第三方扩展 `pi-mcp-adapter` 是否加载（RPC `get_commands` 找扩展命令 `mcp`），探到了才写一份临时 `mcp.json` 并用 `--mcp-config` 传给 Pi。Pi 1.0.2 既没有 `pi-mcp-adapter`（探针恒 false，注入整条放弃），`--help` 里也没有 `--mcp-config`（那是 adapter 自己 `registerFlag` 的）。

用户的决策（原话）：「派之前不支持 MCP，之前的 MCP 都是由扩展来实现的。但在现在的最新版本里，派已经实现了内置 MCP 功能，所以不需要再安装 MCP 扩展了。」「派的旧版本就不支持了。这是我做的决策。」「不管它是什么模式，你都不要动它……我们反正不要动这个配置，只注入工具，专注于自己的事情，不要画蛇添足。」

范围：只改 Pi provider。旧版 Pi + pi-mcp-adapter 路径直接删除，不留兼容分支。

## 现状怎么工作（改前）

- `packages/server/src/server/agent/providers/pi/agent.ts` 的 `prepareMcpConfig(cwd, servers, env)`：servers 为空 → null；`detectMcpAdapter` 为假 → null；否则 `createPiMcpConfigFile` 写临时 `mcp.json`（合并用户的 `<Pi agent dir>/mcp.json`）。
- `detectMcpAdapter` 起一个空 RPC session 调 `get_commands`，用 `isPiMcpAdapterCommand` 过滤：只认 `source === "extension"` 且名字匹配 `/^mcp(:\d+)?$/`，且 `sourceInfo` 里含 `pi-mcp-adapter` 的扩展命令。Pi 内置的 `/mcp` 命令 sourceInfo 是 `{ path: "builtin:mcp", source: "builtin", ... }`，判 false。
- 会话就绪后 `capabilities.supportsMcpServers` 由 `mcpConfig !== null` 决定，初值 false。`packages/server/src/server/agent/agent-manager.ts:3486 requireExternalMcpSupport`：配置里带 `mcpServers` 而 session capability 不是 true 就直接关会话抛 `Provider 'pi' does not support MCP servers`。所以探针失败不只是「没注入」，而是带 MCP 的 Pi agent 起不来。
- `toPiMcpConfig` 输出的 HTTP 配置带 `auth: false, oauth: false` —— 这是 adapter 时代的形状，Pi 内置校验器要求 `auth`/`oauth` 是对象，传 false 必抛。

## 方案（已实现）

Pi 内置 MCP 从扩展加载期读取注册：`pi.registerMcpServer(name, config)`，加载期注册进 pending 队列，factory 返回后统一 apply；session 一起来内置扩展就连 server 并 `tools/list`，不需要任何模型调用。

- `createPiBySpaceExtensionFile(systemPrompt?, mcpServers?)`：仍生成 `byspace-integration.mjs`（entry capture / tree 桥不变），额外插值转换后的 `byspaceMcpServers`（`toPiMcpConfig` 逐条转换），扩展里对每个 server 单独 `try { pi.registerMcpServer(name, config) } catch {}`。注册必须逐条 try/catch：Pi 对非法名字、别人的名字都会抛，而**加载期抛错会让整个扩展 load 失败**，会顺带带走 entry capture、tree、系统提示。
- 只传 `{ command, args?, env? }` 或 `{ url, headers? }`：不传 `type`（内置校验器可推断）、不传 `auth`/`oauth`（旧值非法）、**不传 `exposure`/`toolExposure`** —— 用户的决策是让 server 保持 Pi 自己的默认（默认 `codemode`），BySpace 不替用户决定曝光模式；`<Pi agent dir>/mcp.json` 里的同名 server 仍按 Pi 的规则优先于注册项。
- 注册可能「成功但没人连」：内置 `mcp` 扩展是 replaceable，任何注册了同名 `mcp` 命令的扩展（典型是 `pi-mcp-adapter`）会顶掉它，用户也能在 `pi config` 里禁用内置扩展。这时 `registerMcpServer` 照常进 registry，但没有任何东西去连。所以生成扩展在 `session_start` 里 `getCommands()` 找 `sourceInfo.path === "builtin:mcp"` 的 `mcp` 命令，缺失且确实注册过 server 就 `ctx.ui.notify(..., "warning")`；注册被拒的每条也各报一条 warning（原来的逐条 `catch {}` 改成收集 `{ name, message }`）。告警走已有的 `notify` → timeline notification 通道，不新增协议面。
  - 为什么不接 Pi 自己发的 `extension_error` RPC 帧：它在 BySpace 订阅 RPC 事件之前就发出去了（`agent.ts` 先 `getState()` 再构造 session，构造函数里才 `onEvent`），订阅前到达的帧直接丢。穿刺证据见下。
- `PI_CAPABILITIES.supportsMcpServers` 改成静态 `true`，删 `capabilitiesForClient`/`capabilitiesForSession`/`withPiCapabilities` 与探针。
- 删除 `prepareMcpConfig`、`detectMcpAdapter`、`isPiMcpAdapterCommand`、`readPiGlobalMcpConfig`、`createPiMcpConfigFile`、`resolvePiAgentDir`（agent.ts 内唯一使用者是 `readPiGlobalMcpConfig`；`session-descriptor.ts` 有独立同名版本不受影响）与 `PiMcpConfigFile` 类型；`buildResumeStartInput` 去掉 `mcpConfig`。
- `packages/server/src/server/agent/providers/pi/runtime.ts`：删 `PiRuntimeLaunch`/`PiStartSessionInput` 的 `mcpConfigPath` 以及 `argv.push("--mcp-config", ...)`。

## 改了哪些

- `packages/server/src/server/agent/providers/pi/agent.ts`：能力置 true，删探针与临时 MCP 文件通道，扩展内注册 server；注册失败与「内置 MCP 不在场」各报一条 warning。
- `packages/server/src/server/agent/providers/pi/runtime.ts`：删 `--mcp-config` 参数通道。
- `packages/server/src/server/agent/providers/pi/agent.test.ts`：三条旧 MCP 用例（探针成功写文件、全局配置解析失败、探针失败不传 config）换成五条新用例（扩展注册出正确的 server 形状且无告警、某个 server 被拒时另一个仍注册且桥仍在并有告警、内置 MCP 不在场时的告警、内置 MCP 在场时静默、无 server 时不注册不告警）；`loadBySpaceExtension` helper 合并了原来的 listeners-only 版本。
- `packages/server/src/server/agent/providers/pi/cli-runtime.test.ts`：删 `--mcp-config` argv 用例。
- `packages/server/src/server/daemon-e2e/pi.real.e2e.test.ts`：新增真机 e2e，用零依赖 stdio probe server 断言 BySpace 注册的 server 真被 Pi 连上。
- `docs/providers.md`：Pi 的 MCP 段落整段重写（旧文案以 pi-mcp-adapter + `--mcp-config` + `auth:false/oauth:false` 为前提）。

## 怎么验证的

- `npm run typecheck` 全绿（highlight/protocol/client/server/app/relay/cli）。
- `npm run lint` 与 `npm run format` 通过（改动文件）。
- `npx vitest run packages/server/src/server/agent/providers/pi/agent.test.ts packages/server/src/server/agent/providers/pi/cli-runtime.test.ts --bail=1`：2 files / 119 tests passed。
- 真机穿刺（手动，本机 Pi 1.0.2 + bytetrueapi/deepseek-flash）：
  - 临时 `PI_CODING_AGENT_DIR` + 扩展注册一个本地 stdio MCP server，让模型经 codemode 调用它 → 模型回答 `SPIKE_ECHO:hello-spike`，server 日志依次出现 `initialize` / `notifications/initialized` / `tools/list` / `tools/call`。整链打通：生成的扩展 → `registerMcpServer` → Pi 内置 MCP → 真连 server。
  - 只起 RPC session、不发任何 prompt：**2 秒内** server 日志已有 `initialize` / `initialized` / `tools/list`。⇒ 「session 起来就连、不需要模型」是可做成确定性断言的观察点。
  - 把 `codemode` 设置去掉重跑（保持 stdin 打开）：同样 `t=2s` 出现 `tools/list`，确认连接不依赖 codemode 是否启用。
  - 副作用记录（与本次无关）：Pi 的 codemode `searchTools("spike_echo")` 返回空对象，模型靠 ALL_TOOLS 兜底找到 `mcp__spike__spike_echo`。
- 真机 e2e（`pi.real.e2e.test.ts` 新增用例）：现场写一个零依赖 stdio MCP server，经 `createAgent({ mcpServers: { pi_probe: { type: "stdio", ... } } })` 交给 daemon，断言 `agent.capabilities.supportsMcpServers === true` 且 probe 日志里出现 `tools/list`（`initialize` → `tools/list`）。命令：`PI_REAL_TEST_MODEL=bytetrueapi/deepseek-flash npx vitest run packages/server/src/server/daemon-e2e/pi.real.e2e.test.ts -t "connects MCP servers"` → **1 passed | 17 skipped，13.2s**。用例不需要发起模型调用，只花一个 session 启动的时间。probe server 只做 `initialize` + `tools/list`，不再声明 tools（没有测试会去调它）。
- 告警落点穿刺（临时扩展 + 假 `/mcp` 命令，Pi 1.0.2）：
  - 内置在场：`getCommands()` 里有 `{ name: "mcp", sourceInfo: { path: "builtin:mcp", source: "builtin", ... } }`，server 日志 2 秒内 `initialize` / `tools/list`，没有 `extension_error`。
  - 用另一个扩展 `registerCommand("mcp", ...)` 顶掉内置：命令仍在但 `sourceInfo.path` 变成替换者扩展的绝对路径、`source: "cli"`；server 日志**完全为空**（注册成功没人连）；RPC 流里恰好一条 `extension_error`，`error: 'MCP server "probe" is registered, but no loaded extension connects MCP servers; another extension may have replaced the built-in MCP support'` —— 该帧在 BySpace 订阅之前到达，所以不采用。
  - 非法注册名的抛错原文：`Invalid MCP server registered by extension "...": invalid server name "bad name!" (use letters, digits, "_" and "-")`。
- 该用例未纳入 CI：`.github/workflows/ci.yml` 只跑 `test:unit` + `test:integration`，`*real.e2e` 属于本地/显式运行资产。

## 关闭结论

判断：目标达成（Pi 注入的 MCP 工具真被连上，真机 e2e 断言通过），范围未暗扩（只动 Pi provider，不碰协议、端点、daemon 配置面），用户验收通过（m01281「就这样吧。现在关闭收尾开PR」，同时确认曝光模式保持 Pi 默认，BySpace 不指定）。

质量证据：typecheck 全绿；lint 0 warnings 0 errors；单测 2 files / 119 tests passed；真机 e2e `connects MCP servers` 1 passed（12.2s，改动前该用例不存在）。

沉淀：见下方「对 byissue/ 的影响」。

遗留事项：无。旧版 Pi + `pi-mcp-adapter` 路径按用户决策删除，不保留兼容分支。

## 对 byissue/ 的影响

- 新增 note `008-pi-builtin-mcp-registration-and-timeline-order.md`：Pi 内置 MCP 的三条外部事实（加载期注册、内置 `mcp` 扩展可被顶掉后无人连接、`extension_error` 早于 BySpace 订阅到不了），以及告警只能走 `notify` → timeline 的绕法。
- 新增 note `009-generated-source-escaping-in-template-literals.md`：在 TS 模板字面量里生成 JS 源码时的双层转义坑（首次 e2e 240s 超时的真因）。
- 新增 decision `002-pi-mcp-exposure-not-set-by-byspace.md`：只注入工具、不设 `exposure`/`toolExposure`，让 server 保持 Pi 默认。
- project spec 不更新：本变更改变的是 provider 集成实现，用户可依赖的行为仍是「agent 能看到注入的工具」；接口面与工程约束由 `docs/providers.md`（已随本次整段重写）承担。
- 无新增 epic。
