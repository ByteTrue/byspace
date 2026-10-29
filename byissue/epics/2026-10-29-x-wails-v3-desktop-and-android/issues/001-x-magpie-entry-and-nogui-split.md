---
kind: issue
title: "根 main.go 统一入口、gui_on/gui_off (-tags nogui) 分离与构建链对齐"
type: feature
created: 2026-10-29
---

# 001: 根 main.go 统一入口、gui_on/gui_off (-tags nogui) 分离与构建链对齐

## 目标与范围

将仓库入口对齐 Magpie：

1. 在仓库根目录提供 `main.go`（同时保留 `cmd/byspace/main.go` 兼容已有调用）。
2. 在 `internal/cli` 新增 `gui_on.go`（`//go:build !nogui`）与 `gui_off.go`（`//go:build nogui`），支持 `byspace app` / `byspace gui` / `byspace tray` 子命令及 `byspace://` 深链参数，并在 `!nogui` 构建下将无参数调用路由到 `runGUI`，在 `nogui` 构建下保持无参数运行 `runServe` 的向后兼容行为。
3. 更新 `Makefile`、`docker/Dockerfile` 与 `scripts/package-go-release.mjs`：无头构建显式携带 `-tags nogui`（`CGO_ENABLED=0`），并提供 `make build-app`（Wails v3 桌面端构建）与 `make build-android`（Android APK 构建）入口。

## 执行记录与验证

- **实现落点**：
  - `main.go`：根包唯一入口，调用 `cli.Main`。
  - `internal/cli/gui_on.go` & `internal/cli/gui_off.go`：通过 `nogui` build tag 分离 GUI 与无头构建。
  - `internal/cli/main.go` & `internal/cli/classify.go`：注册 `app` / `gui` / `tray` / `healthcheck` 与 `byspace://` 协议参数分发。
  - `Makefile`、`docker/Dockerfile`、`scripts/package-go-release.mjs`、`packages/app/e2e/support/helpers/daemon-update.ts`：无头构建统一使用 `-tags nogui`。
- **验证证据**：
  - `make build` 产出零 CGO 的 `bin/byspace`，`./bin/byspace version` 与 `go test -tags nogui ./internal/cli/...` 全绿。
  - `make build-app` 产出包含 Wails v3 宿主的 `bin/byspace-app`。
