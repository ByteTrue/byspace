# Windows 上 node 脚本用 `new URL(import.meta.url).pathname` 当路径必坏

> **读者：** 半年后搜到这条的人——先看结论，再看何时适用与细节。

---

**结论：** 在 Windows 上给 `fs`/`path`/`spawn cwd` 用的路径必须经 `fileURLToPath(import.meta.url)`；`new URL(import.meta.url).pathname` 产出 `/C:/...`，`path.resolve` 后指向不存在的地方，症状是静默错位而不是报错。

**何时用：** 任何 repo 里的 node 脚本（`scripts/*.mjs`）或 vitest 测试里把当前文件路径转成磁盘路径时。

**细节：** 2026-11-04 修 `npm run audit` 时撞上：`scripts/audit.mjs` 用 pathname 算 `ROOT`，Windows 下 `execFileSync` 的 `cwd` 不存在，四个步骤全部 0.0s 内 ENOENT 失败，且失败输出为空时 Go 测试的摘要还会误报「全部通过」（`summarize` 只数 `--- FAIL:` 行）——结果整体呈「四项 ✘ 但摘要全绿」的自相矛盾输出。同一写法当时共修了 6 处（audit.mjs、go-emit-parity.mjs、go-parity-audit.mjs 的 `ROOT` 与 `isMain`、docs-links.test.mjs、go-emit-parity.test.mjs、web/src/core/git/forges/index.test.ts）。`isMain` 判断同样中招：`process.argv[1]` 是 `C:\...`，pathname 是 `/C:/...`，永不相等。新脚本写这一行时直接抄 `fileURLToPath` 版本；review 时见到 `.pathname` 用于磁盘路径就拦。

**相关：** `scripts/audit.mjs:25`（修后），`scripts/go-parity-audit.mjs`、`scripts/go-emit-parity.mjs` 的 `isMain`；byissue/issues/2026-11-04-x-ff-local-dir-no-auto-setup.md 同日记录。
