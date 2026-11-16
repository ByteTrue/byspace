---
title: "Provider 模型与可执行文件的真实来源"
created: 2026-11-11
---

# Provider 模型与可执行文件的真实来源

2026-11-10/11 在 Windows dev 机（Pi 1.5.2、Claude Code 2.1.317、OpenCode 2.2.7）核对，供后续 provider 检测与模型发现参考。

## Pi 独立安装

- 托管安装写入 `~/.pi/agent/`：launcher 在 `~/.pi/agent/bin/pi`（Windows 为 `pi.cmd`/`pi.ps1`），版本在 `~/.pi/agent/install/current-version`，入口在 `managed-install.json` 的 `entrypoint.path`。
- 该目录不会进入桌面 App 的 PATH。用户报告的 `~/.pi/agents/bin` 也一并作为候选，避免只认一种拼写。
- 复现/复核：`Get-Content ~/.pi/agent/install/managed-install.json`，或看 `execres.Lookup("pi")` 是否返回该目录。

## Claude Code 第三方模型

- `~/.claude/settings.json`（或 `CLAUDE_CONFIG_DIR` 下的同名文件）里，第三方网关模型主要写在 `modelPicker.options[].model`，带 `label`/`description`；`model` 与 `env.ANTHROPIC_MODEL`、`ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL`、`ANTHROPIC_SMALL_FAST_MODEL` 也会指定模型 id。
- 参考实现 `reference/paseo/.../claude/models.ts` 只读 `model` 与 env 键，**不读 `modelPicker.options`**；拿 paseo 做对齐时不要漏掉这一层，否则新版本 Claude Code 的第三方模型仍然不出现。
- 这些 id 直接作为 `claude --model <id>` 使用；不需要把它们映射回 Anthropic manifest。
- 复核：`~/.claude/settings.json` 的 `modelPicker.options` 条数应与界面新增的 Claude 模型数一致。

## OpenCode 模型

- `opencode models` 输出每行一个 `provider/model`，已包含用户 config、凭据与环境决定的全部可用模型；没有显示名和 thinking variants。
- 同一份 config 下 `opencode serve` 的 HTTP 路由在不同大版本间会变（2.x 的 `serve` 对未知路径回落到 Web UI），所以模型发现走 CLI 命令，不依赖 server API。
- 复核：`opencode models` 的行数应等于 OpenCode 卡片里 Discovered 的数量（CLI 警告行会被过滤）。
