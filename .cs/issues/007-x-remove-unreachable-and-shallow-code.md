---
kind: issue
title: "删除仓库中的不可达路径与浅层包装"
type: refactor
status: closed
created: 2026-07-28
epic: ""
---

# 删除仓库中的不可达路径与浅层包装

## 目标

删除 ponytail 全仓审计确认的不可达 Web/Native 分支、零调用文件、无用依赖与只转发模块；BySpace 现有 Web、CLI、daemon、Relay 和协议行为保持不变。

## 范围

- 包含：App Native shimmer 与平台常量残留、死文件、Web locale fallback、字体栈、Changes preferences 单次 wrapper；Client transport barrel；失效 Relay 延迟脚本；未使用的 `p-memoize`。
- 不包含：协议 wire schema、兼容 shim、通过 wildcard export map 暴露的协议子路径、发布安全门禁、仍作为 peer dependency 使用的包、其他未逐项核实的 Knip 报告。

## 归属

- 独立 issue。
- 相关 spec：`.cs/spec/index.md` 的 Web-only 发行边界。

## 当前问题

Web-only 产品仍携带永远不可达的 Native shimmer 和平台选择；仓库中还有零调用源码、失效脚本、未使用依赖与只转发 barrel。这些路径扩大了依赖、构建与理解表面积，但没有当前调用方或受支持运行环境。

## 行为保持

- 必须保持的外部行为：浏览器工具调用 shimmer、locale 选择、字体呈现、Changes preferences 读取、daemon client transport、Terminal/文件传输、CLI/daemon/Relay 行为不变。
- 兼容性边界：不改变 WebSocket schema、binary frame、公开 package exports 或旧 daemon/client 兼容路径。
- 不借重构顺手改变的行为：不清理 Knip 的其他输出，不调整 UI 样式，不重构 transport 实现。

## 现状如何工作

App 编译期平台常量固定为 Web，却仍把 Native shimmer 组件及依赖打进源码；部分模块只有声明没有调用方。Client 通过内部 barrel 再导入 transport 实现；其他候选为零引用脚本、类型或依赖。

## 影响范围

- 必须修改：`packages/app`、`packages/client`、`packages/protocol`、`packages/server`、根 scripts 与 lockfile。
- 需要验证：App shimmer/locale 相关测试、Client transport 测试、全仓 typecheck/lint、Web export。
- 仍待调查：无。

## 质量目标

- 可维护性 / 可分析性与可修改性：
  - 目标：删除无调用方、无运行环境或只增加跳转的代码，所有保留路径都能由当前产品边界或调用方解释。
  - 来源：用户要求与本次 ponytail 审计。
  - 预期证据：调用搜索、Knip 对目标项的复查、diff 独立复核。
- 兼容性 / 共存性与互操作性：
  - 目标：删除仅限内部实现表面积，不改变浏览器可见行为、daemon transport 或协议 wire contract。
  - 来源：project spec 与仓库协议规则。
  - 预期证据：定向测试、全仓 typecheck、Web export。

## 方案判断

直接删除没有真实接缝或运行环境的代码；保留现有 Web CSS shimmer、浏览器 `navigator.languages`、storage pure loader 与各 transport 实现。调用方直接导入 transport 所属模块，不新增替代抽象。依赖通过 workspace package manifest 删除并由 npm 更新 lockfile。

## 实现设计

### 一步步怎么改

1. 收窄 App 到现有 Web 路径，删除 Native shimmer、死文件与无用依赖。
2. 删除内部 barrel、失效脚本与无用 server dependency。
3. 更新 lockfile并格式化。
4. 跑目标测试、全仓 typecheck/lint 与 App Web export。
5. 独立复核行为边界与残留引用，回写执行证据。

### 哪些边界不碰

不修改协议 schema、生成代码、发布流程、Terminal 性能路径或主 daemon。

### 怎么确认做对

目标符号与文件无残留引用；定向测试通过；typecheck/lint/Web export 通过；独立 reviewer 未发现行为回归或误删动态入口。

## 验证

- `npm run test --workspace=@bytetrue/byspace-client -- src/daemon-client-transport.test.ts --bail=1`：1 file / 10 tests 通过，证明 direct imports 未改变 transport 行为。
- `npm run test --workspace=@bytetrue/byspace-app -- src/hooks/use-changes-preferences/storage.test.ts --bail=1`：1 file / 8 tests 通过，证明 pure storage loader 行为不变。
- `npm run test:e2e --workspace=@bytetrue/byspace-app -- tool-call-shimmer.spec.ts --workers=1`：真实浏览器 + 隔离 daemon 场景 1/1 通过，证明 Web shimmer 的 idle → loading 生命周期、动画范围与渲染宽度保持正常。
- `npm run typecheck`：全 workspace 通过。
- `npm run lint`：0 warnings / 0 errors。
- `npm run format:check` 与 `git diff --check`：通过。
- 手工从 `node_modules` 移除三个目标依赖后，`npm ls @react-native-masked-view/masked-view expo-localization p-memoize --all` 为空；随后 `npm run build:web --workspace=@bytetrue/byspace-app` 成功，证明 Web export 不依赖被删包。
- `npm run knip`：仍因仓库既有动态入口/公开导出报告非零；已删除目标均不再出现，unused files 从 19 降至 16，unused dependencies 中不再有 `p-memoize`。`literal-union.ts` 仍被报告，但因协议包 wildcard export map 的公开兼容边界而保留。

## 执行记录

- 2026-07-28：删除 Native shimmer 组件、测量状态与 MaskedView/SVG/Reanimated 专用代码；Web CSS shimmer 直接沿浏览器路径运行。
- 删除 4 个零调用 App 文件、失效 Relay 延迟脚本和内部 transport barrel；Client 改为直接导入所属模块。
- locale 改用 SSR-safe 的 `navigator.languages` / `navigator.language`，字体栈改为浏览器常量，Changes preferences 直接调用 pure storage loader，删除未使用的 `isDev`。
- 从 manifests/lockfile 删除 `@react-native-masked-view/masked-view`、`expo-localization`、`p-memoize` 及其仅有传递依赖；最终实现 diff 为 62 additions / 705 deletions（净减 643 行），未引入新抽象。
- 独立 App reviewer 未发现行为回归；协议 reviewer 发现 `@bytetrue/byspace-protocol/literal-union` 受 `packages/protocol/package.json` wildcard export map 公开，已恢复该文件，避免把“仓内零引用”误当成可破坏公开子路径的证据。
- PR code review 未发现 blocker/high/medium；Ponytail review 进一步内联单次使用的 secondary-label 组件，并删除 Web-only 后等同 `isLoading` 的 `isWebShimmer` 中间状态与逐层转发。
- 与方案无偏差；协议 schema、生成器、发布门禁、Terminal 路径及主 daemon 均未改动。

## 关闭结论

- 判断：目标与范围已达成，可关闭。实现只删除现有 Web-only 产品边界下不可达、零调用或只转发的代码，没有扩展协议、发布、Terminal 或 daemon 行为。
- 可维护性证据：最终实现 diff 为 62 additions / 705 deletions（净减 643 行）；目标依赖和已删除文件不再出现在 Knip 报告中；保留项均有当前产品边界或公开兼容原因。
- 兼容性证据：Client transport 10 项测试、Changes preferences 8 项测试、真实浏览器 shimmer E2E、全仓 typecheck/lint、无目标依赖的 Web export 与独立 review 均通过。协议公开的 `literal-union` 子路径经 review 识别并保留；PR code review 无 blocker/high/medium。
- 遗留事项：无。本 issue 未把仓库既有 Knip 动态入口/公开导出报告纳入范围，也未引入新的待办。

## 关闭回写

- project spec：无需修改；结果落实 `.cs/spec/index.md` 已有的 Web-only 发行边界，没有形成新的产品能力或长期行为。
- notes：无需新增；`literal-union` 的保留理由与验证证据留在本 issue，未形成独立运维流程。
- AGENTS.md / CLAUDE.md / tools：无需修改；现有 Web-only 与协议兼容规则已经覆盖本次取舍。
