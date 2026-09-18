---
kind: issue
title: "全仓 Paseo 命名迁移"
type: chore
status: open
created: 2026-09-17
---

# 全仓 Paseo 命名迁移

> **读者：** 跨会话接手的人——「改什么、按什么顺序、哪几处不能碰」。
> **目标：** 仓库里凡指代本项目自身的 `paseo` 一律换成 `byspace`；只剩 README 的 fork 声明与两类不可改项。
> **别碰：** LICENSE 的上游著作权行、CHANGELOG 里指向上游 PR 的链接。
> **验证：** 每批 `npm run typecheck` + `npm run lint`；包作用域与 wire 改名另跑全量构建 + 一次真实 daemon/客户端联调。

---

## 前提（Owner 已定，不再复议）

**本项目只有 Owner 一人使用，不需要任何向后兼容，存量数据可全部丢弃。** 因此：

- 不做迁移、不做双读、不留 COMPAT 别名、不收 capability gate。
- 旧客户端、旧 localStorage、旧磁盘命名空间、旧 `paseo.json`、旧 hook——全部不需要能读。
- 唯一的对外声明是 README 的「fork 自 Paseo」，其余品牌痕迹全清。

这条前提让「wire/RPC 名、存储键、环境变量」从**禁区**变成**普通改名**。它们此前被列为禁区是因为要兼容外部客户端，那个理由已不存在。

## 做成以后是什么样

`rg -i paseo` 的结果只剩三类：README 的 fork 声明、LICENSE 的上游著作权、CHANGELOG 的上游 PR 链接。其余全无。

## 不能改的两项（与兼容无关）

1. **LICENSE 的上游著作权行**（`Copyright (c) 2025-present Mohamed Boudra`）。Apache-2.0 §4 要求派生分发保留上游著作权声明。**只能追加自己的，不能替换**。README 的 fork 声明是补充，不是替代。
2. **CHANGELOG 里 `github.com/getpaseo/paseo/pull/NNNN` 链接（793 处）**。这些指向真实存在的上游 PR。改成 byspace 的地址会变成指向不存在内容的假链接。这些链接是**事实引用**，不是品牌。

其余一切照改，包括此前被列为"契约"的全部内容。

## 分批

顺序有理由：A 最小、可立即验证；B 是最大宗；C 必须与客户端/daemon 同批发布；D 是收尾。

### A 批 — 文档、配置、脚本自指

- `docs/`（17 文件 129 处）、`public-docs/`（18 文件 110 处）：把「BySpace 自己是怎样」的陈述里的 Paseo 换成 BySpace。
- `README.md` 及各语言版：清掉 Paseo 品牌段，**新增 fork 声明**；`packages/desktop`、`packages/website` 等不存在的 workspace 行一并删。
- 脚本与 CI 自指：`scripts/`（19 文件 122 处）、`.github/`（5 文件 48 处），如 `paseo-terminal-bench` 产物名。
- server 侧非契约的用户可见文案：`opencode/bridge.ts:152,205,209` 的 `"…not bound to a Paseo agent"`、`"Paseo tools are disabled…"`。这些不经过改名层，是真正会漏给用户的品牌。
- 根目录未纳入 git 的残留：`skills-lock.json`（引用的 `skills/cs` 不存在）删除。`context.md` 已在 041 删除。

### B 批 — 标识符与包作用域（最大宗）

- **B1. `@getpaseo/*` → `@bytetrue/*`**：945 处 import、631 文件，外加 7 个 `package.json`、`knip.json`、2 处 vitest alias、`package-lock.json`、`scripts/package-bytetrue-baseline.mjs:77-86` 的包名断言、`.github/workflows/npm-release.yml:111` 的 npmrc 行与 `:105` 的 `bin.paseo` 断言。
- **B2. 标识符**：`paseoHome` → `byspaceHome`（2184 处）、`isPaseoOwnedWorktree`（1327）、`PaseoToolCatalog`、`createPaseoWorktree`、`PaseoConfigRaw`、`readPaseoWorktreeMetadata` 等。文件名同样处理：`paseo-home.ts`、`paseo-env.ts`、`paseo-config-file.ts`、`paseo-tools.ts`、`paseo-worktree-service.ts`。
- **B3. 用户可见的 i18n 源文案**：231 处，9 种语言。改完后**删除** `packages/app/src/i18n/branding.ts` 的运行时改名层与 `i18n/i18next.ts:23-31` 的调用，以及 `branding.test.ts`。该层存在的唯一理由就是"上游文案 + 运行时改名"，源文案改掉后它成为空操作。

  注意该层只匹配大写 `Paseo` / `PASEO_`；`branding.test.ts` 第二个用例之所以通过，是因为 `hub.paseo.sh`、`.paseo/workflows` 都是小写。删它没有兼容损失（前提已确认），但要注意别在删之前依赖它的行为。

### C 批 — wire / 存储 / 环境变量（必须同批）

**这一批不能拆开发布**：daemon 与客户端必须一次改完，否则自己连不上自己。因为没有旧客户端，所以无需过渡期，只需同一个 commit。

- wire RPC type 字面量（6 个）：`create_paseo_worktree_request/response`、`paseo_worktree_archive_*`、`paseo_worktree_list_*`（`protocol/src/messages.ts`）。
- MCP 工具名前缀 `mcp__paseo__*` 与 MCP server 名 `"paseo"`（`runtime-mcp-config.ts:3`）。改后需重启 daemon 并重新安装 hook。
- WS 认证方案 `paseo.bearer.<token>`（`server/auth.ts:71,84`）。
- supervisor IPC 类型（6 个）：`paseo:ready/shutdown/restart/graceful-shutdown/supervisor-heartbeat/global`（`daemon-worker.ts`）。
- 磁盘命名空间：`gitDir/paseo/worktree.json`（`utils/worktree-metadata.ts:163`）、`.paseo-managed-files.json`、`.paseo-skills-*`、`.paseo-clone-*`、`.paseo-watcher-canary-*`、`.paseo-file-explorer-*`、`.paseo-open-project-*`。**改后旧 worktree 的元数据不可读**——已确认可丢弃。
- 浏览器存储键 `@paseo:*`（12 个：`daemon-registry`、`settings`、`app-settings`、`changes-preferences`、`create-agent-preferences`、`keyboard-shortcut-overrides`、`preferred-editor`、`project-icon-cache`、`replica-cache`、`review-draft-store`、`settings-migrations`、`sidebar-callout-dismissals`）。**改后需重新配对本次会话的所有 host。**
- 环境变量 `PASEO_*`：删除 `utils/byspace-env.ts` 的 `withByspaceEnvironment()` 镜像层及其在 `server/config.ts:562` 的调用。同时改 `agent-hooks/agent-hook-installer.ts:143,151` 读的 `PASEO_TERMINAL_ID` / `PASEO_HOOK_CLI`，以及 `terminal-manager.ts:341-342` 的赋值。
- 项目配置文件 `paseo.json`：删除 `LEGACY_PASEO_CONFIG_FILE_NAME` 及冲突检测（`utils/paseo-config-file.ts:25-34,61-64`），只保留 `byspace.json`。
- `.paseo` 从 `directory-suggestions.ts:110` 的忽略名单移除或改名。

### D 批 — 收尾核对

- 全仓 `rg -i paseo` 只剩三类（见上）。
- `docs/glossary.md:5` 的 keep-list 改写成最终现实：只保留 README fork 声明与 LICENSE 著作权。
- `byissue/vision/index.md:53` 的「持续同步」改为已确认的独立边界（025 第 147 行预告的 graduation，依据 `cb2804084`）。
- `.agents/skills/upstream-sync/SKILL.md:132` 的 "Never perform a global search-and-replace rebrand" 规则随之作废或改写。该 skill 若不再用，考虑整体退役（上游同步已终止）。
- `AGENTS.md`/`CLAUDE.md` 的 doc 表核对（041 曾顺手发现 4 个不存在文件，现已修，复查一次）。

## 验证

- A 批：`npm run typecheck` + `npm run lint` + `npm run format:check`。
- B1 批：`npm run build:server:clean` + `npm run release:pack:bytetrue`（打包脚本有包名断言）+ `npm ci --dry-run --ignore-scripts`（lockfile 同步）。
- B2/B3 批：全量 `npm run typecheck`；`branding.ts` 删除后确认 i18n 渲染仍为 BySpace。
- C 批：删除 `~/.byspace` 后重新启动 daemon，重新配对，跑一次 agent 创建 + terminal + worktree 创建/归档，确认 hook 重新安装且 terminal 活动状态正常。
- 判据：**以行为正确为准，不以「搜不到 paseo」为准。**

## 风险

- **B1 与 C 批若分开发布，自己会连不上自己。** C 批必须单个 commit。
- **C 批要求丢弃 `~/.byspace`。** 已确认可接受。
- `strip-ansi` → `util.stripVTControlCharacters` 这条**不要顺手做**：仓库钉 Node 22.20.0，两者在该版本不等价（见 `byissue/notes/001`）。与本事项无关。
- 041 关闭时退出的遗留项（`strategy-native.tsx`、`getIsElectron()`、forge 抽象层、`@mattermost/react-native-paste-input`）**不在本事项范围**，见 [041](041-x-over-engineering-audit.md) 文末。

## 执行记录

**2026-09-18，单会话完成。** 前提：Owner 明确「只有我一人使用，不需要任何向后兼容，存量数据可全部丢弃」。

实际完成：

- **A 批**：docs / public-docs / README×4 / 脚本 / CI / docker / skills 自指命名全部改名。根目录 `skills-lock.json` 未处理（未纳入 git，且引用的 `skills/cs` 不存在——属 041 遗留）。
- **B1**：`@getpaseo/*` → `@bytetrue/*`，682 个文件 + 7 个 `package.json` + knip/vitest/打包断言/CI npmrc；`package-lock.json` 重新生成；`node_modules/@bytetrue` 软链重建。
- **B2**：标识符与文件名全量改名。24 个文件名重命名（`paseo-home.ts`→`byspace-home.ts` 等），命名惯例跟随仓库既有先例：PascalCase 用 `BySpace`，camelCase 用小写 `byspace`，SCREAMING 用 `BYSPACE_`。
- **B3**：删除 `i18n/branding.ts` 运行时改名层及其测试；`i18next.ts` 直接挂载资源。
- **C 批**：wire RPC 字面量、MCP 工具名前缀、`paseo.bearer` 握手、supervisor IPC 类型、磁盘命名空间、`@paseo:` 存储键、配置文件名，全部随同批改名。
- **兼容层删除**：`server/src/utils/byspace-env.ts`、`cli/src/utils/byspace-env.ts`（改名后成为自我映射的空操作）及其测试；连带清理 6 处「双名并列」的环境变量赋值与 5 处恒真/恒假判断。
- **`paseo-hardware-keyboard` 与 `paseo-native-trace` 两个原生模块**：查证后前者是真死代码（唯一消费者 `ios-hardware-keyboard-submit.ios.ts` 已被 041 删除），后者是活代码（`performance/native-trace.ts` 通过 `requireOptionalNativeModule` 引用），**只改了后者的目录名、Kotlin 包名与模块名**。前者的处理属 041 范围，未动。

**被误改后已还原**：批量替换误伤了第三方产品的真名与 URL——`hinnes.paseo-vscode`、`gpambrozio/paseo-menubar`、`xpufx/paseo-cross-daemon-comms`、`tiezbro/paseo-agy-acp`、`blockfeed/paseo-selfhosted`、`huangguang1999/paseo-skins`。这些已全部还原。

**改名后前提失效而重写的测试**（4 处）：`config.test.ts` 的「忽略旧 listen 覆盖」与「BYSPACE 优先于别名」、`cli/run.test.ts` 的「优先于 legacy 别名」、`cli/tests/28-*` 的「忽略旧 home/host」、`seed-worktree-dev-state.test.mjs` 的「回退到旧变量」。这些测试原本断言的语义已不存在。

**验证**：`typecheck` 七个 tsconfig 全 0 错误；`lint` 0 warn / 0 error；`format:check` 全绿；`npm ci --dry-run` 确认 lockfile 同步；protocol / server-deps / server 全量构建通过；测试覆盖 protocol、client、app（i18n / performance / terminal / agent-stream / runtime，510+ 通过）、server（terminal / worktree / config）、cli（24 文件 180 通过）；真实 daemon 启动冒烟 + daemon-e2e 通过。

**改动规模**：1373 文件，+12781 / −19295（净 −6514，主要是删掉的兼容层与重复赋值）。

**已知未改（均为受保护的上游引用）**：`getpaseo/paseo`、`getpaseo/paseo-relay`、`github.com/getpaseo/*`、`relay.paseo.sh` / `app.paseo.sh`（测试夹具里的模拟远端）、`paseo.sh`（schema 与文档 URL）、`paseo-vscode` 等第三方产品名。`byissue/` 与 `CHANGELOG.md` 按约定未动。

### 同批完成的 041 遗留项

- **A2 `strategy-native.tsx`（629 行）**：删除。连带把 `platform` 这个已死的维度从 `ResolveStreamRenderStrategyInput`、`BuildAgentStreamRenderModelInput`、测试与调用点全部移除（`isWeb` 导入也随之消失）。
- **B3 `getIsElectron`**：函数本体、`constants/layout.ts` 的 re-export、全部 14 个调用点已删。连带清掉：`open-in-file-manager/menu-item.tsx`（恒 null 组件整文件）、`resolveStartupBlocker` / `StartupBlocker` / `resolveStartupNavigationReady` 整条死状态链、`canOpenInNewWindow` 恒假菜单项、`canBrowse` 恒假字段、两个恒假菜单 prop、两个只为已删 blocker 而存在的 hook。
- **两个窄依赖**：`@mattermost/react-native-paste-input`（+ 407 行 patch + `plugins/with-paste-input.js`）、`react-native-uitextview`。删后实测 `expo export --platform web` exit 0，产物中零命中。
- **`paseo-hardware-keyboard` 原生模块**：确认为真死代码（唯一消费者已被 041 删除），连同 iOS 硬件键盘的 shim → hook → controller 整条链一并删除。
- **`markdown-text-style.ts`**：零消费者（为 iOS UITextView 而生），删除。
- **426 之外的结构性误伤**：三处 `$schema` URL 被改成不存在的 `byspace.config.v1.json`（已改回真实可达的 `paseo.sh/schemas/paseo.config.v1.json`）；`AGENTS.md` 原是指向 `CLAUDE.md` 的符号链接，被替换成实体文件（已还原）。
- **fixture 一致性破坏**（批量替换把期望值跟着输入一起改了）：`project-display-name`、`host-routes`（base64）、`identity-colors`（哈希）、`navigation-active-workspace-store`（base64）、`directory-suggestions`（排序）——均按原意修正。

### 未做（评估后判定不值得）

- **C3 forge 抽象层**：`register` / `ids` / `has` / 6 个注入 seam 确为测试接缝，但 5 个真实 adapter 正在使用该注册表。删除属纯结构重构、无净删减。
- **E4 client barrel / highlight 导出**：复核后确认都是活 API 面，非死代码。

### 最终验证

`typecheck` / `lint` / `format:check` 全绿；`build:server` 通过；app 543 文件 4747 测试通过；server+protocol+client+cli 122 文件 1513 测试通过；`expo export --platform web` 成功且产物中 `paseo`/`Paseo`/`PASEO`/`getIsElectron` 零命中。

**最终规模**：1406 文件，+12076 / −21226。

## 关闭时

- 回写 glossary 的候选：最终保留清单——本事项主要产出。
- 可能的 note：运行时改名层的大小写隐性契约（若 B3 删除该层，此条仅作历史记录）。
- 遗留：
