# Agent tools

BySpace 启动的 agent 通过 bundled skill + `byspace` CLI 操作 daemon。没有第二种投递面：daemon 不再向 provider 注入自己的 MCP server，也不再声明 provider 原生工具目录。术语是「Agent tools」，UI 上不再有单独的开关——技能不默认安装，用户在 host 的 Skills 卡片里显式选择后，能力随 agent 启动就有。

## 边界

- BySpace 不替 agent 携带 MCP 配置。各家 CLI 读自己的配置文件，BySpace 只是启动同一个二进制。此前 `mcpServers` 透传已删除。
- 技能装在 `~/.agents/skills` 与 `~/.claude/skills`。不读这两个目录的客户端（多数 ACP 客户端）拿不到 BySpace 能力，这是已知上限，不是缺陷；要给它就在那个客户端自己的技能目录里放一份，但那个进程没有 `BYSPACE_AGENT_ID`，归属会退化成宿主 CLI。
- agent 身份由 daemon 写进进程环境（`BYSPACE_HOME`、`BYSPACE_HOST`、`BYSPACE_AGENT_ID`），凭证沿用宿主自己的 `cli-credential`。信任模型是「环境里自报的 id」，与退役前 MCP 桥一致。OpenCode 是例外：它跑在一个共享的 `opencode serve` 里，进程环境不属于任何单个 agent，所以那里没有 id，也没有 per-agent 的 `env`。
- 用户自己的 git 编辑器不属于 daemon：任何 daemon 侧的 git 调用都不得打开它（`GIT_EDITOR=true` 等）。有 TTY 的调用点（agent 终端）才会命中，所以只在真实终端里复现。

## 被排除的方案

- 每 provider 一套工具投递（pi 扩展、codex `mcp_servers`、omp host tools）：三份实现、ACP 一家没接上，新增客户端等于新增适配。
- 让技能复述命令参数：技能是磁盘上的文本，会和二进制漂移；`--help` 是唯一契约。
- 按 provider 过滤工具目录（`byspaceTools`）：没有投递面之后没有执行点，配置键保留解析但不生效。

## 长期约束

App 上出现的每个 provider 设置都必须有到达 provider 的通道，否则改的是记录、显示的是新值、provider 用的是默认值。通道按 provider 各异（launch flag、RPC 参数、config option、消息字段），清单与判据在 `docs/providers.md`；新增 provider 时填一行，新增设置时填一列。
