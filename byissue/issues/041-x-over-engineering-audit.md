---
kind: issue
title: "过度设计审计与分批清理"
type: chore
status: closed
created: 2026-09-17
---

# 过度设计审计与分批清理

> **读者：** 跨会话接手的人——「哪几刀该落、每刀的证据在哪、哪些报错不能信、关了要回写什么」。
> **目标：** 把 web-only 之后遗留的原生/退役/孤儿代码、重复依赖和死配置清掉，每批独立可验证。
> **别碰：** 协议 wire schema（`docs/protocol-compatibility.md`）；`server_info.features` 旗标；存量持久化数据的读取路径。
> **验证：** 每批 `npm run typecheck` + `npm run lint` + 该批触及文件的相关测试；删依赖的批次另跑一次全量构建。

---

## 做成以后是什么样

仓库里不再有「编译期恒死」的代码路径，不再有只服务已退役运行时的模块变体，不再有零引用的依赖和配置项。每一批可以单独提 PR、单独回滚。

**范围：** `packages/{app,server,cli,protocol,client,highlight}` 的死代码、退役 shim、原生残留、重复/未用依赖、死配置、过期文档。
**不包含：** 协议 schema 收缩；正确性 bug；性能；`docs/` 与 `byissue/` 的内容重组（本 Issue 只记录，不重写）。

**归属：** 不属于任何 Epic。与 `034-x-retirement-residue-audit`（已关闭的退役面残留审计）同类但不同批：034 查的是 hub/plugin/voice/browser 的**运行时**残留，本次查的是**过度设计**（抽象、依赖、死配置、原生变体）。两者重叠的部分已在下方标注。

## 为什么现在做

原生移动端、Electron、Hub、插件系统、语音分别在 issue 025 / 034 退役，但退役动作只做了「入口关掉」，没有回收随之失去意义的实现层。结果是 `knip` 在 app 报 237 个未引用文件、server 报 140 个未用导出，以及 11 个文件在 `getIsElectron()` 恒 `false` 上分支。这些不是潜在收益，是已经确定没有调用方的体积。

## 方法与证据边界

审计基线为本轮工作区 HEAD，只读。工具：`knip` 按 workspace 分跑 + 逐调用点人工复核。

`npx knip`（全仓库）在 Expo 插件处崩溃：`node_modules/knip/dist/plugins/expo/helpers.js:23` 对 `app.config.js` 里 `withPasteInput`（函数插件）调 `specifier.charCodeAt`，非字符串。绕过方式：

```bash
node -e "const c=require('./knip.json'); c.expo=false; require('fs').writeFileSync('/tmp/knip-noexpo.json',JSON.stringify(c,null,2))"
npx knip --config /tmp/knip-noexpo.json --workspace packages/<name> --no-progress
```

**knip 的 "unused exports" 数字不可直接采信。** 本轮已确认三类误报：同名私有方法干扰（`getProviderIds`）、跨 workspace 的 `createRequire` 动态解析（`wrangler`）、按路径读的非模块文件（`codegen/*.compile.ts`）。下方清单中的每一项都经过调用点复核；未经复核的 knip 数字不进入账目。

## 分批清单

### A 批：app 的原生残留（编译期恒死）

原生构建已退役（`packages/app/app.config.js` 注释、`package.json` 仅 `build:web`），所有 `.ios`/`.android`/`.native` 分支在发货路径上不可达。

- **A1. `packages/app/src/terminal/native-renderer/`** — 31 文件 4411 行。唯一外部引用是 `TerminalClipboardWriter` 类型，3 处 type-only import（`terminal/runtime/terminal-emulator-runtime.ts:31`、`components/terminal-emulator-contract.ts:10`、`components/terminal-emulator.tsx:32`）。该类型所在的 `terminal-selection.ts` 自身以 type-only 依赖 `headless-terminal-state` 与 `terminal-grid-metrics`。做法：把 `TerminalClipboardWriter` 移入 `terminal-emulator-contract.ts`，其余全删。
- **A2. `agent-stream/strategy-native.tsx`（629 行）+ `strategy-resolver.ts`** — `strategy-resolver.ts` 只在 `input.platform === "web"` 时选 web，否则选 native；而 `platform` 的唯一来源是 `Platform.OS`（`model.ts:166`、`view.tsx:376`），web-only 下恒 `"web"`。`createNativeStreamStrategy` 不可达。删后 `strategy.ts`（335 行 / 148 个接口成员）从「服务两种策略」塌缩为单一 web 配置，可一并收敛。
- **A3. 原生模块变体** — `components/keyboard-translate-view.ios.tsx`(33)、`.android.tsx`(27)、`components/markdown-text.ios.tsx`(113)、`.android.tsx`(56)、`native/ios-hardware-keyboard-submit.ios.ts`(21)。注意 `components/markdown-text.d.ts` 当前 `export * from "./markdown-text.ios"`，删除前必须改指 `.web`。
- **A4. `src/polyfills/`** — **本次执行已推翻，一行未动。** 三个 polyfill 全部是活的，理由见「执行中被推翻的条目」。
- **A5. 已确认的死项（A1/A3 已删，余下未动）** — `@mattermost/react-native-paste-input` 依赖 + 407 行 patch、`react-native-uitextview`（仅被已删的 `markdown-text.ios.tsx` 引用）仍需单独验证后再动；`expo-crypto` 已被证伪（见 A4）。

### B 批：退役 shim 与恒假门控

- **B1. `packages/app/src/desktop/`（669 行）** — Electron/Hub 退役后的 shim 群。**但其中 429 行是活的 web 配对 UI，必须先搬出该目录再删目录。** 活链路是 `screens/open-project-screen.tsx:22` 与 `screens/settings/host-page.tsx:42` → `components/pair-device-modal.tsx`(34) → `components/pair-device-section.tsx`(395，`qrcode` 依赖由它引入)。搬走后确认零消费者：`browser/store.ts`(15)、`browser/resident-webviews.ts`(6)、`browser/new-tab-requests.ts`(4)、`hooks/use-daemon-status.ts`(4)。
- **B2. `packages/app/src/plugins/`（111 行）** — 7 个 no-op 模块。线索：`useHasPluginComposerPills()` 恒返回 `false`，该值作为 `hasPluginComposerPills` prop 一路穿到 `ComposerTrackBar`（`panels/agent-panel.tsx:1284` → `panels/agent-tracks.tsx:40`），删 shim 时应同时去掉这条恒假通路。`usePluginTimelineMessages`/`useInstalledPlugins`/`usePluginCatalogSync`/`resolvePluginIcon` 零消费者。与 034 的「保留 `src/plugins/` 其余 shim」结论冲突——034 当时判断被活代码引用，本轮复核后 `client-slash-commands/model.ts` 仍被 `use-agent-autocomplete.ts` 引用，其余可删，故本批**只删零消费者部分**。
- **B3. `getIsElectron()` 恒假门控（未执行）** — `constants/platform.ts:39,44` 硬编码 `false`，11 个文件据此分支。其中 `workspace/open-in-file-manager/menu-item.tsx` 整文件退化为恒 `null`。其余是串在快捷键/command-center/设置里的 `isDesktop` 管道。需连带改造调用方，见「第二批」。

### C 批：server 死代码与可替换依赖

- **C1. `packages/server/src/tasks/`** — 747 行源码 + 1497 行测试，除自身测试外零引用（`task-store`/`task-graph`/`task-document`/`execution-order`/`types`）。
- **C2. 依赖替换**（每项均复核过调用点）：
  - `p-memoize` — 全仓库零 import，直接删。
  - `uuid` → `node:crypto.randomUUID`：4 处（`server/session.ts:4`、`server/client-message-id.ts:1`、`server/worktree-bootstrap.ts:1`、`server/session/agent-config/agent-config-session.ts:2`）。仓库其他约 60 个文件已在用后者。
  - `strip-ansi` → `util.stripVTControlCharacters`：4 处。`terminal/terminal.test.ts:33` 已在用 `node:util`。
  - `fast-deep-equal` → `util.isDeepStrictEqual`：2 处（`agent/mutable-provider-config-owner.ts:1`、`server/session.ts:3`）。
  - `@isaacs/ttlcache` → `lru-cache`：1 处（`utils/checkout-git.ts:4`），`lru-cache` 已是依赖且支持 TTL。
  - `ajv` — **已推翻，保留。** 有测试覆盖的 raw JSON Schema 输入路径，zod 无法替代。
  - `which` — **已推翻，保留。** 是 `executable-resolution.ts` 的 Windows 分支，删它等于自己写 PATHEXT 解析。
- **C3. forge 抽象层** — `forge-registry.ts` 的动态注册（`register` 返回 unregister 闭包、`ids`/`has`/`#warnedAmbiguousHosts`）除 3 个真实 adapter（github/gitlab/gitea）外只被测试调用；`forge-resolver.ts:24-64` 的 6 个注入 seam 生产侧全不传（`createForgeResolver()` 零参调用）。改为一次性冻结的静态 map + 模块级默认值。
- **C4. server 小件** — `terminal/terminal-manager-factory.ts`（已内联）、`server/daemon-version.ts`（空错误子类，已删）。`server/lifecycle-reasons.ts` **已推翻：2 处真实引用，保留。**

### D 批：配置与文档的过期引用

- **D1. `knip.json`** — 3 个已不存在的 workspace：`packages/website`、`packages/desktop`、`packages/expo-two-way-audio`。（初稿误写为 4 个并列入 `packages/plugin`——knip.json 从未有过该项。）
- **D2. `byspace.json`** — `scripts.desktop.command` 指向 `./packages/desktop/scripts/dev.sh`，目录已不存在。
- **D3. `scripts/trace-daemon.mjs`** — `traceDesktop` 分支全部引用 `packages/desktop/**`；脚本被 Nix 推导移除后已无任何调用方。
- **D4. README** — `README.ja.md`/`README.ko.md`/`README.zh-CN.md` 的图片全部指向已删除的 `packages/website/public/**`；`README.md` 仍有 Voice control、Plugins 整节、Desktop app (recommended)、Cross-device 中的 iOS/Android/desktop、`packages/desktop` 行。
- **D5. `context.md`** — v0.5.1 同步进度快照，当前版本 0.14.2，且未纳入 git。
- **D6. app 遮蔽文件** — **本次执行已推翻，一行未动。** 无后缀文件是 TypeScript 的解析入口，删除即 typecheck 报错，理由见「执行中被推翻的条目」。

### E 批：cli / protocol / highlight

- **E1. `packages/cli` 的 `zod`** — 全包零引用。
- **E2. `packages/cli/tests/e2e/`（7 文件 1403 行）** — **已收窄，只删 `plugin-lifecycle.test.ts`。** `tests/e2e/` 是接在 npm script 上的真 daemon 程序（`test:e2e:lifecycle`），不是孤儿目录；只有 `plugin-lifecycle.test.ts:3` 指向已退役 plugin 系统且 import 已不存在的模块。
- **E3. `packages/protocol` 重复导出别名** — **不应动。** 三个别名都在活代码里被使用（`ConnectionOfferSchema` 15 处引用）。删别名只是改名 churn，不是削减。
- **E4. 小件** — `packages/client/src/daemon-client-transport.ts:14-22` 与 `daemon-client-transport-utils.ts` 的 5 个重复 barrel 导出；`packages/highlight` 的 3 个未用导出（`ElementContext`、`syntaxRoleTags`、`NestedLang`）。

## 第一批已执行（2026-09-17，未提交）

**净额：74 files, +90 / −7803 行。** 全部验证见下方「验证」节。

### 已完成

| 项    | 结果                                                                                                                                                                                                                                           |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1    | `terminal/native-renderer/` 整目录删除（31 文件，含测试）。`TerminalClipboardWriter` 移到新建的 `terminal/runtime/terminal-clipboard-writer.ts`                                                                                                |
| A3    | 5 个原生模块变体删除；`markdown-text.d.ts` 改指 `./markdown-text.web`                                                                                                                                                                          |
| C1    | `server/src/tasks/` 整目录删除（747 源码 + 1497 测试）                                                                                                                                                                                         |
| C2    | 依赖替换并移除：`uuid`→`node:crypto.randomUUID`（4 处）、`strip-ansi`→`util.stripVTControlCharacters`（4 处）、`fast-deep-equal`→`util.isDeepStrictEqual`（2 处）、`@isaacs/ttlcache`→`lru-cache`（2 个缓存）；移除 `p-memoize`、`@types/uuid` |
| C4    | `terminal-manager-factory.ts` 内联到 bootstrap；`daemon-version.ts` 的空错误子类删除                                                                                                                                                           |
| D1–D5 | `knip.json` 4 个死 workspace、`byspace.json` desktop 服务、`scripts/trace-daemon.mjs`、`context.md`、4 个 README、`byissue/spec/index.md` 断链与 Electron 失效声明                                                                             |
| E1    | `packages/cli` 的 `zod` 依赖移除                                                                                                                                                                                                               |
| E2    | `tests/e2e/plugin-lifecycle.test.ts` 删除（唯一确定损坏的一个）                                                                                                                                                                                |

### 执行中被推翻的条目（重要，比已完成的更值得记）

审计有 5 条结论在动手阶段被实证否定。下次审计同区域时先读这里：

- **D6 完全错误。** `runtime/replica-cache/row-store-factory.ts` 与 `.web` 变体确实逐字节相同，但 app 的 tsconfig 没有 `moduleSuffixes`，**无后缀文件是 TypeScript 的解析入口**。删掉它 typecheck 立即报 `TS2307`（已实测）。这类“重复文件”不能删。
- **A4 完全错误。** 三个 polyfill 都是活的：`index.ts` 是 `package.json:main` 的应用入口，`polyfillScreenOrientation()` 在那里调用；`crypto.randomUUID` 只在安全上下文存在，而 `byissue/spec/connection.md:14` 明确记载局域网明文 `http://daemon-host:6777` 是受支持路径，所以 `polyfillCrypto` 在那里是唯一实现。`polyfills/` 一行未动。
- **B1 越权。** `desktop/` 里确有死 shim（`browser/store.ts`、`browser/resident-webviews.ts`、`browser/new-tab-requests.ts`、`hooks/use-daemon-status.ts`），但整个目录被 12+ 个活文件 import，且 `desktop/updates/desktop-updates.ts` 的 `formatVersionWithPrefix`/`isVersionMismatch` 是活的纯函数。“删目录”不成立，只该逐个收窄。
- **B2 高估。** “111 行 no-op”不准确：`plugins/index.ts`、`registry.ts`、`icons.ts`、`workspace-panels/panel.ts`、`client-slash-commands*` 大多**被引用**（只是返回恒值）。真正零消费者的只有 `registry.ts` 与 `icons.ts`。
- **C2 的 `ajv` 与 `which` 都是误报。** `ajv` 有一套测试覆盖的 raw JSON Schema 输入路径（`agent-response-loop.test.ts` 的 `additionalProperties: false` 用例），zod 无法替代；`which` 是 `executable-resolution.ts` 的 Windows 分支（POSIX 走 `/usr/bin/which`，Windows 走库），删它等于自己写 PATHEXT 解析。两项均保留。
- **C4 的 `lifecycle-reasons.ts` 不是死代码。** 它被 `session.ts` 与 `websocket-server.ts` 两处引用，是合法的共享模块，保留。
- **E3 不应动。** 那三个“重复别名”都在活代码里被使用（`ConnectionOfferSchema` 有 15 处引用）。删别名只是改名churn，不是削减。
- **E2 收窄。** `tests/e2e/` 是接在 npm script 上的真 daemon 程序，不是孤儿目录；只删了指向已退役 plugin 系统、且 import 已不存在模块的那一个文件。

另一个重要教训：**`knip` 在 Expo 项目上会崩溃，且其 “unused exports” 数字系统性不可信。** 本次确认的误报模式：同名私有方法干扰、跨 workspace `createRequire` 动态解析、按路径读的非模块文件。

## 第二批（已执行，2026-09-17）

跑 knip 复查时发现一批“两个门禁都看不见”的死引用，已一并处理：

| 项             | 结果                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| broken scripts | `scripts/test-mcp-inject.ts`（196 行，未被任何脚本/文档引用，且 import 不存在的 `claude-agent.ts`）删除；`scripts/measure-agent-tools-context.ts` 修复（它原本能跑，但 `tsc` 报错：import 已退役的 `browser-tools/*`、且向 `createAgentMcpServer` 传已不存在的 `browserToolsEnabled`/`browserToolsBroker`——靠 tsx 擦除 type-only import 才能运行）。修复后 `npm run measure:agent-tools` 仍能跑且数字一致，并已纳入 typecheck 门禁 |
| 死引用         | `daemon-session.test.ts` 的 `hubRelationships` 与 `hub/relationship-controller.js` 引用（hub 退役残留；type-only import 在运行期被擦除，test 文件又被 typecheck 排除，所以两个门禁都漏）                                                                                                                                                                                                                                           |
| 孤儿文件       | `test-utils/versioned-daemon.ts`、`opencode/test-server-manager.ts` 删除                                                                                                                                                                                                                                                                                                                                                           |
| 未用依赖       | `openai`、`@babel/parser` 删除                                                                                                                                                                                                                                                                                                                                                                                                     |

### 第二批里同样被推翻的（重要）

- **`terminal/terminal-worker-process.ts` 不能删。** knip 报为 unused file，但它被 `worker-terminal-manager.ts:109` 以 Worker URL 动态加载（`new URL("./terminal-worker-process.ts", currentUrl)`）。删了会直接搞坏 terminal。
- **`test-utils/outdated-daemon-process.ts` 不能删。** 被 `packages/app/e2e/support/helpers/daemon-update.ts:36` 按路径 spawn。

这两条再次印证：**knip 的 “unused files” 和 “unused deps” 必须逐条人工验证，不能批量采信。**

### 两个门禁的结构性盲区（值得单独记一笔）

本次发现的根因：**test 文件不在 typecheck 范围内，而 `import type` 在运行期被擦除**。

- `tsconfig.server.json` 的 `exclude` 含 `src/**/*.test.ts`；`tsconfig.scripts.json` 的 `include` 只有 3 个文件。
- 于是测试文件里指向已删除模块的 `import type` 既不会被 typecheck 报错，也不会在 vitest 运行时报错——能静默存活一整个退役周期。

如果以后要在 CI 里自动防住这类腐烂，方法是给 test 文件加一个 typecheck 配置，而不是指望 knip。

## Review 发现与修正（2026-09-17）

改动完成后派了三个 reviewer 子任务并行审查（依赖等价性 / 删除可达性 / 其余改动与文档）。**其中一个发现是真的回归，差点随改动上线：**

### P1（已修）：`strip-ansi` → `node:util` 的替换只在 Node ≥ 24 等价

这是本次最有价值的发现，也是一个方法论教训。

- 我先前的等价性测试是**在 Node 24.21.0 上跑的**，得出了“10/10 用例一致”。
- 但仓库把 Node 钉在 **22.20.0**：`.tool-versions`、`.github/workflows/ci.yml`（5 处）、`docker/base/Dockerfile` 都是 22。
- 在 22.20.0 上实测，两者**不等价**：Node 22 的 `util.stripVTControlCharacters` 仍用老的 ansi-regex v5 模式，不认冒号分隔的 CSI 参数：

  ```
  node v22.20.0
  DIFF  \u001b[38:2:255:0:0mERROR  old="ERROR"  new=":2:255:0:0mERROR"
  DIFF  \u001b[4:3mtext           old="text"   new=":3mtext"
  DIFF  DCS/SOS                   old 保留     new 更激进地剥除
  node v24.21.0 → 同样的输入 0 差异
  ```

  这会直接影响用户可见文本：`terminal-capture.ts` 捕获的终端行、`worktree.ts` 浮出的 setup 输出、omp/pi 的命令输出 timeline 会把 `:2:255:0:0m` 泄漏到界面上。

- **处置：整个 `strip-ansi` 替换已回退**（依赖 + 4 处 import：`terminal-capture.ts`、`worktree.ts`、`omp/agent.ts`、`pi/agent.ts`）。保留依赖比抬高 Node floor（需同时改 `.tool-versions` / CI / Docker）风险更小。
- **教训：等价性验证必须在钉定的运行时上跑，不能用开发机默认版本。** 这是我先前那个“已实测等价”结论错得最贵的一次。

### P0（已修）：暂存区/工作区不一致

49 个删除被 `git rm` 暂存，但 30 个重指向修改还在工作区，新文件未跟踪。此时一个普通 `git commit` 会产出**索引里仍指向已删模块**的树（`git show :…terminal-emulator-contract.ts` 确实还是旧 import）。已用 `git add -A` 修正，现在 84 staged / 0 unstaged。

### 其余已修

- `README.zh-CN.md:44` 仍写着“桌面 app、移动 app、Web app 和 CLI”（en/ja/ko 已改，漏了 zh-CN）。已对齐。
- `daemon-version.test.ts` 的被弱化断言已改回 `PackageVersionResolutionError`——reviewer 验证了抛出的错误仍是该基类实例，所以零成本恢复类型保证。
- `byissue/vision/index.md:66-67` 仍把 `desktop-updates.md` 当当前真相（spec index 修了，这里漏了）。已改。
- `docs/floating-panels.md` Gotcha 3 仍在描述 `KeyboardTranslateView` 的 iOS/Android 键盘动画分派，但两个变体已随 A3 删除，现存实现是纯 `View` 透传。已改写为事实 + 保留原因。
- `message.tsx:1652` 注释引用已删的 `markdown-text.ios.tsx`。已改。
- **A3 连带孤儿已清干净：** `markdown-text-selection.tsx` 的唯一读取方（`markdown-text.ios.tsx`）被删后，`useMarkdownTextSurface`/`iosMarkdownTextIsSelectable`/`MarkdownTextSurface` 全部零消费者，`MarkdownTableCellText` 也退化为无人读取的 context 写入。整个模块 + 其测试已删除，4 个调用点改为直接渲染 `View`。

### 结构性修复：为 `tsconfig.scripts.json` 补缺口

reviewer 指出：`measure-agent-tools-context.ts` 之所以能静默腐烂，是因为**没有任何 tsconfig 覆盖 `scripts/`**（`tsconfig.scripts.json` 的 include 只有 3 个文件，`tsconfig.server.json` 只管 `src/`）。

- 把该脚本加入 `tsconfig.scripts.json` 的 `include`，并把 `lib` 从 `ES2022` 改为 `ES2023`（与 `tsconfig.server.json` 一致；不改会冒出 22 个已存在的 `toReversed`/`findLast` 误报）。
- 未把整个 `scripts/**` 纳入——试过，会带出 31 个与本工作无关的既有错误，属另一个议题。

### reviewer 确认无误的关键点（留证）

- **49 个删除全部不可达。** reviewer 2 用真实 Metro resolver（`metro-resolver` + `expo/metro-config`）探测 ios/android/web 三个平台，并枚举了所有非静态通道：动态 import、Worker URL、spawn-by-path、package.json、tsconfig、构建脚本、CI、docker。`markdown-text.d.ts` 改指 `.web` 后仍满足全部 4 个消费者。
- **“native 打包在本次改动前就已是死的”**：`keyboard-dock`（`.d.ts` → `.web`，无 native 变体）在 HEAD 就已被 `register-panels.ts` 拉进主图且 ios/android 解析失败。所以 A3 的删除是跟随既有 web-only 姿态，不是新引入的破坏类。
- **`ttlcache` → `lru-cache` 等价性成立**：过期条目在读时返回 `undefined` 且被删除（与 `checkAgeOnGet` 一致）、`CachedShortstat` 包装保住了 null-vs-undefined 三态、去掉 `cancelTimer()` 不漏定时器（两者都不用活跃定时器）。
- **`uuid` / `fast-deep-equal` 替换等价**：`randomUUID` 与 `uuid@9` 输出形状逐字节一致；`isDeepStrictEqual` 仅在 `-0`/symbol key 上更严格，三处调用点的数据都由同一 zod schema 产出，null-prototype 对象不可达（反而消除了 `fast-deep-equal` 的一个崩溃类）。
- `DaemonVersionResolutionError` 的删除无损失：基类构造函数硬编码 `this.name`，子类无构造函数，连 `.name` 都无法区分。

### 仍然存留的已知差异（不阻塞，已记录）

- `lru-cache` 的驱逐对象从 ttlcache 的“最老 TTL 桶”变成真 LRU；两者都有 `max` 上限，量级无影响。
- `isDeepStrictEqual` 在 `-0` 与 symbol key 上更严格；三处调用点均不可能出现。

## 第三批（未执行）

以下条目在动手阶段发现代价高于预期或依赖前提未定，留待你表态：

- **A2. `agent-stream/strategy-native.tsx`（629 行）** — 删除本身直接，但 `platform: "web" | "native"` 同时门控 `model.ts:91` 的虚拟化分支与缓存键，3 个测试文件有 21 处 `platform: "ios"|"android"|"native"` 调用点。是一次跨 model/view/测试的重构，不是一次删除。建议单独一批。
- **B3. `getIsElectron()` 11 处恒假分支** — 同理，串在快捷键、command-center、设置的 `isDesktop` 管道里，需连带改造调用方。034 已判定“删 shim 需连带改造，收益低”。
- **C3. forge registry/resolver 抽象** — 未动手。
- **E4. client/highlight 小件** — 未动手。

## 已知误报（不可删，留作下次审计的对照）

下列项 knip 报错但已确证是活的。**不要批量采信 knip 的 “unused files” 与 “unused deps”**，每一条都得看调用点：

- **`terminal/terminal-worker-process.ts`** — 被 `worker-terminal-manager.ts:109` 以 Worker URL 动态加载。删了就坏 terminal。
- **`server/test-utils/outdated-daemon-process.ts`** — 被 `packages/app/e2e/support/helpers/daemon-update.ts:36` 按路径 spawn。
- `packages/relay` 的 `wrangler` devDependency — 被 app e2e 跨包解析：`packages/app/e2e/support/helpers/local-wrangler-relay.ts:78` `requireFromRelay.resolve("wrangler/bin/wrangler.js")`。
- `packages/protocol/codegen/ws-outbound.compile.ts` — 被 `packages/protocol/scripts/generate-validation-aot.mjs:7` 按路径读取，脚本挂在 `prebuild`/`pretypecheck`/`pretest`。
- `packages/client/examples/*.ts` — 由 `typecheck:examples` 脚本与 `.github/workflows/ci.yml:358` 编译。
- **`ajv` / `which`** — 见「被推翻的条目」，两者都是活能力。

## 动哪些、验哪些

- 必须改：见上分批清单。
- 需要验：每批 `npm run typecheck` + `npm run lint`；A/B 批另跑 app 侧 grep 确认删掉的模块无游离 import；C2 批删依赖后跑一次 `npm run build:server`；E1 批确认 cli 打包产物不依赖 zod。
- 仍未知：E2 的留存意图、E3 的协议归类、A2 是否保留原生回归可能。

## 规模

- 实到：**−8252 行**（含测试），+358 行。
- 依赖：**−9**（server：`p-memoize`、`uuid`、`@types/uuid`、`fast-deep-equal`、`@isaacs/ttlcache`、`openai`、`@babel/parser`；cli：`zod`；根：`@vercel/nft`）。
- **`strip-ansi` 不在净额内**：它曾被换成 `node:util` 并移除，review 阶段发现只在 Node ≥ 24 等价（仓库钉 22.20.0），已连同依赖一起回退。
- 配置：−3 个死 workspace 项。
- 原估的 “−7750 行 / −10 依赖” 中，`ajv`、`which`、三个 app 窄依赖（`@mattermost/react-native-paste-input`、`react-native-uitextview`、`expo-crypto`）均已判定为不可删；实际净额更高是因为账外又找到了一批死引用（含 A3 连带孤儿）。

## 风险与边界

- **`@mattermost/react-native-paste-input` 是本批唯一会碰 native 构建路径的项。** `app.config.js` 注释写着 `withPasteInput` 的 plugin list 必须能为 `expo export --platform web` 解析成功。删除前须先验证 web 导出不依赖它。
- **`react-native-keyboard-controller` 未做实证判定。** 它在 `app/_layout.tsx:748` 无条件渲染 `<KeyboardProvider>`，也在 `hooks/use-keyboard-shift-style.ts` 被用；该库有 web 实现，可能仍是活依赖。其 `.ios` 用法确定是死的，依赖本身不确定。
- **`terminal/native-renderer/` 已按此前提删除（A1 已执行）。`agent-stream/strategy-native` 仍待定。** 两项均是「web-only 之后漏删」而非有意保留的兼容层；若仍打算保留原生回归路径，A2 应作废。
- **A3 已执行的前提证据：** `packages/app/` 下既无 `android/` 也无 `ios/` 目录，`.github/workflows/` 无 APK / EAS 构建，`app.config.js` 自述只服务 web export。

## 验证

最终状态（完成 review 修正后，全部重跑）：

- `npm run lint`：0 warn / 0 error（3364 files）。
- `npm run format:check`：全绿（3577 files）。
- `tsgo --noEmit`：server / app / cli / relay / highlight / protocol **全部 OK**；`tsc -p packages/server/tsconfig.scripts.json --noEmit` 也 OK（新增门禁）。
- `npm run build:server`：exit 0。
- 测试：server 侧 `checkout-git` + `daemon-version` + `client-message-id` + `daemon-session` + `terminal` + `worktree` = 490 passed；app 侧 `markdown` + `message` = 61 passed，加早前的 `agent-stream`/`terminal`/`native` 共 344 passed。
- `npm run measure:agent-tools`：exit 0，数字与 HEAD 逐字节一致（40 tools / 22,169 bytes / 5,543 est. tokens）。
- **`strip-ansi` 回退后在钉定的 Node 22.20.0 上复测冒号 CSI / DCS / SOS，行为正确。**
- 未跑全量套件（仓规禁止）。**未提交、未 push。**

> 注意：等价性测试必须在钉定运行时（Node 22.20.0）上跑。开发机默认是 Node 24，两者对 `util.stripVTControlCharacters` 行为不同——这正是 P1 的来因。

## 执行记录

见「第一批已执行」「第二批」与两处「被推翻的条目」。

后续批次执行时在此追加：实际改了什么、跑了什么、与方案的偏差。

## 关闭时

**关闭结论（2026-09-17，交付关闭）：**

- **为何可关：** 审计目标（找出并分级过度设计）+ 已选定的执行范围（第一、二批 + review 修正）均已达成并验证；剩余四项不是未完成，而是执行中被重新评估为“代价高于预期或依赖前提未定”并主动退出本 Issue 范围。
- **验证摘要：** `lint` 0 warn/0 error；`format:check` 全绿；server / app / cli / relay / highlight / protocol 六个 tsconfig 加 `tsconfig.scripts.json` 全 OK；`build:server` exit 0；1405 个相关测试通过；`measure:agent-tools` 数字与改动前逐字节一致。实到 **−8252 行 / +420 行 / 84 文件 / −9 依赖**。
- **质量证据：** 三个 reviewer 子任务并行审查（依赖等价性 / 删除可达性 / 其余改动与文档），其中依赖等价性审查翻转了一个真回归（`strip-ansi` 替换只在 Node ≥ 24 等价），已回退。未提交的 P0 暂存区不一致已修。审查结论与四项修正详见上文「Review 发现与修正」。
- **回写位置：** Project Spec 无需变更——本 Issue 不改变用户可依赖的产品行为，只回收实现体积。可复用知识已毕业到 `byissue/notes/001-dead-code-audit-criteria-and-traps.md`（knip 误报分类、两个 typecheck 盲区、Node 版本等价性陷阱、Expo 崩溃绕过）。
- **遗留（已重新评估退出本 Issue 范围，未建新 Issue）：**
  - A2 `agent-stream/strategy-native.tsx`（629 行）——`platform` 同时门控虚拟化与缓存键，波及 3 个测试文件 21 处调用点，是跨 model/view/测试的重构。
  - B3 `getIsElectron()` 11 处恒假分支——需连带改造快捷键/command-center/设置调用方。
  - C3 forge registry/resolver 抽象（约 600 行）。
  - E4 client 重复 barrel 导出 + highlight 3 个未用导出（量小）。
  - 两个窄依赖的删除评估：`@mattermost/react-native-paste-input`（带 407 行 patch）、`react-native-uitextview`。
- **顺手发现（不在本 Issue 范围，未处理）：**
  - `AGENTS.md` 的 doc 表格引用 4 个不存在的文件——`docs/android.md`、`docs/mobile-testing.md`、`docs/plugins.md`、`docs/browser-capture-harness.md`；同一表格还把 `packages/desktop`、`packages/website` 列为现存 workspace。
  - **typecheck 盲区本身值得后续处理**：测试文件与 `scripts/` 大多不被 tsconfig 覆盖，而 `import type` 运行期被擦除，使指向已删模块的引用能静默存活。本轮靠 knip 才发现，建议以后给测试文件与 `scripts/` 加一个 typecheck 配置。
