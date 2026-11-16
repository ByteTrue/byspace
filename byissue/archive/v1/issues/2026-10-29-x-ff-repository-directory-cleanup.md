---
kind: issue
title: "仓库目录结构瘦身与规范化：移除 archive/ 旧 Node 树、cmd/ 双入口与 12 个退役脚本"
type: ff
status: closed
created: 2026-10-29
closed: 2026-10-29
---

# 仓库目录结构瘦身与规范化：移除 archive/ 旧 Node 树、cmd/ 双入口与 12 个退役脚本

- **做了什么**：
  1. **快照化表面基线并移除 `archive/`（1,112 个旧 Node 文件）**：将 `cli-surface.mjs`、`parity-surface.mjs` 与 `reaudit-ledger-check.mjs` 原先从 `archive/` 扫描的基线固化为 `scripts/node-surface-snapshot.json`，删除 `archive/` 及仅服务于它的 `patches/@opencode-ai+sdk+*.patch`。
  2. **移除 `cmd/byspace/` 双入口**：统一使用仓库根目录 `main.go` 与 `main_android.go`。
  3. **清理 `scripts/` 下 12 个已退役脚本并归口 Android 构建脚本**：删除退役的 iOS 模拟器脚本与旧 npm 发包脚本，将 `scripts/build-android.sh` 移入 `build/android/build.sh`。
  4. **清理根目录冗余文件与重复安装脚本**：删除根目录废弃的 `app.json`、`cli-client-id` 及重复的 `install.sh` / `install.ps1`（单一事实源保留在 `packages/app/public/`），清理本地未追踪僵尸目录。
- **改了哪些**：
  - 删除 `archive/`、`cmd/`、`app.json`、`cli-client-id`、`install.sh`、`install.ps1` 及 `scripts/` 下 12 个死脚本
  - 新增 `scripts/node-surface-snapshot.json`、`build/android/build.sh`
  - 更新 `scripts/cli-surface.mjs`、`scripts/parity-surface.mjs`、`scripts/reaudit-ledger-check.mjs`、`scripts/postinstall-patches.mjs`、`Makefile`
- **怎么验证的**：
  - `npx vitest run packages/app/src/i18n/key-contract.test.ts --bail=1` 通过；
  - 62 项 CI 契约测试与 `npm run audit -- --no-browser` 全绿。
- **对 `byissue/` 的影响**：仓库树减少 1,130+ 个历史冗余文件，目录结构对齐 Magpie 规范。
