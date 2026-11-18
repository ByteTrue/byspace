# 范围覆盖

## 事实源

- 来源：仓库里所有写产物或引用产物路径的位置（explore 子代理全仓清点，m00090；我复核了 Makefile、scripts、web 配置、CI、docs 的原文）。
- 枚举命令：
  ```bash
  grep -rn "bin/byspace\|\"bin\"\|dist/\|test-results\|\.vitest-\|\.playwright-mcp" \
    Makefile package.json byspace.json scripts web/e2e web/perf build .github docker docs AGENTS.md \
    --include=*.mjs --include=*.ts --include=*.json --include=*.yml --include=*.sh --include=*.md
  ```
- 最近生成：2026-11-18，改动后复核（下表逐条对账，残留检查见「完成前复核」）。

## 目标布局

| 路径 | 装什么 |
|---|---|
| `.dev/bin/byspace[.exe]`、`.dev/bin/byspace-app[.exe]` | 开发二进制（原 `bin/`） |
| `.dev/build/BySpace.app`、`.dev/build/BySpace Dev.app` | 中间 app bundle |
| `.dev/build/{BySpace.iconset,dmg}` | make app/dmg 的临时目录（原 `build/darwin/` 下） |
| `.dev/test-results/` | Playwright e2e 与 perf 输出（原 `web/test-results/`） |
| `.dev/vitest/{screenshots,attachments}` | vitest browser 失败证据（原 `web/.vitest-*`） |
| `dist/` | 只有对外发布物：zip、dmg、exe、apk、CLI、SHA256SUMS、npm tarball |
| 不动 | `internal/webui/dist`（go:embed）、`packages/*/dist`（npm exports）、`web/dist`（wrangler assets + vite 默认）、`workers/relay/build`（wrangler main）、`build/android/{app/build,.gradle,jniLibs}`（gradle 固定布局，APK 中间副本留在这里）、`rsrc_windows_*.syso`（必须与 main.go 同级）、`.wrangler`（工具状态） |

## 覆盖表

| 来源位置与具体项 | 对应行为证明行 | 覆盖状态 | 覆盖依据 |
|---|---|---|---|
| `Makefile:16,17,30,31` BINARY/APP_BINARY | 开发构建产出到新位置 | 已覆盖 | `.dev/bin/byspace[-app][.exe]`；`make build` 从零重建并起 daemon 通过 |
| `Makefile:18` BUILD_DIR 新变量 | macOS 分发物落在 dist | 已覆盖 | `.dev/build`，app/dmg 目标共用 |
| `Makefile:44-56` app 目标：bundle 与 iconset | macOS 分发物落在 dist | 已覆盖 | 全部写 `$(BUILD_DIR)`，dist 只收 zip；make dmg exit=0 |
| `Makefile:58-66` dmg 暂存目录 | macOS 分发物落在 dist | 已覆盖 | `$(BUILD_DIR)/dmg`，`build/darwin/` 只剩 Info.plist |
| `Makefile:69-70` apk 二次拷贝 | Android APK 不再产出两份 | 已覆盖 | 删掉 cp，改由 build.sh 直接写 dist |
| `Makefile:121-125` clean 的 bin 路径 | 清理入口覆盖全部产物 | 已覆盖 | `rm -rf .dev/bin .dev/build .dev/test-results .dev/vitest rsrc_windows_*.syso dist`，跑过一次并从零重建 |
| `Makefile:72-101` release-cli/windows/linux/checksums | 全平台 CLI 与 checksums | 已覆盖 | 目标仍是 dist/，未改；release-cli + checksums 实跑 10 项校验 OK |
| `build/android/build.sh:36,61` mkdir 与 APK_DST | Android APK 不再产出两份 | 已覆盖 | mkdir dist、APK_DST=dist/byspace-android-arm64.apk |
| `scripts/dev-daemon.mjs:16-21,68,80` | dev daemon 起得来 | 已覆盖 | `.dev/bin`；clean 后不带 SKIP 启动成功 |
| `scripts/dev-cli.mjs:5,14,19` | CLI 仍可用 | 已覆盖 | 改前后 `daemon status` 输出逐字相同 |
| `scripts/dev-desktop.mjs:11-16,56` 二进制与 dev bundle | 开发桌面 bundle 落在 .dev | 已覆盖 | `.dev/bin/byspace-app`、`.dev/build/BySpace Dev.app`；实跑窗口起来 |
| `scripts/deploy-pairing-smoke.mjs:26` | CLI 仍可用 | 已覆盖 | 路径改 `.dev/bin`，未单独跑该脚本（需真实 relay 部署） |
| `web/e2e/support/helpers/daemon-binary.ts:15-20` | 过程证据落在 .dev | 已覆盖 | 解析 `.dev/bin/byspace[.exe]`；playwright 实跑 worker daemon 起来了 |
| `web/e2e/support/helpers/daemon-update.ts:19`、`isolated-host-daemon.ts:39` 注释 | 过程证据落在 .dev | 已覆盖 | 注释同步新路径 |
| `.github/workflows/ci.yml:356,405` 上传与 chmod | CI 与文档路径一致 | 已覆盖 | `.dev/bin/byspace`；本地跑不了 Actions，靠 `make build` 产出同名文件与静态核对 |
| `.github/workflows/ci.yml:427` 失败产物上传 | 过程证据落在 .dev | 已覆盖 | `.dev/test-results/`，与 playwright outputDir 一致 |
| `web/playwright.config.ts:23` outputDir | 过程证据落在 .dev | 已覆盖 | `../.dev/test-results`；失败探针四类证据落在那里 |
| `web/playwright.profile.config.ts:5` outputDir | 过程证据落在 .dev | 已覆盖 | 同上；perf 入口需要跑着的 dev app，未单独跑 |
| `web/vitest.config.ts:64` screenshotDirectory | 过程证据落在 .dev | 已覆盖 | `../.dev/vitest/screenshots`，失败探针截图落在那里 |
| `web/vitest.config.ts:40` attachmentsDir | 过程证据落在 .dev | 已覆盖 | `../.dev/vitest/attachments`，失败探针附件落在那里 |
| `.gitignore:97` 原 `/bin/` | 清理入口覆盖全部产物 | 已覆盖 | 删除该行，`.dev/` 与 `dist/` 已覆盖新根 |
| `.gitignore:99-102` build/ 反包含漏 windows | 清理入口覆盖全部产物 | 已覆盖 | 补 `!/build/windows/`；新建 `build/windows/.artifact-layout-probe` 时 `git check-ignore` exit=1（未被忽略） |
| `AGENTS.md:135`、`docs/development.md:34,309-311`、`docs/ad-hoc-daemon-testing.md:17,21,24,25,46,47,48,56`、`scripts/e2e-relay-client-check.mjs:11-16` 文档路径 | CI 与文档路径一致 | 已覆盖 | 全部改 `.dev/bin/byspace[.exe]`，残留 grep 为空 |
| `docs/development.md#build-outputs` 新增章节、`docs/qa.md:26` | CI 与文档路径一致 | 已覆盖 | 两个产物根与四个例外落文档，QA 截图指向 `.dev/` |
| `byspace.json` worktree setup `make build`、`:16` desktop 服务 | 开发构建产出到新位置 | 已覆盖 | 只调 make 与 dev-desktop.mjs，两者都已改并实跑 |
| `scripts/package-go-release.mjs:169-226` tarball 内 `bin/byspace` | npm 打包路径不变 | 不适用 | tarball 内部布局，与仓库 bin/ 无关；脚本未改 |
| `internal/selfupdate/*`、`web/public/install.*`、`docker/Dockerfile` 的 `~/.local/bin`、`/usr/local/bin` | — | 不适用 | 安装目标路径，不是仓库产物 |
| `.dev/validation/` 空目录无引用 | 清理入口覆盖全部产物 | 已覆盖 | 已 rmdir |
| `screenshots/`、`.playwright-mcp/`、`/artifacts` | 过程证据落在 .dev | 不适用 | 仓库内无写入方；screenshots 是人工 QA 目录（docs/qa.md 已指向 `.dev/`），.playwright-mcp 由外部 MCP 工具决定 |

## 完成前复核

- 残留引用检查：`grep -rn "bin/byspace"`（排除 node_modules、dist、web/dist、internal/webui/dist、bywork/archive、.dev）剩下的全是安装路径（`/usr/local/bin`、`~/.local/bin`、`$bin/byspace`）、shebang 或 `.dev/bin` 自身。
- `git status --short` 只有本次改动的 19 个文件与 `bywork/work/artifact-layout/`，没有新增产物目录。