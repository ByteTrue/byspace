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
