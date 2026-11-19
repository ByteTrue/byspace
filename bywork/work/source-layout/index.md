---
kind: work
status: complete
current_unit: "全部完成（A–F 六批）"
next_action: "无。六批、三件遗留、两件授权修复、sdk/client 烂测试、playwright 8 个既有失败、tunnel 验收全部完成并推送。唯一非代码问题是 CI lint 的 npm 注册表签名故障（rolldown 无公钥），需重跑确认恢复"
must_hold: "不改既有测试断言（例外：用户明确授权的两处——删 file-explorer 失效用例、修 6 个 app-tests 与 connection.test.ts 的 wire 断言）；不重启 6777 生产 daemon；每批独立可验证可回滚；shadcn 原件永不 restyle；ui/ 与 platform/ 不许依赖功能目录"
proof_gap: ""
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
| 两套断点合一后 sidebar 行为不变 | `cd web && npm run test:e2e -- e2e/browser/sidebar-mobile-menu-sheets.spec.ts` | 窄视口下开 sidebar | 移动端 sheet 行为与改前一致 | `.dev/e2e-d1.log` 该 spec 全绿；E 批进一步根治：断点实现搬进 `platform/use-compact-form-factor.ts`，`constants/layout.ts` 只 re-export，`hooks/use-mobile.ts` 删除，ui/ 因此零例外 | 通过 |
| 平铺模块归位后应用行为不变 | `npm run audit:browser -- --base http://127.0.0.1:6779` + 受影响 spec | 277 个模块搬进功能目录后，构建 → 重嵌 → make build → 起 daemon → 真浏览器 | 11/11；既有测试原断言通过 | F 批：`audit:browser` **11/11**（`.dev/audit-browser-f.log`）；e2e `.dev/e2e-f1.log` 11/11、`.dev/e2e-f2.log` 27/28（唯一失败是 E 批已基线证明的既有坏测 settings-navigation.spec.ts:74）；单测 `.dev/unit-f1.log` **297/297**（32 文件，覆盖 sidebar/tool-calls/lib 与两个搬动的 composer 模块） | 通过 |
| 搬运没有留下断链 | `npm run typecheck` + `npm run lint` + 四个契约守卫 | 277 文件 git mv + 320 文件 specifier 重写后全仓检查 | 0 error；burn-down 名单跟着改道 | typecheck exit=0（`.dev/tc-f4.log`）；lint `0 warnings and 0 errors`（2082 文件）；守卫 13/13。过程中 typecheck 抓到 14 处「指向留在原地的兄弟」的相对 import（与 `.dev/probe-f-links.mjs` 预测的 15 处一致），已按真实位置解析修复；`.oxlintrc.json` 的 9 条 burn-down 条目同步改道（否则 6 个 grandfathered 文件脱离豁免名单报错） | 通过 |
| legacy host URL 真能重定向 | `cd web && npm run test:e2e -- e2e/browser/settings-navigation.spec.ts e2e/browser/legacy-host-redirects.spec.ts` | 直接 goto `/h/<serverId>/{settings,open-project,sessions}` | 分别落到 `/settings/hosts/<id>/connections`、`/open-project`、`/sessions` | 补 3 个路由文件前：settings spec 那条失败（实到 `/open-project`），新 spec 2 failed（`.dev/e2e-routes-red.log`）。补后 **22/22 通过**（`.dev/e2e-leftover.log`，含 file-explorer 5 个）。守卫 `scripts/web-routes.test.mjs` 同步见红→绿 | 通过 |
| 路由表漏文件会被挡住 | `node --test scripts/web-routes.test.mjs` | 从 router.tsx 删掉那 3 条 path | 精确报出缺失的 URL | 红证 `.dev/baseline/web-routes-red.log`：`/h/:serverId/{open-project,sessions,settings}` 三条。删行时正则要写自闭合 `<Name />`，第一版 removed 0 是假成功 | 通过 |
| 文档引用的代码路径真实存在 | `node --test scripts/docs-links.test.mjs` | 先跑见红，修完后再插一条假路径复验 | 报出不存在的文件；修完全绿 | 红证 `.dev/baseline/docs-inline-red.log` **17 条**；修完 3/3 通过（`.dev/docs-guard-green.log`）；插入 `internal/server/does-not-exist.go` 精确报该条，还原后绿 | 通过 |

## 完成核对

- 行为门：A 批 6 行、B 批 3 行、C 批 3 行、D 批 2 行、E 批 3 行、F 批 3 行、三件遗留 3 行通过，共 23 行
- 范围门：`scope.md` 432 项——296「已覆盖」（277 首轮 + 19 补漏，搬进功能目录）、136「不适用」（跨域原语，留在 lib/platform/widgets 或原桶）
- 契约门：`audit:browser` 基线 11/11（`.dev/baseline/audit-browser2.log`），E 批 11/11、F 批 11/11、遗留收尾 11/11（`.dev/audit-browser-leftover.log`）。CI 契约组 96/96（`.dev/ci-contracts-leftover.log`，比 F 批多的 2 个来自新守卫 web-routes 与扩过的 docs-links）。`npm run audit -- --no-browser` 四检查全过（`.dev/audit-leftover.log`）
- 完成门：达成。typecheck/lint（2087 文件 0/0）/format 全 exit=0；e2e 22/22（`.dev/e2e-leftover.log`）
- 需要用户看的推断或无法判定：无。两个既有坏测都已结案（一删一修），docs 死引用已修完并被守卫覆盖。用户随后批准的另两件（6 个 app-tests、订阅 RPC）也已完成，见「本轮之外的发现」对应条目

## 批次 F 的归属规则与剩余共享桶

四个类型桶从 432 个平铺文件降到 136（utils 180→48、hooks 89→43、components 134→24、stores 29→21）。判据不是「消费者最多的是谁」——那会把 `device-timezone.ts`（3 行 Intl）判给 screens——而是**这个模块属于哪个领域**：

- 一个明确的功能归属 → 搬进去，去掉与目录重复的前缀（`utils/sidebar-reorder.ts` → `sidebar/reorder.ts`）。
- 浏览器/宿主 API 的替身 → `platform/`（12 个，如 external-links、ime-anchor、wails、web-focus）。
- 与领域无关的通用助手 → `lib/`（time、path、color、exhaustive、latency、use-stable-event…）。
- shadcn 之上的应用自建件 → `widgets/`（26 个，如 adaptive-modal-sheet、info-hover-card、shortcut、material-file-icon）。
- 真正跨域、没有单一主人的（如 `utils/host-routes.ts` 被 14 个目录用、`stores/session-store.ts` 被 27 个用）→ 留在原桶，`scope.md` 记「不适用」并写明理由。**这不是遗漏**。

机械核对：`.dev/probe-f-transitive.mjs` 出传递消费者 → `.dev/plan-f.mjs` 出计划（含碰撞检查）→ `.dev/check-f-roles.mjs` 出角色违规 → `.dev/migrate-f.mjs` 执行 → `.dev/fix-f-relatives.mjs` 修相对链。

**补漏轮（自查抓到探针的盲区）**：首轮 277 个搬完后，`.dev/probe-f-leftover.mjs` 复核发现还有 **12 个模块有单一功能归属**——首轮探针把「只被另一个桶消费」当成了跨域，没有一路走到功能目录。补搬 19 个文件（含测试）：agent-stream 收 8 个模块（fork-menu、message-render-limit、compaction-label、notification-parser、plan-card、use-revealed-text、markdown-parser、message-height-estimate）、data/provider-icon-name、appearance/xterm-theme（消费者是 appearance/terminal-theme 与 panels/terminal-pane，领域是外观不是面板）、sidebar/{archive-navigation,archive-redirect}。补搬后复核 **single feature owner = 0**。
- 验证：typecheck exit=0（两处相对链已修：e2e spec 的 `../../src/components/assistant-message-render-limit`、message-height-estimate.test.ts 的 `./assistant-image-metadata`）、lint 0/0、守卫 17/17、单测 `.dev/unit-f2.log` **240/240**（30 文件）、e2e `.dev/e2e-f3.log` **7/7**（assistant-fork-menu / assistant-message-render-limit / plan-card）与 `.dev/e2e-f4.log` **15/15**、`audit:browser` **11/11**（`.dev/audit-browser-f2.log`）。
- 外部引用同步：docs/agent-stream-performance.md（首轮另有 AGENTS.md 与 7 篇 docs、internal/gui/notify.go、internal/pathutil/equivalence.go、web/public/sw.js、docs/forms.md）。

## 三件遗留（用户批准后已执行）

### 1. file-explorer 坏测 → 删掉失效用例

`c7a0e4e92` 把 feature gate 从 `file-explorer-pane.tsx` 删了却留下对应测试，是那次提交的遗漏。删掉 "hides unsupported file operations and revert actions" 用例、只被它调用的 `hideContextActionCapabilities` helper 和随之无用的 `openChangesPanel` import；500 行 → 443 行，其余 5 个用例原样保留，跑绿（`.dev/e2e-explorer-green.log`）。改断言等于把「永远显示」写成契约，那正是 no-version-drift 要消灭的东西。

### 2. settings 路由 → 补 3 个文件 + 路由对账守卫

`web/src/app/router.tsx` 的契约是「One entry per file in archive/expo-app:packages/app/src/app, same paths」，实测缺 3 个：`h/[serverId]/{settings,open-project,sessions}.tsx`，`/h/<id>/settings` 因此落到 `path: "*"` 再被送去 `/open-project`。三个都补成 `<Redirect>` 薄壳（`useHostRouteServerId` + `Redirect`，照 `h/[serverId]/index.tsx`）。settings 是永久入口；另两个保留原有的 `remove after 2026-12-11` 注释，到期一起删。

根治在 `scripts/web-routes.test.mjs`：从 `git ls-tree archive/expo-app` 枚举路由文件（`_layout.tsx` 是布局组件不算），`[param]`→`:param`、去 `/index`，与 router.tsx + workspace-layer.tsx 的 path 表对账。没有它，下次移植漏文件仍然静默。

### 3. docs 死引用 → 扩现有守卫，而不是手工扫一遍

`scripts/docs-links.test.mjs` 原本只查 markdown 链接 `](path)`，反引号 inline 代码路径完全不查——这就是腐烂能积累的原因。加上 inline 检查后见红 17 条，逐条修：多数指向 Go 已有实现（改路径），两处**机制描述整个失效**（`docs/permissions.md` 的 TS 类型穷举 → 运行时 map + `TestEveryWSRouteIsClassified`；`docs/architecture.md` 的三处列表一致 → 广播只对 `agent_stream` 过滤，其余无条件），`docs/ad-hoc-daemon-testing.md` 从 214 行重写到 77 行（删掉死掉的 Node harness，换成 `newTestServer`）。另有 6 处死命令守卫看不见（不是路径），一并修在 `docs/development.md` 与 `docs/testing.md`。

顺带修好同一守卫里的第二个 test：它扫的是已退役的 `packages/app/src`，`existsSync` 让它一直静默跳过；改指 `web/src` 后真正运行。

### raw-query：不用做

实测推翻了先前的判断。burn-down 机制完好：名单内 `"off"` 就是豁免，移出一个立刻精确报错。只删掉那条误导性 `shortcut:` 注释。

## 推分支后的真实 CI 结果（PR #51）

第一次推送（run 44334220498）暴露了**三个我自己引入的缺陷**，本地全绿但 CI 红：

- **守卫依赖了 `changes` job 没有的 npm 包**。`.github/workflows/ci.yml` 的 `changes` 是路由门，**故意不装依赖**（只有 checkout + setup-node + project-npm --setup-ci），其余 15 个 `scripts/*.test.mjs` 全部只用 `node:` 内建。我写的 `repo-config.test.mjs` import 了 `js-yaml` 与 `picomatch`，CI 报 `ERR_MODULE_NOT_FOUND`。修法：换成两个只读本文用到的 YAML 形状的行读取器（`contracts()` 读 ci-paths 的 `contract:` + `- "glob"`；`hookJobs()` 读 lefthook 的 `- name:` 块）与一个 `covers()` glob 判定（树前缀 `dir/**`、basename 后缀 `*.ext`/`*.{a,b}`、`**/` 任意深度、目录内通配）。
  - `covers()` 第一版漏了 `**/*.gen.ts` 这种前导 `**/`，被自己的守卫抓出来（`lefthook format exclude misses ... ['**/*.gen.ts','**/*.gen.tsx']`），补上任意深度分支后 9/9。
- **`generated-assets.test.mjs` 需要 sharp 与 python3**，同样跑在无依赖的 job 里，报 `Cannot find package 'sharp'`。它与其他守卫不同类：真的要渲染。修法：从 `changes` 移到 **typecheck** job（已 `npm ci`），加一步 `Check generated assets`。
- **docs 守卫误报 gitignore 的生成物**。`docs/protocol-validation.md:22` 明写 `ws-outbound.aot.ts` "is generated runtime code and is gitignored"，本机有该文件所以我这里绿，CI 全新 checkout 没有 → 红。修法：`existsSync` 之外再接受 `git check-ignore -q`（被忽略本身就是它声称的契约）。
  - **验证方式**：把 `git ls-files` 的全部文件 tar 到 `.dev/nodeps-check/`（无 node_modules）、`git init` + commit，删掉那个 .aot.ts 复现 CI 条件 → 3/3 通过；再插入一条假引用 `internal/server/definitely-missing.go` → 精确报错。证明既不误报也没失去防护。

**F 批搬文件改变了目录深度，两个测试的相对路径断了**（CI 才暴露，本地 vitest 跑的是别的文件集）：
- `web/src/push-notifications/service-worker.test.ts:11` 读 `../../../public/sw.js` → 少一层 `core/` 后应为 `../../public/sw.js`（CI 报 `ENOENT ... /home/runner/work/byspace/byspace/public/sw.js`，多跳了一层到仓库外）。
- `web/src/changelog/internal/parse-changelog.test.ts:277` 读 `../../../../../CHANGELOG.md` → `../../../../CHANGELOG.md`。
- 全仓复查：`web/src` 里只有这两处 + `utils/app-version.ts` 的 `../../../package.json`（深度未变，正确）读仓库根文件。修后 `npx vitest run` 这两个文件 **40/40**。

**其余 CI 失败逐条基线证明为既有，非本次引入**（对照 main 的 run 44250065576）：
- `app-tests`：main 6 个 FAIL，我 8 个 → 差的 2 个正是上面两条深度 bug，已修。其余 6 个同名同因，逐条查明见下（当时猜的「packages/client/dist 陈旧」已证伪）。
- `playwright`：我 8 个失败用例，main 11 个，**我的是 main 的真子集**——且 main 多的两条正是我这轮修掉的 `file-explorer-context-actions.spec.ts:474` 与 `settings-navigation.spec.ts:74`。
- `go-tests`：`TestProcessExitFailsTurnAndReleasesRuntime`（`stream_conformance_test.go:617`）本地 `-count=3` 全过；我对 `internal/` 的全部改动只有两处注释路径 + gofmt 对齐（`git diff` 逐行确认），是 flake。main 另一次 run 的 go 失败是另一个用例 `TestSecondMessageAfterTurnCompleted`。

**`format` job 已绿**——gofmt 修复生效。

## 本轮之外的发现

- **CI 在 `origin/main` 上就是红的**：`gh run view 44251677901`（commit d5519d14e，我这四个提交的基点）唯一的 failure 是 **format** job，`gofmt -l main.go internal workers` 报 `internal/server/host_sync_test.go`（末尾多空行）与 `internal/server/ws_git_system.go:393-401`（map 键对齐），都是 `c7a0e4e92` 引入。**根因是 `lefthook.yml` 不跑 gofmt**——AGENTS.md 说 gofmt 是 Go 的格式化器，但没有本地钩子强制它。**已修**：`gofmt -w` 两文件 + lefthook 第四个 job + `scripts/repo-config.test.mjs` 第 9 条守卫（先见红）。提交 e2753c9cc，CI 的 format job 已绿。
- **PR #51 的 CI 剩余失败全部是 main 上既有的**（最终 run 44338444861，对照 main run 44250065576，逐条比对失败集合而非只看红灯）：
  - `app-tests` **6 个，与 main 归一化路径后逐字相同**：`web/src/git/actions-store.test.ts` ×3、`web/src/components/sidebar/sidebar-projection.test.ts` ×2、`web/src/utils/agent-directory-sync.test.ts` ×1。本地 `cd web && npx vitest run <file>` 复现，断言文本与 main CI 一字不差。**六个全部由 `c7a0e4e92` 删 compat 路径但没同步测试造成**，逐条查明：
    - **actions-store ×3**：`web/src/git/actions-store.test.ts:211-222` 仍参数化跑 `checkoutForgeSetAutoMerge` / `checkoutGithubSetAutoMerge` 两条 RPC 并按 feature flag 分支，而该 commit 删了 legacy 方法（`grep -c checkoutGithubSetAutoMerge packages/client/src/daemon-client.ts` = 0）与 gate；生产 `web/src/git/actions-store.ts:285,300` 无条件调 forge 那条。与我删掉的 file-explorer 用例同一根因。
    - **sidebar-projection ×2**：`c7a0e4e92` 给 `createProjectIconTarget` 加了第四个必需条件 `!input.placement.iconRevision`（`web/src/projects/icon-target.ts:21-27`，diff 实证），而测试夹具 `makeProject`（`web/src/components/sidebar/sidebar-projection.test.ts:45-64`）的 host 不带 `iconRevision` → `resolveSidebarProjectIconTargets` 返回 `[]` → `expected [ 'project', 'other-project' ] to deeply equal []`。**探针实证**：给夹具补 `iconRevision: "rev-1"` 后解析器返回 1 个 target、用例通过。生产侧确实供应该字段（`web/src/projects/workspace-structure.ts:200` 从 `project.projectIconRevision` 取），所以是夹具过时，不是产品 bug。
    - **agent-directory-sync ×1**：`c7a0e4e92` 从 `web/src/runtime/directory-sync/internal/agent-store.ts:76` 删掉了 `legacyWorkspaceId` 推断（原本在 `features.workspaceMultiplicity !== true` 时按 `workspace.workspaceDirectory === normalized.cwd` 认领），现在只剩 `normalized.workspaceId ?? previous?.workspaceId`。测试名就叫 "legacy workspace ownership"，断言 `workspaceId: "legacy-workspace"` 实得 `undefined`。
    - **我一度归因为「packages/client/dist 陈旧」，那是猜测，已证伪**——CI 全新构建也红，本地也复现。
    - **用户批准后已修（commit 810b7af2b）**：actions-store 删 legacy GitHub 分支与 feature-gate 用例，改按 `squash`/`merge` 参数化（12→10 用例）；sidebar-projection 夹具补 `iconRevision: \`rev-${viewKey}\``；agent-directory-sync 删掉 cwd 推断夹具，改断言 payload 自带的 workspaceId 与 stale delta 不清空（共享工厂 `createAgentPayload` 未动）。`npx vitest run` 三文件 15 passed + 6 passed。
  - `playwright` **8 个，是 main 11 个的严格子集**；main 多出的 3 个里有 2 个正是本轮修掉的（`file-explorer-context-actions.spec.ts:474`、`settings-navigation.spec.ts:74`）。
  - `go-tests` **已自证是 flake**：首推红 `TestProcessExitFailsTurnAndReleasesRuntime`，第三推红 `TestServerDirectWebSocketAndPiAgentLifecycle`（报错 `testing.go:1619: TempDir RemoveAll cleanup: unlinkat ...: directory not empty`——teardown 竞态，不是断言失败），**第四推（run 44340859384）go-tests 直接绿**，代码只多了一个 docs commit。本地 `-count=3` 一直 exit=0。本 PR 对 `internal/` 的全部改动是两处注释路径 + gofmt 键对齐（7 增 8 删）。
  - **run 44340859384 与 run 44338444861 的 app-tests / playwright 失败集合 `diff` 完全相同**，唯一变化是 go-tests 转绿——证明剩余红灯稳定且与本次改动无关。
  - **提取失败清单的坑**：`grep -oE "spec\.ts:[0-9]+"` 会把 ✓ 通过的用例也算进去（一次得出 184 个「失败」）。必须先按 `✘` 过滤行再抽位置。
- **订阅 RPC 已整条删除（commit e8cb64d27，用户批准后执行）**：原来是 `packages/client/src/daemon-client.ts:3112` 的 `sendEventSubscription` 发 `session.events.set_subscription.request`，Go 侧 handler（原 `internal/server/server.go:1366-1379`）只 `json.Unmarshal` 后原样回显 events，**从不存储**。
  - **删它不丢行为**：真正省流量的是**客户端本地**的 `handleSessionMessage`（daemon-client.ts:5899-5911），只在 `messageHandlers.has(type) || eventListeners.size > 0` 时才 `providerSnapshotUpdates.receive(msg)`，否则直接 return 不去 fetch body。`updateEventSubscriptions` 保留本地副作用 `providerSnapshotUpdates.clear()`。既有测试 `packages/client/src/connection.test.ts:174`（interested listeners only）与 `:359`（unsubscribing discards demand）断言的正是这条本地路径，未改。
  - **response schema 一直是对的**（一度怀疑 Go 发 `payload:{requestId,events}` 而 schema 只要 `{requestId}` 会不匹配）：实测 `validateWSOutboundMessage` 对 Go 的真实形状返回 **true**（zod object 默认剥未知 key）。`.dev/probe-events-response.mjs`。
  - 删除范围：protocol 三个 schema + 两个 union 成员、client 的 `sendEventSubscription` 与 `ConnectionSubscriptions.events`/`setEvents`/`restore()` events 分支、Go 的 handler case 与 `sessionMessageNeedsOrder` 列表项、authz table 两行、`session_dispatch_test.go` 一行、`go-parity-audit.mjs` 的 `INTENTIONALLY_UNSUPPORTED` 排除项（该排除项本身就是证据——理由写着「served by broadcast filtering, not a stored preference」）。connection.test.ts 断言 wire events 数组的那个用例随之删除（9 个其余用例未动）。
  - 验证：typecheck/lint 全 0、`connection.test.ts` 9 passed、`go build ./...` 与 `go test -run 'TestSessionDispatch|TestEveryWSRouteIsClassified'` ok、契约组 **98/98**、`npm run audit -- --no-browser` 四检查全过。
- **`sdk-tests` 的 17 个失败：我的改动让一个从未运行过的 job 第一次运行**（commit 5ebd120cd 修复）。`sdk-tests` 只在 `packages/protocol` 变更时触发，而它在 main 与本分支此前每一次 run 都是 **skipped**（对照 run 44338444861、44250065576、44251677901）。删 RPC 动了 `messages.ts`，job 首次运行，17 个烂测试一次性暴露（`cd packages/protocol && npx vitest run` → 17 failed / 558 passed，9 个文件）。
  - **与 main 逐 key 比对证实全部既有**：`commitsList / fsEntryOps / agentThinkingUpdate / terminalRestoreMode / terminalInputModeReplay / projectUpdate / agentSkillsTargetSelection` 在 `git show origin/main:packages/protocol/src/messages.ts` 与本分支里都是 0 次命中；根因仍是 `c7a0e4e92`（它在 protocol 删了 4819 行，含 `messages.plugins.test.ts` 整个文件，但漏改这批测试）。`ServerInfoStatusPayloadSchema.features` 现在只剩 `webPush / agentRoleNames / daemonTunnels / daemonServiceInstall` 四个 key，封闭 z.object 把其余全剥掉。
  - **处置**：只断言已退役能力的用例删掉（server_info 旧 flag、hello `capabilities`、plugin 时间线条目、legacy `github_search_response` envelope）；仍有意义的断言保留——role catalog 仍可选、timeline replacement 仍不带行、未知 feature key 仍被剥、`collapsed: ["identity"]` 仍能解析。
  - **删 notification 前查过生产路径**：`agent_stream` 的 `attention_required` 事件 schema 里的 `notification` 对象被该 commit 删了，但独立的 `agent_attention_required` 消息仍带它（`packages/protocol/src/messages.ts:4090-4106`），且 `web/src/contexts/session-context.tsx:113-127` 的 `resolveAgentAttentionNotification` 在 `input.notification` 为空时会用 `buildAgentAttentionNotificationPayload` 本地兜底 → 删测试不掩盖功能丢失。
  - 结果 **563 passed / 62 文件**（原 575，净删 12 个用例），lint 0、typecheck 0、契约组 98/98。
  - **同一 job 还跑 `packages/client`，又暴露出 1 个**：`packages/client/src/terminals/index.test.ts`（35 行、仅 1 个用例）断言老 host 会让终端操作在发请求前抛「Update the host」。该 gate 已不存在——整个 `packages/client` 里除这个测试外没有这串字符串。整文件删除（commit 见 `git log` 的 terminal feature-gate 那条），client 套件 **143 passed / 5 文件**。教训：本地只跑 protocol + connection.test.ts 不够，sdk-tests 的实际覆盖面是 protocol + client 两个包。
- **`supportsDesktopPaneSplits()` 恒为 true，背后有一整条死分支**：`web/src/constants/layout.ts:89` 直接 `return true`（自带 shortcut 注释）。`web/src/screens/workspace/workspace-screen.tsx:1493` 的 `canRenderDesktopPaneSplits` 因此恒真，:3354 的 `shouldRenderDesktopPaneFallback` 恒假，:3913-3939 那段 `WorkspaceDesktopTabsRow` 渲染永不执行；`web/src/workspace-tabs/explorer-sidebar.ts:35` 的 `"dock"` 分支同理不可达。另有 4 处 `canRenderDesktopPaneSplits &&` 守卫恒真。删它属于 pane split 的行为改动，注释说「下次改 pane split 时一起删」。
- **v0.26.4 发布验收**（`bywork/work/project-npm/index.md`）：**资产哈希项已结案**——`gh release download v0.26.4` 取全部 19 个资产到 `.dev/release-verify/`，`shasum -a 256 -c SHA256SUMS` 16 个原生资产全 OK，`shasum -a 256 -c BySpace-0.26.4-container.txt.sha256` OK（SHA256SUMS 不含 container 描述符，它有自己的兄弟文件）。原始输出 `.dev/release-verify.log`。**tunnel 空闲稳定性已结案**：后来用本地 relay + 两个 dev daemon 搭出同一条 D2D 路径实测 15 分钟 0 断连，见 `bywork/work/project-npm/index.md` 与 `.dev/tunnel-verify/`。
  - **heartbeat 工具其实可用**——不是 MCP 工具而是 CLI：`byspace heartbeat <create|list|delete>`。之前记的「工具不可用」只是 MCP 侧没有 `create_heartbeat`。但 v0.26.4 已发布完成，**补建 babysit heartbeat 无意义**：它的职责是盯到完成，事后建不产生承诺的行为。
  - 顺带修了 `docs/release.md` 两处与事实矛盾的话（:177 说 npm 发布后进行中、:186-189 要求检查 dist-tags 与 Release 里的 tarball）：**这个包根本没发布**，`npm view bytetrue-byspace` 404，全仓只有 `--dry-run` publish 脚本。
- **端口 6778 被别的 agent 占着（环境坑，不是缺陷）**：`audit:browser` 首跑 3/6（sidebar 快照 `text: Not found`），根因不是我的改动——`lsof -nP -iTCP:6778 -sTCP:LISTEN` 显示 PID 18224 是另一个 worktree 的 dev daemon，serving 它自己的旧 UI。**没有动它**。改用 `BYSPACE_LISTEN=127.0.0.1:6779` 起自己的 → 11/11。教训：`npm run cli -- daemon status` 报 stopped 不代表端口空闲，它只认自己 home 的 pid 文件。
- **既有测试的基线证明法（两次都用过）**：`git stash` 掉本次全部改动、重建 web、用 `BYSPACE_E2E_DAEMON_BINARY=<绝对路径>` 跑同一 spec，看是否同样失败。死路：stash 会把 Makefile 退回 `bin/byspace`（已不存在），6 个用例全失败于 `binary not found`——那不是有效基线。
- `web/public/schemas/byspace.config.v1.json` 的生成器随 Node daemon 一起消失了。C 批已定：Go 侧 `internal/store/store.go:1113 LoadDaemonConfig` 读的是无类型 map，没有可生成的定义源，所以它是手工维护的对外契约，用 daemon 自己的设置路径表守住。
- **`scripts/e2e-runnable.test.mjs` 从来没进过 CI（既有缺口，本轮已补）**：`scripts/*.test.mjs` 磁盘 18 个，CI 只跑 17 个（`changes` 15 + `project-npm` 1 + `typecheck` 的 generated-assets 1），差的正是它。`git log -1` 显示来自 `4f93ce184`（Go 全量移植），`git show origin/main:.github/workflows/ci.yml | grep -c e2e-runnable` = 0。**它不是死代码**：单独跑 8/8 通过，保护的分类器被 `docs/go-parity-audit.md:25,122` 明确推荐（「手工筛这份清单错了两次，每次错都产生约 26 条看起来和真缺陷一样的失败」），分类的 mock provider（`one-minute-stream`）在 e2e 里仍在用。**一度判它是 Node 时代遗物，错了**——那次 grep 漏了 docs。
  - 已修：接进 `changes` job（只用 `node:` 内建，符合该 job 无依赖约束）；并加第 10 条守卫「every repository guard runs in some CI job」——`readdirSync(scripts)` 的 `*.test.mjs` 逐个在 ci.yml 里找。**见红→绿**：撤掉那行 → 精确报 `guards no CI job runs: e2e-runnable.test.mjs`；恢复 → 10/10。契约组总数 97 → **98/98**。
## 收尾轮（2026-11-19）：用户要求「所有失败这次都一起修复掉」

- **sdk-tests 17 个 + client 1 个**：都是 `c7a0e4e92` 删能力后没同步的测试（features 是封闭 z.object，只剩 webPush/agentRoleNames/daemonTunnels/daemonServiceInstall 四个 key，旧 flag 全被剥掉）。按 no-version-drift 删用例或改写为当前契约，不恢复旧行为。提交 5ebd120cd（9 文件 25+/291-）、74f2058e7（删 `packages/client/src/terminals/index.test.ts` 的 old-host gate 用例）。本地 protocol 563 passed、client 143 passed。
- **playwright 8 个既有失败**（提交 e1bfafc6a，6 文件 9+/144-，本地 5 个 spec **62 passed --retries=0**，`.dev/e2e-fix-green.log`）：
  - 4 个 Steer 用例：Steer 已是默认发送行为，重复选中不触发 onValueChange、不写 localStorage，测试 poll 那个 key 到 10s 超时。修为「当前值已是目标值就跳过选择」。
  - `appearance-theme-picker.spec.ts:90`：`contentFontSize` 是独立设置（默认 15），旧断言把它当成跟随 `uiBaseFontSize`。改为断言独立且不受界面字号影响。
  - `agent-message-submission.spec.ts:1341`：老 host 不回显 canonical prompt 的兼容路径已不存在（`untracked` 在 src 零命中），删用例 + `expectOldHostSubmissionBehavior` + gate 的 `stripCanonicalSubmittedPrompts` 全套。
  - `agent-profiles-settings.spec.ts:22`：legacy 收藏迁移已退役，删用例与 helper；`sidebar-workspace.spec.ts:218` 删 `features.workspaceMarkUnread` 断言。
  - `agent-timeline-pagination.spec.ts:271` 本轮复验通过，确认是 flake 而非稳定失败。
- **tunnel 验收**：见 project-npm work，已 complete。
- **CI lint 的 rolldown 签名错误是 npm 注册表侧故障**（`EMISSINGSIGNATUREKEY`），oxlint 本地 0/0；不是本分支能修的，需重跑。
