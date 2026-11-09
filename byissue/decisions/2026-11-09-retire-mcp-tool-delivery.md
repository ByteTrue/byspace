---
kind: decision
title: "BySpace 自己的工具不再经 MCP 投递，改由 bundled skill + byspace CLI 承担"
created: 2026-11-09
superseded-by: ""
---

# BySpace 自己的工具不再经 MCP 投递，改由 bundled skill + byspace CLI 承担

agent 拿到的编排能力统一成一条：`internal/server/skills/byspace/SKILL.md` 教的 `byspace` 命令，而不是 daemon 往各 provider 塞工具定义。因此 daemon 不再注入 MCP server、不再声明 omp host tools、`byspace mcp-bridge` 与 `/mcp/agents` 退役，`daemon.mcp.*` 与 `agents.providers.<id>.byspaceTools` 保留解析但不再生效。

理由是投递面从「每个 provider 一套适配」降到「每个 provider 只要有 shell」：新增客户端不再需要写适配，而 MCP 那条路已经在 pi / codex / omp 上写出三种实现，且 ACP 一家都没接上。代价是工具定义不再随 daemon 版本走：技能是磁盘上的文本，所以技能不能复述参数，`--help` 是唯一契约。

身份与凭证走已有机制，没有新认证面：agent 进程拿到 `BYSPACE_HOME`、`BYSPACE_HOST`、`BYSPACE_AGENT_ID`，CLI 用宿主自己的 `cli-credential` 文件认证。`BYSPACE_AGENT_ID` 由调用链（daemon 写进 agent 环境）决定、agent 自报，与退役前 MCP 桥把 agent id 放 env 的信任模型一致。
