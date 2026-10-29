---
kind: issue
title: "退出 npm 分发：install.sh/install.ps1 安装脚本、macOS .app 打包与二进制直发"
type: feature
created: 2026-10-29
---

# 005: 退出 npm 分发：install.sh/install.ps1 安装脚本、macOS .app 打包与二进制直发

## 目标与范围

彻底告别 npm 分发，对齐 Magpie 的全平台二进制直发体验：

1. **`install.sh`（Unix / macOS / Linux / Termux）与 `install.ps1`（Windows PowerShell）**：
   - 位于仓库根目录并同步至 `packages/app/public/`（随 Web / Worker 同源部署于 `/install.sh` 与 `/install.ps1`）；
   - 支持 `--cli`、`--proxy <url>`、`--mirror <prefix>`、`--version <tag>`；
   - 从最新 Release 拉取 `SHA256SUMS` 并严格校验下载产物的 SHA-256；
   - **全平台默认行为统一**：macOS、Linux、Termux 与 Windows 默认均只安装纯 CLI 二进制（`byspace-cli-<os>-<arch>`）到 `~/.local/bin/byspace`（Termux 为 `$PREFIX/bin`，Windows 为 `$HOME\.local\bin\byspace.exe` 并自动加入用户 `PATH`）；显式传 `--app` / `--desktop`（或 `BYSPACE_APP=1`）时才安装桌面客户端（macOS 安装 `BySpace.app` 并软链 CLI）。常规桌面/移动客户端直接从 GitHub Releases 下载安装包（`.dmg` / `.exe` / Linux 桌面二进制 / `.apk`）。
2. **macOS `BySpace.app` 打包与全平台构建目标（`Makefile` & `build/darwin`）**：
   - 新增 `build/darwin/Info.plist` 与 `make app`（生成 `BySpace.app` 与 `dist/byspace-darwin-<arch>.zip`）、`make release-cli`（交叉编译 7 个平台 `byspace-cli-*`）、`make release-windows`（交叉编译 Windows 桌面端 `byspace-windows-*.exe`）、`make checksums`（生成 `dist/SHA256SUMS`）。
3. **Android 固定侧载签名（`build/android/byspace-sideload.jks`）**：
   - 内置固定侧载签名证书，确保不同机器与 CI 构建的 `byspace-android-arm64.apk` 可直接覆盖安装升级。
4. **GitHub Releases 二进制直发工作流与前端引导命令同步**：
   - `.github/workflows/release.yml` 替代原 `npm-release.yml`；
   - `packages/app/src/utils/setup-commands.ts` 安装命令更新为 `curl -fsSL https://app.byspace.cc.cd/install.sh | sh`。

## 执行记录与验证

- **实现落点**：
  - `install.sh`、`install.ps1`、`packages/app/public/install.sh`、`packages/app/public/install.ps1`
  - `build/darwin/Info.plist`、`build/android/byspace-sideload.jks`、`build/android/app/build.gradle`、`Makefile`
  - `.github/workflows/release.yml`、`packages/app/src/utils/setup-commands.ts`
- **验证证据**：
  - 在本机完整跑通 `make app && make release-cli && make release-windows && make build-android && make checksums`，产出全部 11 个分发包与 `dist/SHA256SUMS`；
  - 用本地 HTTP Release 服务实测 `./install.sh` 默认模式（安装 `BySpace.app` + 软链 `byspace`）与 `./install.sh --cli` 模式（安装独立 CLI 二进制），SHA-256 校验与运行验证全部通过。
