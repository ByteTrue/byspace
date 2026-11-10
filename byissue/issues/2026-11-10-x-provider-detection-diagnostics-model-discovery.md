---
kind: issue
title: "Provider 检测、诊断与模型发现漏掉独立安装与第三方模型"
type: bug
created: 2026-11-10
---

# Provider 检测、诊断与模型发现漏掉独立安装与第三方模型

> **读者：** 接手的人——四个生产症状的共同根因、改哪几处、怎样用本机真实 CLI 验证。

## 预期 / 实际

1. **Pi 显示 Not installed。** 预期：Pi 1.5.1+ 独立安装后仍被识别。实际：桌面 daemon 不继承终端 PATH，`~/.pi/agent/bin` 不在候选目录里，`execres.Find("pi")` 找不到却能在终端正常运行。
2. **Diagnostic 永远显示健康。** 预期：诊断报告实际解析到的二进制、版本、PATH 与配置来源。实际：`provider_diagnostic_request` 固定返回 `Pi provider is healthy (Go runtime host)`，对任何 provider、任何状态都一样。
3. **OpenCode 只发现 1 个模型。** 预期：列出 `opencode models` 能打印的全部模型。实际：Go 目录里 OpenCode 的模型是静态的一条 `anthropic/claude-sonnet-4-5`，没有运行时发现。
4. **Claude 看不到第三方模型。** 预期：Claude Code 自己的 `settings.json` 里配置的模型（`modelPicker.options`、`model`、`env.ANTHROPIC_*_MODEL`）出现在选择器里。实际：Go 只发静态 manifest，Claude Code 2.1.x 的第三方模型全部缺席。

四个症状都出在 Go daemon 的 provider 发现层；参考实现在 `C:\Users\byte\workspace\reference\paseo`（`executable-resolution`、`providers/claude/models.ts`、`providers/diagnostic-utils.ts`、`opencode-agent.ts`）。

## 根因位置

- `internal/execres/find.go` `StandardDirs()` 只列 `/usr/local/bin`、`~/.local/bin`、`/opt/homebrew/bin`，Windows 直接返回 nil；Pi 的托管安装目录不在其中。
- `internal/server/ws_git_system.go:1481` 的诊断分支是硬编码文案。
- `internal/server/provider_catalog.go:45` 只探测 Pi 模型；`drivers.go` 的 OpenCode/Claude 模型是静态清单。
- `internal/agent/providers/claudemodels.go` 不读 `~/.claude/settings.json`。

## 本机证据

- 2026-11-10，Windows dev 机：`~/.pi/agent/bin/pi.cmd`（版本 1.5.2，`managed-install.json` 的 entrypoint）存在；`pi --version` 正常。
- 同机 `opencode models` 输出 29 条模型（bytetrueapi/_ 与 opencode/_），而界面只显示 1 条。
- 同机 `~/.claude/settings.json` 有 `modelPicker.options`（29 条第三方模型）与 `env.ANTHROPIC_DEFAULT_*_MODEL`；Claude Code 2.1.317。

## 范围

包含：Pi 独立安装路径、真实 provider 诊断、OpenCode 模型发现、Claude settings 模型发现。

不包含：Codex/Copilot/ACP 的运行时模型发现（同类缺口，另议）；OpenCode 的模型显示名与 thinking variants（CLI 只给 id，参考实现走 server API，这里先用 CLI 的 id 与默认列表）；任何 wire/protocol 字段变更。

## 方案

- `StandardDirs()` 增加 `~/.pi/agent/bin` 与 `~/.pi/agents/bin`，所有平台生效；Pi 探测与启动共用。
- `provider_diagnostic_request` 改为实际解析：命令、解析路径、`--version`、PATH 命中、daemon PATH，Pi 额外报 `auth.json`，Claude 额外报设置文件。
- `BuildSnapshotEntries` 接受一个按 provider id 取运行时模型的回调；OpenCode 用 `opencode models`（解析 id），Claude 用 manifest + settings。回调只在 provider 已启用且二进制可用时调用。
- `list_provider_models_request` 复用同一发现路径。

## 验证

- `go test ./internal/execres ./internal/agent/providers ./internal/server -count=1`。
- 真实 CLI 探针：本机 `opencode models`、`~/.claude/settings.json`、`~/.pi/agent/bin` 的路径进入解析结果。
- `npm run audit -- --no-browser`。

## 执行记录

2026-11-10/11 实现。

- `internal/execres/find.go`：`StandardDirs()` 增加 `~/.pi/agent/bin` 与 `~/.pi/agents/bin`（所有平台）；新增不执行二进制的 `Lookup()`，供启动路径解析。
- `internal/agent/pi/pi.go`：`BuildLaunchArgs` 用 `Lookup` 解析裸命令，目录探测、自动命名和直接启动共用同一结果。
- `internal/agent/providers/diagnostic.go`：真实诊断——命令、解析路径、`--version`、PATH 命中、daemon PATH，Pi 报 `auth.json`，Claude 报设置文件与 settings 模型数。
- `internal/server/ws_git_system.go`：`provider_diagnostic_request` 改调 `BuildProviderDiagnostic`，20s 上限。
- `internal/agent/providers/claudemodels.go`：`ClaudeModelsWithSettings()`，读取 `modelPicker.options`、`model`、`env.ANTHROPIC_*_MODEL`，去重后追加到 manifest；自定义模型给标准 effort 档位，`[1m]` 写 1M 上下文元数据。
- `internal/agent/providers/opencodemodels.go`：`ProbeOpenCodeModels()` 运行 `opencode models` 并按 id 建目录。
- `internal/agent/providers/driver.go`：`BuildSnapshotEntries` 接受按 provider 取运行时模型的回调，只在已启用且二进制可用时调用；自定义 pi 派生 provider 复用 pi 探测结果。
- `internal/server/provider_catalog.go` / `server.go`：快照与 `list_provider_models_request` 共用 `discoveredModels`。
- `internal/cli/commands_parity.go`：`provider models <id>` / `provider diagnostic <id>` 以前写死 `pi`，现在使用位置参数，和 `public-docs/troubleshooting.md` 的写法一致。
- 文档：`docs/providers.md` 的 Claude 清单路径与三类模型来源；笔记 `byissue/notes/2026-11-11-provider-model-sources.md`。

**验证（实测，2026-11-10/11，Windows dev 机）**

- 真实探针：Claude Code 2.1.317 → 45 个模型（15 manifest + 30 settings）；OpenCode 2.2.7 → 29 个模型；`execres.Lookup("pi")` → `C:\Users\byte\.pi\agent\bin\pi.cmd`；`pi.ProbeCatalog`（Command 为空）→ 46 个模型，证明裸 `pi` 已能从托管目录启动。
- 真实快照：`buildProviderCatalog` 输出 `claude status=ready models=45`、`opencode status=ready models=29`。
- 真实诊断：Pi 报 1.5.2 与 auth 文件 found；Claude 报设置文件 found + 30 个 settings 模型；OpenCode 报 2.2.7。
- `go test ./internal/execres ./internal/agent/providers ./internal/agent/pi ./internal/server -run ... -count=1` 通过；`go build ./internal/...` 通过。
- `npm run typecheck`（先 `npm run build:client` 刷新声明）、`npm run lint`、`npm run format:check` 通过。
- `npm run audit -- --no-browser`：入站/出站字段对账、重审账本通过；Go 测试失败 3 个，均为未改动包里的 Windows 环境限制（`TestListeningOnAndIsBySpace` 的 netstat PID 查询、`EnsureBundleCLISymlink…` 的符号链接权限、`TestAllocatePortFromScriptValidates` 依赖 PowerShell 没有 `printf`），在 HEAD 基线 worktree 单独复跑同样失败（实测）。

**还没做 / 需要你看的**

- 未在 macOS 桌面 App 的真实精简 PATH 下跑过：本机是 Windows，Pi 目录与 OpenCode/Claude 输出用同一套 `StandardDirs` 验证；macOS 的 `~/.pi/agent/bin` 拼写与用户报告一致，但桌面启动环境未实测。
- OpenCode 的模型显示名与 thinking variants 未做（CLI 只给 id）；`opencode models` 的输出不含 variant，属于已记录的有界简化。

## 关闭结论

四个症状都已在共享发现层修复：Pi 托管安装进入候选目录并被启动路径解析，诊断改为真实探测，OpenCode 与 Claude 的模型目录来自各自的运行时来源。验证以本机真实 CLI 与真实快照为准；macOS 桌面环境复验作为遗留风险保留在上一节，不阻塞关闭（用户 2026-11-11 明确要求审完即关闭）。稳定行为已写入 `docs/providers.md`，外部事实与参考实现缺口写入 `byissue/notes/2026-11-11-provider-model-sources.md`；project spec 无需变更。
