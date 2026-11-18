---
kind: work
status: in_progress
current_unit: "批次 F：功能归位（utils/hooks/components/stores 平铺搬进功能目录）"
next_action: "先按前缀枚举 core/utils 181 个平铺文件的归属（agent- 14、workspace- 13、sidebar- 11、project- 10、tool-call- 9…），生成 scope.md 逐文件对账，再分批 git mv"
must_hold: "不改既有测试断言；不重启 6777 生产 daemon；每批独立可验证可回滚；shadcn 原件永不 restyle；ui/ 与 platform/ 不许依赖功能目录"
proof_gap: "批次 F 未开工；shadcn 未用的 progress/scroll-area 按 docs/design.md:21 的 vendored 规则不删（npx shadcn add 会重装），与用户「一起清掉」的字面要求有偏差，已在对话说明；shortcut/text-input 同理不删（一个是 Kbd 薄封装、一个是 DOM-owned 编辑器），已改文档承认；两个既有坏测（file-explorer-context-actions.spec.ts:474、settings-navigation.spec.ts:74）基线已证明与本次无关，按既有测试只读不修；.oxlintrc.json 的 raw-query burn-down 规则早已丢失，补回会暴露 23 处既有违规，已置 off 并留 shortcut 注释"
---

# 源码布局根治：一棵树、一个 alias、三种目录角色

## 目标与边界

用户要求（m00606）：「产物干净了吗？干净了接下来来看整个仓库布局（源码布局）」。

澄清回答（m00989）：五个层全做（陈旧配置、生成物守卫、消双树重复、功能归位、合并单 alias）；对 core 命名与重复取舍两次都说「按最优雅、根治的方案处理」，并明确「我不太了解前端」——即由我定技术终态，不要把选择权推回去；shadcn 未清项「一起清掉」。

产物收拢（`bywork/work/artifact-layout/`）已完成待提交，与本 work 无依赖。

## 已定方案：终态

```
web/src/
  main.tsx  index.css  env.d.ts
  ui/          shadcn 原件（npx shadcn add 的落点），永不 restyle
  platform/    RN/Expo API 的网页替身
  <feature>/   其余全部，一个功能一个目录
```

`@/` → `web/src/`，`~/` 删除，`core/` 这一层消失。

**为什么 core 必须消失**：`~/`→`web/src`、`@/`→`web/src/core` 是 2026-11-03 合并的残留（`bywork/archive/v1/epics/2026-10-31-x-web-frontend-rewrite/issues/2026-11-02-x-switch.md:71`：`packages/app/src` + `web/src/overrides` 合成 core，当时只处理了 `lib/overlay-root.ts` 一个重名）。分界「移植来的 vs 外壳」已失效：core 里 620 处 `from "~/..."`，shell 里 240 处 `from "@/..."`。core 现在不代表边界，只代表「曾经从别处搬来」。

**三种角色的规则可机械检查**（oxlint `no-restricted-imports`，不靠文档自觉）：
- `ui/` 只许 import npm 包与 `ui/` 自身。现状已满足（48 文件零功能依赖），唯一例外 `~/hooks/use-mobile` 要一起搬进 `ui/`。
- `platform/` 只许 import npm 包、`ui/`、其他 platform。例外：`theme-object.ts` 与 `color-scheme.ts` 依赖 `@/hooks/use-settings` + `@/styles/theme`——它们不是纯替身，归功能侧（appearance），留在功能树。
- 功能目录之间自由。

**重复实现的取舍依据**：不是「留哪一侧」，而是「哪份是资产的真源」。勘察发现 `web/src/components/forge-icon.tsx` 的硬编码 SVG path 表与 `core/components/icons/{github,gitlab,gitea,codeberg,forgejo}-icon.tsx` 是同一批 path 字符串的两份拷贝。所以真源是 `icons/`，shell 那份是抄写；`docs/forge-providers.md:38-41` 也规定新 forge 走注册表。

## 批次划分

每批独立验证、独立可回滚。顺序按「风险从低到高、被依赖从少到多」。

| 批 | 内容 | 风险 |
|---|---|---|
| A | 陈旧配置与文档：ci-paths 死路径、gitignore 陈旧行、oxlint/oxfmt/lefthook 三处 ignore 不一致、根 tsconfig、AGENTS 地图与 docs 表、一次性报告归档 | 低（无运行时行为） |
| B | 死代码与零引用：`constants/platform.ts`（isDev，AGENTS 曾推荐但零使用）、`hooks/use-fine-pointer.ts`、`utils/copy-to-clipboard.ts` pass-through（顺带修出真 bug：失败被谎报为已复制）；`lib/utils.ts` 加注释说明它是 shadcn CLI 的 alias 目标；未用的 shadcn 原件按 vendored 规则保留 | 低 |
| C | 生成物漂移守卫：icons、component-sheet、config schema | 中（新增检查） |
| D | 消重复：5 对同职责实现 + 两套断点 + shortcut/text-input | 中（UI 行为） |
| E | 双树合并为单 alias + 三种角色规则落地 | 高（881+329 文件 import 改道） |
| F | 功能归位：utils/hooks/components/stores 平铺搬进功能目录 | 高（数百文件 git mv） |

E 在 F 前：先把 alias 收敛成一个，F 的搬运就只改一种前缀，不必两遍。

## 行为证明

| 行为路径 | 真实入口 | 操作 | 应观察到 | 证据 | 结果 |
|---|---|---|---|---|---|
| CI 契约清单整组通过 | `node --test` 14 个 scripts/*.test.mjs（ci.yml:76-91 的原命令） | 加入三个新守卫后整组跑 | exit=0，全部通过 | C 批 `.dev/ci-contracts-c.log`：tests 82 pass 82 fail 0（A 批为 77/77，`.dev/ci-contracts.log`） | 通过 |
| CI 路由不再指死路径、契约都有人读 | `scripts/repo-config.test.mjs` 前两条 | 先跑见红再修 | 改前 7 处死路径 + 3 个无人读的 contract 报错；改后绿 | `.dev/baseline/repo-config-red.log`（红）→ 7/7 绿 | 通过 |
| 文档里的归档读取命令真能用 | `git show` / `git grep` on tag v0.20.0 | 跑 docs/archive-parity.md 的三条命令 | 都命中真实文件与行 | `git show v0.20.0:packages/server/src/server/persisted-config.ts` 有输出；两条 git grep 命中 agent-manager.ts:3291 与 workspace-service-port-allocator.ts:6 | 通过 |
| AGENTS.md 覆盖每个根目录与每篇 doc | `scripts/repo-config.test.mjs` 第 6 条 | 先跑见红（缺 7 目录 3 文档），补齐后绿；再临时删 assets 行复验 | 缺失时报出具体名字 | 红证：`repo map omits: packages, third_party, workers`（检查过粗，已修）→ 补完后绿；删 assets 行报 `repo map omits: assets` | 通过 |
| pre-commit 钩子不误报也不漏检 | `node_modules/.bin/lefthook run pre-commit --job format --job lint` | 真实暂存区：shadcn 原件 + 新 .mjs | 原件被跳过，.mjs 真交给 oxfmt/oxlint，退出 0 | 只暂存原件时两 job `skip no files for inspection`；加暂存 .mjs 后 `oxfmt --check scripts/repo-config.test.mjs`（1 file）✔️ format ✔️ lint。改前 .mjs 不在 glob 里被静默跳过 | 通过 |
| B 删掉的零引用模块确无引用 | `npm run typecheck` + `npm run lint` + web 构建 | 删 `constants/platform.ts`、`hooks/use-fine-pointer.ts`、`utils/copy-to-clipboard.ts` 后全仓检查 | 0 error，构建成功 | typecheck exit=0；lint `0 warnings and 0 errors`（2083 文件）；`npm run build --workspace=@bytetrue/web` exit=0 | 通过 |
| diff 复制失败不再谎报「已复制」 | 浏览器右键 diff 画布 → Copy（`web/e2e/browser/diff-copy-outcome.spec.ts`） | 屏蔽 `navigator.clipboard` 且让 `execCommand` 返回 false，再复制选区 | 提示 "Unable to copy"，不含 "Copied" | 红：旧实现 `.then(() => toast.copied)` 下该用例失败，`.dev/e2e-copy-red2.log` 记 `unexpected value "Copied Copied"`、`data-type="success"`；绿：改用 `writeText` 返回值后 11/11 通过（`.dev/e2e-copy-green2.log`，含既有 9 个 changes-pane-canvas-selection 用例，断言未改） | 通过 |
| 应用仍能构建并运行 | `npm run build --workspace=@bytetrue/web` + `npm run build:daemon-web-ui` + `make build` + dev daemon | 构建后起 daemon 打开应用 | 构建成功，首屏正常，`audit:browser` 11/11 | E 批全链跑通：web 构建 exit=0、webui 重嵌 exit=0、make build exit=0（.dev/bin/byspace 31583666 字节）、dev daemon listening 6779、`audit:browser` **11/11**（`.dev/audit-browser-e2.log`） | 通过 |
| 类型与 lint 全绿 | `npm run typecheck` / `npm run lint` / `npm run format` | 全仓检查 | 0 error | A 批：三者 exit=0（2086 文件）。B 批：三者 exit=0，lint `0 warnings and 0 errors`（2083 文件 177 规则） | 通过 |
| 既有测试不变且通过 | `cd web && npm run test:e2e -- <受影响 spec>` | 跑受影响测试 | 原断言未改且通过 | B 批：`changes-pane-canvas-selection.spec.ts` 9 个用例原文件原断言，全绿（`.dev/e2e-copy-green2.log`） | 通过 |
| 生成物无漂移 | `scripts/generated-assets.test.mjs`（CI 契约组） | 临时改一个源（logo path 的 M561.8→M562.8；sheet src 的 title），再还原 | 漂移时点名 stale 文件，还原后绿 | icons 红证 `.dev/baseline/generated-assets-red.log`（23 个 stale）、sheet 红证 `.dev/baseline/generated-sheet-red.log`；还原后 12/12 绿。当前无漂移：`node scripts/generate-icons.mjs .dev/icon-probe` 23 文件逐字节相同，`python3 design/build-sheet.py .dev/sheet-probe.html` IDENTICAL | 通过 |
| 编辑器不会拒绝 daemon 真读的设置 | `scripts/config-schema.test.mjs` | 用 daemon 自己的 reloadable/environment-owned 路径逐条比对已发布 schema；再 stash 掉修复见红 | 缺 key 时点名，补上后绿 | 首跑抓到 `daemon.tunnel.allowedTargets`（internal/server/tunnels.go:119 读、public-docs/connectivity.md:87 有文档，schema 却因 additionalProperties:false 拒绝）。红证 `.dev/baseline/config-schema-red.log`；补 tunnel.allowedTargets 后绿 | 通过 |
| CI 的 full 门不会被空输出永久打开 | `scripts/repo-config.test.mjs` 第 9 条 | 把 workspace contract 改名成 workspaceX 见红，再还原 | 报出无契约的 filter output | 红证 `.dev/baseline/filter-output-red.log`：`ci.yml reads filter outputs with no contract: workspace`。同时修回 A 批误删的 workspace（package-lock.json 不被 `**/*.{ext}` 匹配），ci.yml:29 的 full 只读它 | 通过 |
| 三种角色规则挡得住违规 | `node --test scripts/web-layout.test.mjs` | 在 ui/ 里临时加一个 import `@/data/query` 的探针文件 | 报出违规文件与 specifier；删掉后绿 | 红证 `.dev/baseline/web-layout-red.log`：`web/src/ui/zz-role-probe.tsx -> @/data/query`；探针删除后绿。oxlint 的 no-restricted-imports 无法表达「除 ui/platform 外全禁」（patterns 只吃正字符串数组，`!` 取反与对象形式实测无效），故改用契约测试；首版用 git ls-files 取文件测不到未跟踪的新违规，已改为遍历工作树 | 通过 |
| 全仓只剩一个 alias | `node --test scripts/web-layout.test.mjs` | 留一个 `~/` specifier 见红；再查 vite/tsconfig/components.json | 报出残留；三处配置一致 | 红证 `.dev/baseline/web-alias-red.log`；components.json 红证 `.dev/baseline/web-shadcn-red.log`。specifier 覆盖率实测 4306 matched / 62 unmatched，62 全是给用户看的 home 路径与文件链接 fixture（`.dev/baseline/specifier-coverage.log`） | 通过 |
| 合并后应用行为不变 | `npm run audit:browser -- --base http://127.0.0.1:6779` + 受影响 spec | 构建 → 重嵌 UI → make build → 起 dev daemon → 真浏览器 | 11/11 一致性检查通过 | `.dev/audit-browser-e2.log` **11/11**（含 sidebar 首屏、provider 目录、思考等级菜单、零协议校验错误）；e2e `.dev/e2e-e1.log` 6/6、`.dev/e2e-e2.log` 18/18、`.dev/e2e-e3.log` 29/30（唯一失败是既有坏测，见下）；单测 `.dev/unit-e1.log` 58/58（含 home 路径 fixture 未被误改） | 通过 |
| 重复消除后 UI 不变 | `cd web && npm run test:e2e -- <受影响 spec>` | 跑覆盖 5 对重复消费者的 spec | 图标/状态点/文件图标/forge 图标/检查状态渲染与改前一致 | D 批 18/19 通过：`.dev/e2e-d1.log` 10/10（workspace-hover-card-agents / sidebar-help / command-center-file-search / sidebar-mobile-menu-sheets）、`.dev/e2e-d2.log` 8/9（explorer-sidebar / new-tab-startup / startup-loading 全绿）。唯一失败是既有坏测，见下 | 通过 |
| 两套断点合一后 sidebar 行为不变 | `cd web && npm run test:e2e -- e2e/browser/sidebar-mobile-menu-sheets.spec.ts` | 窄视口下开 sidebar | 移动端 sheet 行为与改前一致 | `.dev/e2e-d1.log` 该 spec 全绿；`useIsMobile` 现在委托 `useIsCompactFormFactor`，两个阈值（<768 与 <=767.98）合成一个 | 通过 |

## 完成核对

- 行为门：A 批 6 行、B 批 3 行、C 批 3 行、D 批 2 行、E 批 3 行通过；F 未跑
- 范围门：待生成 `scope.md`（F 批必须逐文件枚举）
- 契约门：`audit:browser` 基线 11/11（`.dev/baseline/audit-browser2.log`），E 批复跑同样 **11/11**（`.dev/audit-browser-e2.log`）。CI 契约组 85/85（`.dev/ci-contracts-e.log`）
- 完成门：未达成（F 未开工）
- 需要用户看的推断或无法判定：两个既有坏测与 raw-query 规则丢失，见「本轮之外的发现」

## 本轮之外的发现

- **既有坏测（非本次引入，已用基线证明）**：`web/e2e/browser/file-explorer-context-actions.spec.ts:474` "hides unsupported file operations and revert actions" 失败于 `expect(page.getByTestId("files-new-file")).toHaveCount(0)`（实际 1）。根因：今天更早的 commit `c7a0e4e92`「refactor: remove dead packages, provider quota, and version-drift compat」删掉了 `packages/protocol/src/messages.ts` 里三个 COMPAT gate（`fsEntryOps`、`fsEntryDuplicate`、`checkoutDiscardChanges`），但该 spec 仍 mock 这三个 feature 为 false 并断言 UI 隐藏。`ServerInfoStatusPayloadSchema.features` 是封闭 `z.object`，未知 key 被剥掉，所以 mock 根本到不了应用；`web/src` 里也已无任何读取点（只剩 `actions-store.ts:352` 无条件调用）。**基线证明**：`git stash` 掉本次全部改动、重建 web、用 `BYSPACE_E2E_DAEMON_BINARY=.dev/bin/byspace` 跑同一 spec → 同样 1 failed 5 passed、同一断言同一行（`.dev/e2e-baseline-explorer2.log`）；改动恢复后同样结果（`.dev/e2e-d3.log`）。按「既有测试只读」不修，留给用户决定是删该用例还是改断言。
  - 死路：第一次跑基线忘了 stash 会把 Makefile 也退回 `bin/byspace`，6 个用例全失败于 `Error: Go daemon binary not found at .../bin/byspace`（`.dev/e2e-baseline-explorer.log`）——那不是有效基线，必须用 `BYSPACE_E2E_DAEMON_BINARY` 指向仍在的 `.dev/bin/byspace` 重跑。

- **既有坏测 2（非本次引入，已用基线证明）**：`web/e2e/browser/settings-navigation.spec.ts:74` "/h/[serverId]/settings redirects to the host connections section" 失败于 `expectAppRoute`（`web/e2e/support/helpers/route-assertions.ts:8`）：期望 `/settings/hosts/srv_e2e_worker_0/connections`，实到 `/open-project`，10s 超时。**基线证明**：`git stash push --include-untracked` 掉全部改动 → 重建 web → `BYSPACE_E2E_DAEMON_BINARY=.../.dev/bin/byspace` 跑同一 spec → **同样 1 failed 14 passed、同一用例**（`.dev/e2e-baseline-settings.log`）；改动恢复后同样结果（`.dev/e2e-settings-alone.log`）。按「既有测试只读」不修。
  - 该 spec 还打印 React Router 警告：`You rendered descendant <Routes> (or called useRoutes()) at "/" (under <Route path="/">) but the parent route path has no trailing "*"` —— 与「深层路由不再匹配」的症状一致，是这条失败的线索，但修它属独立一次改动。

- **端口 6778 被别的 agent 占着（环境坑，不是缺陷）**：`audit:browser` 首跑 3/6（sidebar 快照 `text: Not found`），根因不是我的改动——`lsof -nP -iTCP:6778 -sTCP:LISTEN` 显示 PID 18224 是 `/Users/zijie/.local/share/opencode/worktree/1c1f53/kind-moon/bin/byspace serve`，另一个 worktree 的 dev daemon（17:51 启动，有未提交改动），serving 它自己的旧 UI。**没有动它**。改用 `BYSPACE_LISTEN=127.0.0.1:6779 npm run dev:daemon` 起自己的，再 `audit:browser -- --base http://127.0.0.1:6779` → 11/11。教训：`npm run cli -- daemon status` 报 stopped 不代表端口空闲，它只认自己 home 的 pid 文件。
- `web/public/schemas/byspace.config.v1.json` 的生成器随 Node daemon 一起消失了（CHANGELOG.md:670 说它「generated from the daemon's own config definition」，归档笔记 002 记的命令是 `npm run --workspace=@bytetrue/server generate:config-schema`）。C 批已定：Go 侧 `internal/store/store.go:1113 LoadDaemonConfig` 读的是无类型 map，没有可生成的定义源，所以它是手工维护的对外契约，用 daemon 自己的设置路径表守住。