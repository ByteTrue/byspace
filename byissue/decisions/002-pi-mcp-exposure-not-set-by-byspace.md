---
kind: decision
title: "Pi 的 MCP 注入只做工具注入，不设 exposure；旧版 adapter 路径删除"
created: 2026-10-05
superseded-by: ""
---

# Pi 的 MCP 注入只做工具注入，不设 exposure；旧版 adapter 路径删除

BySpace 往 Pi agent 注入 MCP server 时只传连接信息（`{ command, args?, env? }` 或 `{ url, headers? }`），**不写 `exposure`/`toolExposure`**，让 server 保持 Pi 自己的默认（`codemode`）——曝光模式是用户的宿主偏好，BySpace 不替他决定。同时删除「探测第三方 `pi-mcp-adapter` 扩展 + 写临时 `mcp.json` + `--mcp-config`」的整条旧路径：`--mcp-config` 从来不是 Pi 的 flag，是 adapter 自己 `registerFlag` 出来的；用户明确拍板旧版 Pi 不再支持，不留兼容分支。

## 背景

读 `packages/server/src/server/agent/providers/pi/agent.ts` 时容易问「为什么不像 OMP 那样设成 `direct`」。答案在上面：这是选择不覆盖用户的宿主配置，不是漏了。判断「现在还算不算数」看 `docs/providers.md` 的 Pi MCP 段落是否仍写「BySpace sets no `exposure` or `toolExposure`」。讨论与穿刺见 `../issues/067-x-pi-builtin-mcp.md`。
