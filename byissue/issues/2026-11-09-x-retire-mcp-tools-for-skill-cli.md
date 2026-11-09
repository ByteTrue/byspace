---
kind: issue
title: "退役 BySpace MCP 工具，改由 bundled skill + byspace CLI 承担"
type: refactor
created: 2026-11-09
---

# 退役 BySpace MCP 工具，改由 bundled skill + byspace CLI 承担

## 目标与范围

同一份工具 catalog 投递了三种形态：pi 的 `registerMcpServer`、codex 的 `mcp_servers`、omp 的 RPC host tools。三种都是「把工具定义塞进 agent」。改为一种：agent 从 `~/.agents/skills`（或 `~/.claude/skills`）读到 `byspace` 技能，用 `byspace …` 命令操作 daemon。

包含：

- agent 进程拿到 CLI 身份（home、agent id、凭证、PATH），`byspace` 在 agent 的 shell 里可用且被认成该 agent；
- bundled `byspace` skill 改成 CLI 契约（`--help` 为真源），不再复述工具签名；
- 工具投递代码退役：`internal/server/mcp.go`、`mcp_inject.go`、`mcp_schedule.go`、`byspace mcp-bridge`、`/mcp/agents`、pi 扩展里的 MCP 注册、codex 的 `mcp_servers`、omp 的 host tools；
- `daemon.mcp.*` 配置键保留解析（COMPAT），不再驱动投递。

不包含：ACP 客户端（copilot/cursor/kimi/kiro/trae）的技能根适配——本轮不管，按现状（拿不到工具）继续。

## 现状

MCP 桥的链路、各 provider 的投递差异、以及为什么 ACP 是空数组，见本会话调查记录（`byissue/decisions/002-pi-mcp-exposure-not-set-by-byspace.md`、`docs/providers.md` 的 Pi 段）。

关键事实：`capabilityToken` 是每次 daemon 运行生成、落在 `<home>/mcp-capability-token` 的凭证，已经作为「agent 不需要密码」的唯一通路；`<home>/cli-credential` 是宿主 CLI 的独立 principal。`create_agent_request` 已有可选 `callerAgentId`（`packages/protocol/src/messages.ts:1936`），MCP 的 `create_agent` 反而没有用它建立父子关系。

## 方案

身份：agent 进程环境加 `BYSPACE_HOME`、`BYSPACE_AGENT_ID`、`BYSPACE_AGENT_CREDENTIAL`（= capabilityToken），PATH 前置 daemon 可执行文件所在目录。CLI 侧优先用 `BYSPACE_AGENT_CREDENTIAL` 作 bearer，创建 agent 时带上 `callerAgentId`。信任模型与现状一致：MCP 桥今天也是把 agent id 放在 env 里自报。

技能：`internal/server/skills/byspace/SKILL.md` 瘦身成「先 `byspace <group> --help`」+ 工作流约束（父子关系、不要轮询、schedule vs heartbeat）。选装机制不动。

开关：删除。「Enable BySpace tools」控制的是 MCP 注入；技能默认安装、MCP 不在之后它没有可做的动作。安装与否交给已有的 skills 选择器，配置键留在 schema 里但不读。

`byspaceTools`（按 provider 禁用单个工具）随 catalog 一起退休：没有投递面之后它没有执行点。配置键继续被接受但不再生效，公开文档改为已退役说明。

## 风险与穿刺

| 风险                                                                         | 怎样算打通                                                          | 结果                                                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| agent 的 shell 能否用一个不需要用户密码的凭证操作 daemon                     | 无密码 + 有密码两种 home 下，agent 环境里的 `byspace agent ls` 成功 | 凭证走既有 `cli-credential`，未新增认证面；未在真实 agent 里跑一次 |
| 注入 env 是否破坏 provider 启动（openCode 共享池、codex/claude 的 env 语义） | `make build` + provider 启动测试通过                                | 通过。openCode 的环境不是 per-session，见遗留                      |
| 父子关系是否真的落在 labels 上                                               | 带 `callerAgentId` 创建的 agent 出现在 `agent ls` 的父子树里        | daemon 侧有测试；CLI 侧只加了字段                                  |
| 删掉 catalog 后 omp / codex / pi 是否还能正常起                              | 三个 provider 的 session 测试通过；`/mcp/agents` 404                | 通过；路由与 `/mcp/` 前缀一起移除                                  |

顺序：先让 CLI 身份可用（与 MCP 并存），再切技能与开关，最后删代码。

## 验证

- `npm run test:go`（改动包）
- `make build` + `npm run audit -- --no-browser`
- dev daemon（6778）上真实 pi agent 跑一次 `byspace agent ls` / `byspace agent run`

## 执行记录

实现落在一条切片上，先让新路可用，再删旧路：

1. **身份与 PATH**（`internal/server/agentenv.go`，新增）：agent 子进程环境带 `BYSPACE_HOME`、`BYSPACE_HOST`（wildcard 监听折成 loopback）、`BYSPACE_AGENT_ID`，并把 daemon 可执行文件目录前置到 `PATH`。凭证没有新增：CLI 读宿主自己的 `cli-credential`。
2. **调用者归属**：`byspace run` 在 `BYSPACE_AGENT_ID` 存在时把 `callerAgentId` 放进 `create_agent_request`；daemon 原有的 `callerAgentId` → `byspace.parent-agent-id` 链路照旧生效。
3. **技能**：`internal/server/skills/byspace/SKILL.md` 改写成 CLI 契约（`--help` 为准），保留工具 schema 里无法从代码读出的语义：归属与放置分离、不要轮询、schedule vs heartbeat、不得操作自己的 daemon、不得替自己批权限。
4. **默认安装**：`defaultSkillSelection()` 变成只含 `byspace`；启动修复对全新 home 也执行（原来只在 drift 时修复，全新 home 什么都不装）。uninstall 改用新的 `noSkillsSelection()`，否则卸载会被下一次启动装回来。
5. **删除投递面**：`internal/server/mcp.go`、`mcp_schedule.go`、`mcp_inject.go`、`internal/agent/toolpolicy/`、`internal/agent/providers/{omphosttools,codexpolicy}.go`、`byspace mcp-bridge`、`/mcp/agents` 路由与 capability token、`--no-inject-mcp`、omp host-tool 通道、codex 的 BySpace 预批准（`ApplyCodexToolPolicy`）。用户自己的 `mcpServers` 通路保留（pi 扩展注册、codex `mcp_servers`）。
6. **开关删除**：`Enable BySpace tools` 那张卡片没有存在的意义了（技能默认装、MCP 不在），连同 `settings.host.orchestration.enableTools` 的 9 种语言文案一起删除；`daemon.mcp.*` 与 `byspaceTools` 仍在 schema 里（老客户端能写、daemon 接受但不读）。
7. **补一个缺口**：`byspace run --features '<json>'`。profile 里的 `featureValues`（Codex fast_mode 之类）原先只能经 MCP 的 `settings.features` 传，纯 CLI 之后没有入口。

## 验证

- `go build -tags nogui ./...` 通过。
- `go test -tags nogui ./internal/server/ ./internal/cli/ ./internal/agent/... ./internal/daemon/` 通过（含新增的 `agentenv_test.go`）。
- 改写的测试：`skills_test.go`（全新 home 只装参考技能）、`skills_uninstall_test.go`（卸载后重启不再装回）、`auth_test.go` / `config_reload_test.go` / `classify_test.go` / `cli_test.go` 中引用已删代码的断言。
- `npm run typecheck`（先 `build:client` + `build:highlight`）、`oxlint`、`oxfmt`、`web/src/core/i18n/resources.test.ts`、`node scripts/docs-links.test.mjs` 通过。

## 遗留与已知上限

- **ACP**：本轮不管。daemon 给 ACP 的 `session/new` 传空 `mcpServers`，技能也读不到，所以 copilot / cursor / kimi / kiro / trae 没有任何 BySpace 能力。要补的话是 `internal/agent/providers/acp.go:141,146` 一处加映射，不是每客户端一套。
- **OpenCode**：共享 `opencode serve` 的进程环境不是 per-session，所以 agent id 归属不到，`byspace` 只在 daemon 自己的 `PATH`/`BYSPACE_HOME` 恰好可用时能跑。要修需要 per-agent server 或 session 级环境，未做。
- **终端里的 CLI**：`byspace terminal create` 起的 shell 没有 `BYSPACE_AGENT_ID`，在其中运行的命令算作宿主 CLI，不归属到 agent。
- **workflow skills 的 profile 读取**：`list_profiles` 原本是 Go 侧的空壳，删掉后三个 workflow 技能改为读 `$BYSPACE_HOME/config.json` 的 `agentProfiles`。
- **截图/时间线**：工具调用不再有结构化卡片，只剩 bash 行；否则本刀无法收敛。

## 第二轮：把「存了没传」的参数补齐（2026-11-09）

第一轮退役 MCP 之后，审计「daemon 存了、UI 报了、provider 没收到」的参数，发现不是一处而是五处，并且修了其中能可靠落地的部分。清单与每家的通道见 `docs/providers.md` 的「What the daemon can actually send each provider」。

**删掉的无用参数**

- `create_agent_request.env`（顶层，解析了没人读）+ CLI `--env`（写的是 `config.env`，daemon 根本不解析）→ CLI flag 与写入删除；两个 wire 字段保留解析并标 `COMPAT(createEnvGit)`，因为老客户端仍会发。
- `create_agent_request.git`（旧字段，被 `worktree` intent 取代）→ 同上，保留解析、不再使用。
- `config.mcpServers` / `providerOptions.mcpServers` → 整条透传删除：`userMCPServers`、`LaunchConfig.MCPServers`、pi 扩展的 `registerMcpServer` 循环、codex 的 `mcp_servers`、`store.AgentConfig.McpServers`、schedule 目标里的同名字段。用户自己的 server 由各家 CLI 自己的配置文件负责。
- `/api/subagent-report`（校验完直接 204 丢弃，pi 扩展也从不调用）→ 路由、handler、文档段落删除。

**补上的传输**

- **Codex**（`internal/agent/providers/codexturn.go`，新）：`turn/start` 现在带 `model`、`effort`（thinking）、`serviceTier`（`fast_mode`，且只给支持该模型）、`approvalPolicy` + `sandboxPolicy`（mode 预设，port 自 node 的 `MODE_PRESETS`/`toSandboxPolicy`），用户的 `providerOptions.approval_policy`/`sandbox_mode` 优先。之前这些一个都没发。
- **Claude**：`--append-system-prompt`（daemon 系统提示）+ `--effort`（thinking，仅 low..max；`off`/`ultracode`/`default` 不传）。`claudeLaunchArgs` 抽成纯函数以便测试。
- **OpenCode**：消息体带 `model{providerID,modelID}`、`agent`（mode）、`variant`（thinking）。之前只发 `parts`，三个选择器全是装饰。
- **ACP**：`session/new` 后按 `session/set_config_option` 下发 model / mode / thought_level；运行时 setter 之外补了 `SetMode`。
- **运行时 ModeSetter**：新增可选接口，Codex/OpenCode/ACP 下一轮生效；之前「applies next turn」对谁都不成立。
- **`--output-schema`**：provider 不支持时现在**失败**并说明原因，而不是跑一轮散文让调用方去解析。

**顺带修的真 bug**

daemon 侧 git 调用只禁了 pager，没禁 editor。在有 TTY 的地方（agent 终端）`git merge`/`pull` 会调 `core.editor`（用户机器上是 `code --wait`），git 卡到超时、屏幕上弹编辑器。现在 `gitEnv()` 统一 `GIT_EDITOR=true`、`GIT_SEQUENCE_EDITOR=true`、`GIT_MERGE_AUTOEDIT=no`，`Merge`/`MergeStrategy`/`Pull` 加 `--no-edit`；`TestGitEnvDisablesEveryEditor` 是这个约束的守卫（非 TTY 下 git 本来就不开编辑器，所以端到端测不出来）。

**验证**

`go build` / `go vet` 干净；`internal/{server,cli,agent/…,workspace,store}` 全绿；`npm run typecheck` 0 error、`oxlint` 0/0、`oxfmt` 通过；`scripts/docs-links.test.mjs` 通过；`web/src/core/i18n/resources.test.ts` 34 通过。新增 `codexturn_test.go`（mode/thinking/fast/provider-options 覆盖）、`turnparams_test.go`（Claude 参数、OpenCode 消息体）、`git_editor_test.go`。

**仍未做**

- Codex 的 system prompt 与 `plan_mode`：都要走 `collaborationMode/list` + `settings.developer_instructions`，没 port。
- Claude 的 `fast_mode`：CLI 没有对应 flag（node 时代经 SDK），开关仍在但发不出去。
- Claude / Pi 换模型或 thinking 只能重开 session（`--resume` + 新 flag），现在只是改记录。
- Claude 的 `--json-schema`：CLI 有，但要把它从 per-turn 提到 `LaunchConfig`，未做；因此 `--output-schema` 现在对 Claude 是明确失败。
- OpenCode 的进程环境不是 per-session，`BYSPACE_AGENT_ID` 在那边没有归属。

## 关闭结论

**可关**：两轮目标都达成且各有证据——MCP 投递面清零（`rg "mcp-bridge|/mcp/agents|toolpolicy"` 在活代码零命中），skill+CLI 通路可用（`agentEnv` + `callerAgentId` + 默认安装的技能 + `--help` 契约），审计出的「存了没传」参数补齐到 `docs/providers.md` 表格的现状。

**验证摘要**：`go build`/`go vet` 干净；`internal/{server,cli,agent/…,workspace,store}` 全绿（292 passed in server+cli）；typecheck 0 error、oxlint 0/0、oxfmt 通过、`docs-links` 通过、i18n 34 通过；`npm run audit -- --no-browser` 只剩两个未改动包的既有 Windows 环境失败（`internal/proc` pid 枚举、`internal/selfupdate` symlink 权限）。

**回写位置**：稳定结论进 `byissue/spec/agent-tools.md`（术语、边界、被排除方案、长期约束）并在 `spec/index.md` 登记；`spec/schedules.md` 里「Agent 通过 MCP 管理 heartbeat」改为 CLI；取舍记在 `decisions/2026-11-09-retire-mcp-tool-delivery.md`，`decisions/002` 标 superseded；provider 通道清单在 `docs/providers.md`。

**遗留事项**（另开事项，不藏在关闭结论里）：Codex 的 system prompt 与 `plan_mode`（需 `collaborationMode`）、Claude 的 `fast_mode`（CLI 无 flag）、Claude/Pi 中途换模型（需重启 session）、OpenCode 的 per-agent 身份。
