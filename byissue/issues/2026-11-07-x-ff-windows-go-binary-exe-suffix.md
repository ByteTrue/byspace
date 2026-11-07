---
type: ff
---

# Windows 上 make build 产出的二进制没有 .exe

## 做了什么

`npm run dev:daemon` 与 `npm run cli` 在 Windows 上直接 exit 1，报 `bin/byspace.exe is missing. Run make build`——即使 make 刚刚成功构建过。原因是 Makefile 只在 Windows 分支给桌面二进制补 `.exe`（`APP_BINARY`），无头的 `BINARY` 不补，Go 就按字面写出 `bin/byspace`；而 Node 的 spawn 走 CreateProcess，对无扩展名文件是**追加** `.exe` 去找，不是原样执行，实测 `execFileSync('.../bin/byspace')` 报 ENOENT。所以脚本查 `.exe` 是对的，缺的是构建产物。现在 Windows 上 `make build` 产出 `bin/byspace.exe`，两个 dev 脚本原样可用。

## 改了哪些

- `Makefile`：`ifeq ($(OS),Windows_NT)` 分支里加 `BINARY := bin/byspace.exe`。`clean` 用 `$(BINARY)`，跟着一起对。
- `web/e2e/browser/workspace-model-restart.spec.ts`：`RESTART_DAEMON_BINARY` 按平台取名（原来硬编码 `bin/byspace`，Linux/macOS 不变）。`BYSPACE_E2E_DAEMON_BINARY` 覆盖照旧。
- 不动：`scripts/dev-cli.mjs`、`scripts/dev-daemon.mjs`、`scripts/dev-desktop.mjs` 的 `.exe` 假设本来就正确；CI 的 `bin/byspace` 产物路径与 `chmod +x` 都在 ubuntu job 上；`scripts/package-go-release.mjs` 的 `bin/byspace` 是 npm 包里的 JS launcher，与构建产物无关。

## 怎么验证的

- `make build` → `-o bin/byspace.exe`，`ls bin` 见 `byspace.exe`。
- `npm run cli -- version` → `0.24.3`（此前同一命令 exit 1）。
- `npm run dev:daemon` 起来并打印 `Binary: ...\bin\byspace.exe`，`netstat` 见 `127.0.0.1:6778 LISTENING`，随后停掉。
- 顺手删掉旧的无扩展名 `bin/byspace`，避免留下过期副本。

## 对 byissue/ 的影响

无影响。

## 顺手发现

`bin/byspace-app`（无扩展名）是 `df5d3a3d1 fix(windows): …` 给 `APP_BINARY` 补后缀之前的产物，已删。`make clean` 不加两个旧名字：Windows 上没有任何 target 再写它们，`/bin/` 本身也在 `.gitignore` 里，只是每台 Windows 机器一次性残留。
