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

1. **新增 `build-e2e` 预构建 job（`.github/workflows/ci.yml`）**：集中构建一次 `packages/*/dist` 与 `bin/byspace` 并上传为 `e2e-prebuilt` artifact，16 个 `playwright` 分片直接下载产物开跑测试，省去 16 次 Go 与 TS 重复编译。
2. **精准路径路由与版本号提交快速通道（`.github/ci-paths.yml`）**：
   - 依赖变更始终修改 `package-lock.json`，从 `workspace` 过滤列表中移除裸 `package.json`，使 `chore(release): cut vX.Y.Z` 版本号提交仅触发快速的 `changes` / `format` / `lint` / `typecheck` 守卫（~1.5 分钟直通打标）；
   - 在 `browser` 过滤列表中排除 `!internal/gui/**` 与 `!internal/selfupdate/**`（Playwright 跑的是 `-tags nogui` 无头服务，不受桌面壳与自更新包影响）。
3. **`Docker` 工作流去重（`.github/workflows/docker.yml`）**：移除 `push: branches: [main]` 上的冗余双架构空跑，仅在 `v*` tag 发布（双架构推送）与影响 `docker/**` 的 PR（单架构 `linux/amd64` 快速校验）时运行。
