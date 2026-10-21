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

## 验收与关闭（2026-10-21）

**验收结论：交付，其中 `ssh://` 部分为 DROPPED。**

- `byspace attach`（前缀匹配 + 先回放历史再跟随）、`onboard`、`hooks`、`pair --qr`（真 QR，
  `skip2/go-qrcode`）、统一输出层（`--json`/`--yaml`/`-q`/自适应表格，CJK 按显示列宽）、
  Relay 切流代理全部落地。
- 审计后补：`schedule update`、`workspace setup`、路径直开（`byspace .`）、
  unix socket 连接、`BYSPACE_HOST`、`agent mode`（此前被**静默路由到 `agent update`**）、
  `daemon install-service`/`uninstall-service`/`service-status`（`print-plist` 只打印文件，
  从没让平台加载它）。

**DROPPED**：`ssh://` 自动隧道。需要第二台机器验证，盲写风险高于收益，条件写在
service-proxy Issue。
