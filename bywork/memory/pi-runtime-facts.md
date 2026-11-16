# Pi 运行时外部事实

## 结论

- `~/.pi/agent/advisor.json` 的 alwaysOn:true + executor 会在 session_start 调 pi.setModel，静默覆盖会话模型并钳制 thinking；RPC 模式无 ctx.hasUI 所以无提示。排查「模型不是我选的那个」先看 advisor 配置。
- pi-subagent 的 timeout 定时器迟到（实测 51–102s，一次 54m50s），根因未明，已交 pi-package-mono；不要依赖 timeoutMs，轮询 subagent_status。
- pi.registerMcpServer 永远成功（core API），但只有 builtin `mcp` 扩展真正连接；任何扩展注册同名 mcp command/tool/flag 会顶掉 builtin（omitReplacedExtensions）；extension_error 先于宿主订阅到达。
- pi 模型调用失败的表现：空 assistant 消息 content:[]、stopReason:"error"、errorMessage:<厂商文本>，随后正常 agent_end。只有 errorMessage 决定失败；"aborted" 也带 errorMessage（用户停止）；retry-backoff 停止产生 agent_settled{aborted:true} 且无新消息。判定必须 `failure != "" && !aborted`；取最后一条 assistant 消息（赋值，不累积）。
- provider 模型/二进制的真实来源：Pi 托管安装在 `~/.pi/agent/bin/pi`（current-version、managed-install.json 的 entrypoint.path）。实测 Windows：Pi 1.5.2 / Claude Code 2.1.317 / OpenCode 2.2.7（2026-11-11）。

## 依据

- 类型：外部观察（pi 与 provider 的行为，实测；非本仓库代码可推导）。
- 被否决的相关方案：依赖 pi-subagent timeoutMs 做时限（定时器不可靠）；用 stopReason 或消息累积判定失败（aborted 与 retry 路径会误判）。
- 证据或复核方式：笔记 `bywork/archive/v1/notes/004-pi-advisor-flow-silent-model-takeover.md`、`007-pi-subagent-timer-lateness-and-notify-gating.md`、`008-pi-builtin-mcp-registration-and-timeline-order.md`、`2026-11-07-pi-model-call-failure-shape.md`、`2026-11-11-provider-model-sources.md`。
- 适用条件：Pi 版本演进可能改变这些行为；版本号是测量时点记录。MCP 注册事实仍影响用户自有 MCP server 的注册方式（见 agent-tools-delivery：注册不带 exposure）。

## 重访条件

- Pi 大版本升级（重测失败形态与 advisor 行为）。
- pi-package-mono 修复 subagent 定时器。
