# Agent 工具交付：bundled skill + CLI 唯一通道

## 结论

- agent 拿到的编排能力统一成一条：`internal/server/skills/byspace/SKILL.md` 教的 `byspace` 命令。daemon 不注入 MCP server、不声明 omp host tools；`byspace mcp-bridge` 与 `/mcp/agents` 已退役。
- `daemon.mcp.*` 与 `agents.providers.<id>.byspaceTools` 保留解析但不再生效（协议向后兼容，parse-only）。
- 技能是磁盘上的文本，不随 daemon 版本走，所以技能文本不能复述参数；`--help` 是唯一契约。
- 身份与凭证走已有机制：agent 进程拿到 `BYSPACE_HOME`、`BYSPACE_HOST`、`BYSPACE_AGENT_ID`，CLI 用宿主自己的 `cli-credential` 文件认证。`BYSPACE_AGENT_ID` 由 daemon 写进 agent 环境、agent 自报，与退役前 MCP 桥的信任模型一致。
- skills 不默认安装，用户在 host 的 Skills 卡片里选。安装目标只有 `~/.agents/skills` 与 `~/.claude/skills` 两处（`internal/server/skills.go`）。ACP 客户端两处都不读，是已知限制不是缺陷：复制到它们自己的目录会丢 `BYSPACE_AGENT_ID` 归因。
- 不做 `mcpServers` 透传。OpenCode 是例外：共享 `opencode serve`，没有 per-agent env/id。
- 长期约束：App 里每个 provider 设置都必须有一条到达 provider 的通道（启动 flag / RPC 参数 / 配置项 / 消息字段）。检查表在 `docs/providers.md`：新 provider 填一行，新设置填一列。
- daemon 的 git 调用永不打开用户的编辑器（`GIT_EDITOR=true`）；只有 TTY 调用点会碰编辑器。

## 依据

- 类型：用户决定（2026-11-09 退役 MCP 交付）。理由：投递面从「每个 provider 一套适配」降到「provider 只要有 shell」；MCP 已在 pi / codex / omp 写出三种实现，ACP 一家都没接上。
- 被否决的相关方案：per-provider 工具交付（三种实现、ACP 零接入）；技能文本复述参数（与二进制漂移）；`byspaceTools` 过滤（没有执行点，parse-only）；三 home 技能安装（从第一版实现照抄，从未被论证；按各 agent 自己的 skill 根目录选）。
- 证据或复核方式：`bywork/archive/v1/decisions/2026-11-09-retire-mcp-tool-delivery.md`、`bywork/archive/v1/spec/agent-tools.md`、`bywork/archive/v1/notes/2026-10-16-skill-install-targets-and-retired-dirs.md`；代码 `internal/server/skills.go`；守卫 `scripts/parity-surface.mjs`（RETIRED_MCP_TOOLS / RETIRED_HTTP_ROUTES，含 `/api/subagent-report`）。
- 适用条件：所有 provider 的工具交付与技能安装。OpenCode 共享 serve 的例外仍在。

## 重访条件

- 出现 shell 之外的新交付需求（例如某 provider 无 shell 通道）。
- owner 决定恢复 MCP 或引入第二种交付面。
- ACP 客户端生态出现统一的 skill 读取目录。
