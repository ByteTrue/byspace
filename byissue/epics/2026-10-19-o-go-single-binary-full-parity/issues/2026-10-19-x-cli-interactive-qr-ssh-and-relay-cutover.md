---
kind: issue
title: "CLI 交互式 attach、终端二维码、onboard/hooks、ssh:// 隧道、统一格式化输出与 Relay 切流代理"
type: feature
created: 2026-10-19
---

# CLI 交互式 attach、终端二维码、onboard/hooks、ssh:// 隧道、统一格式化输出与 Relay 切流代理

## 目标与范围

对齐 CLI 全命令组、`byspace pair --qr` 终端 ASCII 二维码渲染、`daemon.get_pairing_offer.response.qr` 字段以及 Relay `BYSPACE_RELAY_UPSTREAM` 切流代理。

## 执行记录

- 在 `internal/server/runtime_services.go` 中实现 `RenderASCIIQRCode`（UTF-8 半块字符画二维码），接入 `daemon.get_pairing_offer.response` 的 `qr` 字段与 `byspace pair --qr` CLI。
- 在 `internal/relay/relay.go` 中实现 `UpstreamURL` / `BYSPACE_RELAY_UPSTREAM` 透明切流反向代理。
- 在 `internal/cli/commands_parity.go` 与 `main.go` 中补齐 `agent`, `project`, `workspace`, `worktree`, `schedule`, `heartbeat`, `terminal`, `provider`, `script`, `permit`, `pair`, `clone`, `open`, `hooks`, `onboard` 全套命令组。

## 验证

- `go test -v ./internal/cli ./internal/relay ./internal/server` 全部通过。

## 关闭候选

- 关闭时回写本 Epic `spec.md` 推进视图。
