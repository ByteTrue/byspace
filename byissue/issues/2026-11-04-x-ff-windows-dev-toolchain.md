---
kind: issue
title: "Windows 开发工具链修复：audit / spawn npm / make 产物名"
type: ff
created: 2026-11-04
---

# Windows 开发工具链修复：audit / spawn npm / make 产物名

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。

这台 Windows 开发机上，交付自检和桌面 dev 启动链全部跑不通。三处根因，同批修复：

1. **`npm run audit` 四步 0 秒 ENOENT 且摘要误报全绿** — `new URL(import.meta.url).pathname` 在 Windows 给出 `/C:/...`，`ROOT` 指向不存在的目录。同类写法共修 6 处（`scripts/audit.mjs`、`scripts/go-emit-parity.mjs`、`scripts/go-parity-audit.mjs` 的 `ROOT` 与 `isMain`、`scripts/docs-links.test.mjs`、`scripts/go-emit-parity.test.mjs`、`web/src/core/git/forges/index.test.ts`），统一改 `fileURLToPath`。详见 `byissue/notes/2026-11-04-windows-url-pathname-is-not-a-disk-path.md`。
2. **dev 脚本 spawn `npm`** — Windows 上 `npm` 是 `.cmd`：直接 spawn ENOENT，改 `.cmd` 又被 Node 安全策略 EINVAL（ refuse .bat/.cmd without shell）。`scripts/dev-desktop.mjs` 与 `scripts/set-release-version.mjs` 的 npm 调用统一 `shell: process.platform === "win32"`。
3. **`make build-app` 产物名** — `Makefile` 的 `APP_BINARY` 固定 `bin/byspace-app`，Windows 上产出无 `.exe` 文件，`dev-desktop.mjs` 找的是 `byspace-app.exe`。`OS == Windows_NT` 时改用 `bin/byspace-app.exe`。

- 改动：上述 6 个脚本/测试文件 + `Makefile`（另：本机用 winget `ezwinports.make` 装了 GNU Make 4.4.1，环境操作不进仓库）。
- 验证：`npm run audit -- --no-browser` 四步真跑全绿（Go 测试 164s）；`node scripts/dev-desktop.mjs` 完整走通 web 构建 → `make build-app` → 桌面窗口（Wails v3.0.0 / WebView2 156）。
- byissue：`notes/` 新增 pathname 坑一篇；无 spec 变动。
