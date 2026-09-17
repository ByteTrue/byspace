# 死代码审计的判据与陷阱

> **读者：** 要删除"看起来没人用"的代码的人——先看结论，再看细节里的误报清单。
> **自检：** 一句话结论 · 触发场景 · 细节/步骤/坑 · 相关 issue/spec/代码位置。

---

**结论：** 静态工具（knip / grep）给出的"无人使用"只能当线索，**每一条都必须人工确认所有非静态通道**；"两者等价"这类结论必须在**仓库钉定的运行时**上实测，不能用开发机默认版本；而且**本地全绿不等于可交付**——依赖类改动只有 `npm ci` 才会暴露同步问题。

**何时用：** 做死代码/依赖清理、退役面残留审计、或替换依赖（标准库替代第三方）时。

**细节：**

1. **`knip` 在本仓库的已知误报类别**（每一种都实际踩过）：

   | 类别                         | 实例                                      | 为什么漏                                                        |
   | ---------------------------- | ----------------------------------------- | --------------------------------------------------------------- |
   | Worker URL 动态加载          | `terminal/terminal-worker-process.ts`     | `new URL("./x.ts", currentUrl)`，非 import                      |
   | 子进程按路径 spawn           | `test-utils/outdated-daemon-process.ts`   | 被 `packages/app/e2e/support/helpers/daemon-update.ts` 按路径起 |
   | 跨 workspace `createRequire` | `packages/relay` 的 `wrangler`            | 被 app 的 e2e helper 从 relay 的 node_modules 解析              |
   | 按路径读取的非模块文件       | `protocol/codegen/ws-outbound.compile.ts` | 被 `generate-validation-aot.mjs` 用字符串路径读                 |
   | 被脚本/CI 编译               | `client/examples/*.ts`                    | `typecheck:examples` 挂在 CI 上                                 |
   | 同名私有方法干扰             | `getProviderIds`                          | 类里有同名私有方法                                              |

2. **两个 typecheck 盲区**，`import type` 指向已删除模块时可以完全静默存活：
   - 测试文件被排除在 typecheck 之外（`tsconfig.server.json` 的 `exclude` 含 `src/**/*.test.ts`）。
   - `scripts/` 几乎没有 tsconfig 覆盖（`tsconfig.scripts.json` 的 `include` 只有少数几个文件）。

   `import type` 在运行期被擦除，所以 vitest 也不会报错。`daemon-session.test.ts` 里指向已删除 hub 模块的引用就是这样存活了一整个退役周期的。**发现这类问题的可靠手段是 knip，不是 typecheck。**

3. **无后缀文件可能是 TypeScript 的解析入口，不是重复文件。** app 的 tsconfig 没有 `moduleSuffixes`，所以 `runtime/replica-cache/row-store-factory.ts`（与 `.web` 变体逐字节相同）是 TS 的解析目标；删掉它 typecheck 立即报 `TS2307`。看似重复，实为必需。

4. **替换依赖时必须确认"等价"是在钉定的运行时上成立的。** 仓库把 Node 钉在 22.20.0（`.tool-versions`、CI、`docker/base/Dockerfile`），而开发机默认常是 24。
   - `strip-ansi@7` → `util.stripVTControlCharacters` 在 Node 22 上**不等价**：Node 22 的内部实现不认冒号分隔的 CSI 参数（`\u001b[38:2:255:0:0m` 会残留成 `:2:255:0:0m`），Node 24 才对齐。
   - 验证方式：`~/.local/share/mise/installs/node/22.20.0/bin/node <script>`，或在 mise 环境里跑。

   推论：**回退一个依赖替换，不能只改 `package.json` 和 import——lockfile 必须一起回同步。** 见第 7 条。

5. **改完 `package.json` 必须同步 lockfile，而本地没有任何门禁会替你发现这件事。**
   - `lefthook` 的 pre-commit 只跑 lint / format / typecheck。`typecheck` 能过，是因为 `node_modules` 里本来就有那个包；`package-lock.json` 在 lefthook 里只被列在 format 的 `exclude`，没有任何校验。
   - CI 的那个 `Lint lockfile` 步骤（`npx lockfile-lint --validate-https --validate-integrity`）**只查 host / https / integrity，不查与 package.json 是否同步**。真正拒绝的是 `npm ci` 本身。
   - 后果：`package.json` 需要 `strip-ansi@^7.1.2` 而 lockfile 里没有对应条目时，本地全绿，但 CI 每一个 job 都在 "Install dependencies" 挂掉，报 `EUSAGE: can only install packages when your package.json and package-lock.json are in sync` + `Missing: <pkg>@<ver> from lock file`。
   - **本地自查方式（已验证有效）**：

     ```bash
     npm ci --dry-run --ignore-scripts
     ```

     注意：`--dry-run` 确实会做同步校验（实测同步时报 exit 1 并列出 Missing 项），但**它不会修复**。修复用 `npm install --package-lock-only`。

   - **什么时候必须跑：** 任何手改 `package.json` 依赖、删除依赖、或回退依赖替换之后。

6. **`knip` 在 Expo 项目上会崩溃**（`app.config.js` 里函数形式的插件让它在 `getPackageNameFromModuleSpecifier` 抛 `specifier.charCodeAt is not a function`）。绕过方式：

   ```bash
   node -e "const c=require('./knip.json'); c.expo=false; require('fs').writeFileSync('/tmp/knip-noexpo.json',JSON.stringify(c,null,2))"
   npx knip --config /tmp/knip-noexpo.json --workspace packages/<name> --no-progress
   ```

7. **只有通过 tsx 才能跑的脚本不代表它是活的。** `measure-agent-tools-context.ts` 能运行是因为 type-only import 被擦除掩盖了它指向已删模块的事实。判断"脚本是否腐烂"要看 `tsc`，不是看它能否跑出结果。

8. **“本地全绿”不等于可交付，尤其对依赖类改动。** 本轮同一个任务里犯了两个同源错误：等价性测试跑在开发机 Node 24 而不是钉定的 22（第 4 条），以及改了 `package.json` 没同步 lockfile（第 5 条）。两者都只在 CI 暴露。**涉及依赖的改动，推之前至少跑一次 `npm ci --dry-run`。**

**相关：**

- `byissue/issues/041-x-over-engineering-audit.md` — 本轮审计的执行记录与被推翻的条目。
- `byissue/issues/025-o-architecture-retention-audit.md`、`034-x-retirement-residue-audit.md` — 退役面的前两轮。
- 本仓库把 Node 版本钉在 `.tool-versions`；改依赖替换类改动时以此为准。
- 本轮 CI 失败实例：run `35209611531`（`package.json`/lockfile 不同步，22 个 job 全挂）；修复 `bc5c72fc4`。
