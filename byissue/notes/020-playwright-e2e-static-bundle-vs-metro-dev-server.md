---
kind: note
title: "Playwright E2E 提速与防 Flake：一次静态导出替代分片内实时 Metro Dev Bundler"
created: 2026-10-29
---

# Playwright E2E 提速与防 Flake：一次静态导出替代分片内实时 Metro Dev Bundler

## 现象与根因

此前 GitHub Actions 上的 16 个 `playwright` E2E 分片单分片耗时高达 **7.5–9.5 分钟**，且频繁在未改动用例上发生随机超时（flake）：

1. **16 次重复编译**：每个分片各自独立执行 `setup-go`、`npm run build:app-deps && npm run build:relay` 与 `make build`。
2. **分片内运行实时 `expo start --web`（Metro Dev Bundler）**：`packages/app/e2e/support/global-setup.ts` 在每个 2 核 7GB 内存的 Runner 上启动实时 Metro 并执行 `warmMetro`（无缓存下实时跑 Babel + React Compiler 耗时 **60–90 秒**）；测试期间 Metro 常驻占用 ~1.5GB 内存与近 1 个 CPU 核，且每次 `page.goto` 传输并解析 **25MB 未压缩开发态 JS bundle**，迫使分片锁死 `E2E_WORKERS=1` 仍频繁发生 CPU 争抢超时。

## 解决机制（借鉴 Magpie 零 Bundler 静态测试思路）

1. **`build-e2e` 一次预构建（`.github/workflows/ci.yml`）**：集中执行 1 次 `npm run build:app-deps && npm run build:relay`、`make build-web`（导出生产级静态 `internal/webui/dist`，体积 ~2MB）与 `make build`（编译 `bin/byspace`），打包为 `e2e-prebuilt` artifact 分发给 16 个分片。
2. **`global-setup.ts` 零 Metro 静态直出**：当检测到 `E2E_STATIC_WEB_DIR`（或 CI 预构建的 `internal/webui/dist/index.html`）时，直接使用 Node 原生 `http.createServer` 在毫秒内提供静态资产（支持 `.gz` 与 SPA 路由回退，0 Metro 进程），分片内并发从 `E2E_WORKERS=1` 提升至 `E2E_WORKERS=2`（本地若需调试实时热更新可通过 `E2E_USE_METRO=1` 切回）。
3. **发版与 Docker 去重**：从 `.github/ci-paths.yml` 的 `workspace` 列表移除裸 `package.json`（真实依赖变更必改 `package-lock.json`），使 `chore(release): cut vX.Y.Z` 版本号提交走 95 秒快速校验通道；移除 `docker.yml` 在 `main` push 上的冗余双架构 QEMU 空跑。
4. **消灭 `shard 16/16` 8 分钟长尾（`opencode acp serve` 35s 死等 Bug）与 `build-e2e` Brotli 11 级瓶颈**：
   - `shard 16/16` 此前耗时 8 分钟，是因为 `worktree-restore.spec.ts` 单文件耗时 5.5 分钟（每条测试精准多花 35s 或 65s）：根因是 `internal/agent/providers/opencode.go:57` 将 `spec.DefaultArgs`（`["acp"]`）传给了 `sharedOpenCodePool`，拼出非法命令 `opencode acp serve --port <p>` 导致进程 10ms 内退出，而 `opencodepool.go` 的 `waitReady` 未监听 `cmd.Wait()`，每次都对着已退出进程死等 30s `startupTimeout` + 5s `stopServer` 才回退到 ACP，且 `startServer` 把带 `defer cancel()` 的 `startCtx` 传给 `exec.CommandContext` 导致启动成功返回瞬间即杀死进程。修复后 `opencode serve` 在 0.3s 内就绪并复用。
   - `build-e2e` 此前耗时 5 分 04 秒，是因为 `make build-web` 对 20MB JS 执行了单线程 `BROTLI_MAX_QUALITY`（level 11）极限压缩（耗时 ~3 分钟）；改为直接运行 `expo export --platform web`（并将发布脚本的 Brotli 质量设为 6），`build-e2e` 再省 ~3.5 分钟。
