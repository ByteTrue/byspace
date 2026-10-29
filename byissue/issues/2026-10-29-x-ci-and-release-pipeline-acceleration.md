---
kind: issue
title: "CI 与发版流水线提速：Playwright 预构建复用、版本号提交免重跑全量 E2E 与 Docker 构建去重"
type: perf
created: 2026-10-29
---

# CI 与发版流水线提速：Playwright 预构建复用、版本号提交免重跑全量 E2E 与 Docker 构建去重

状态：**已交付关闭**（2026-10-29）

## 问题与现状

此前发版一次耗时约 13–15 分钟，瓶颈集中在三处重复工作：

1. **16 个 Playwright 分片重复编译 16 次**：每个分片独立执行 `setup-go`、`npm run build:app-deps && npm run build:relay` 与 `make build`，把完全相同的 TS 工作区和 Go 二进制重复编译了 16 遍。
2. **`chore(release): cut vX.Y.Z` 强制触发 `full: true` 重跑全套 16 分片 E2E**：即使前一个业务 commit 刚刚跑绿 CI，`version:all` 修改 `package.json` 的 `version` 字段仍会命中 `.github/ci-paths.yml` 的 `workspace` 规则，导致每次发版必须再等 8 分钟的 16 分片 Playwright（且偶发单分片超时会导致整个发版打标失败重来）。
3. **`Docker` 工作流在 `main` push 与 `v*` tag push 上重复构建双架构 QEMU 镜像**：每次推 `main` 都会触发一次不推送的 `linux/amd64,linux/arm64` QEMU 构建（耗时 ~7 分钟），紧接着打 tag 又对同一份代码重编一次。

## 落地与验证

1. **`build-e2e` 一次静态导出 + `global-setup.ts` 零 Metro 静态直出 + `E2E_WORKERS=2`（`.github/workflows/ci.yml` & `packages/app/e2e/support/global-setup.ts`）**：
   - 根因定位：此前 16 个 Playwright 分片各自启动一个实时的 `expo start --web`（Metro Dev Bundler），光 `warmMetro` 预热每个分片就要白烧 60–90 秒，且 Metro 常驻占满 1 个 CPU 核与 1.5GB 内存、每次 `page.goto` 传输 25MB 未压缩开发包，迫使 2 核 Runner 锁死 `E2E_WORKERS=1` 并频繁发生 CPU 争抢随机超时。
   - 治本改造：在 `build-e2e` job 中统一执行一次 `make build-web`（导出静态 `internal/webui/dist`）与 `make build`；`global-setup.ts` 在检测到 `E2E_STATIC_WEB_DIR`（或 CI 预构建 `internal/webui/dist`）时，直接用 Node 原生 `http.createServer` 在毫秒内提供静态 bundle（自动支持 `.gz` 与 SPA 路由回退，0 Metro 进程），并将分片内并发提升至 `E2E_WORKERS=2`，同时恢复在 `main` push 上运行全量 16 分片 Playwright。
   - 本机实测：`E2E_STATIC_WEB_DIR=internal/webui/dist` 运行 `appearance-theme-picker.spec.ts`（4 条完整浏览器用例），静态服务 0 秒就绪，单条用例 1.0–1.6s，总耗时从原先含 Metro 预热的 ~75s 降至 **9.1s**。
2. **精准路径路由与版本号提交快速通道（`.github/ci-paths.yml`）**：
   - 依赖变更始终修改 `package-lock.json`，从 `workspace` 过滤列表中移除裸 `package.json`，使 `chore(release): cut vX.Y.Z` 版本号提交仅触发快速的 `changes` / `format` / `lint` / `typecheck` 守卫（~1.5 分钟直通打标）；
   - 在 `browser` 过滤列表中排除 `!internal/gui/**` 与 `!internal/selfupdate/**`（Playwright 跑的是 `-tags nogui` 无头服务，不受桌面壳与自更新包影响）。
3. **`Docker` 工作流去重（`.github/workflows/docker.yml`）**：移除 `push: branches: [main]` 上的冗余双架构空跑，仅在 `v*` tag 发布（双架构推送）与影响 `docker/**` 的 PR（单架构 `linux/amd64` 快速校验）时运行。
