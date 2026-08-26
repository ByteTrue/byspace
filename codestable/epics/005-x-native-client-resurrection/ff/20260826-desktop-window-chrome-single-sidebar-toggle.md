# Desktop Window Chrome 仅保留内容区侧栏按钮

- 日期：2026-08-26
- 类型：BySpace 产品决策 / 快速修正
- 上游基线：Paseo v0.5.1

## 决策

BySpace 不采用上游在 macOS 窗口左上角同时提供“窗口级侧栏按钮”和“内容 Header 侧栏按钮”的双入口设计：

1. 删除窗口级 `WindowSidebarMenuToggle`，只保留页面内容 Header 中的 `SidebarMenuToggle`。
2. 左侧栏展开时仍由左侧栏拥有 `top-left` Window Chrome，并在功能首行上方预留窗口控制区；红黄绿灯不再覆盖 `BySpace` 首行。
3. 左侧栏收起时，内容区接管 `top-left` Window Chrome；唯一的内容区按钮自动移到红黄绿灯右侧，仍可重新打开侧栏。
4. Settings 继续保持独立 split layout，不渲染外层应用侧栏。

## 实现

- `packages/app/src/app/_layout.tsx`
  - 移除窗口级 `WindowSidebarMenuToggle` 渲染。
  - 保留 sidebar/content 的 Window Chrome corner ownership 切换。
- `packages/app/src/components/left-sidebar.tsx`
  - Desktop 左侧功能首行使用 `WindowChromeSafeArea placement="below"` 下移。
- `packages/app/src/components/headers/screen-header.tsx`
  - 内容 Header 使用 `WindowChromeSafeArea placement="inline"`；侧栏收起后，唯一按钮避开窗口控制区。
- `packages/desktop/scripts/verify-electron-cdp.mjs`
  - 增加展开/收起几何检查、单一可见按钮检查及截图。
  - 支持通过 `ELECTRON_VERIFY_APP_ORIGIN` 验证 packaged `byspace://app` 页面。

## 验证

聚焦测试：

- `desktop-sidebar-layout.test.ts`
- `desktop-sidebar-window-chrome.test.ts`
- `desktop-window.test.ts`

执行前逐一确认三个路径存在；结果：3 files / 10 tests passed。

packaged macOS Electron（2400×1600）：

- 展开：左侧栏首行 `top=53`，红绿灯占用区底部 `y=45`；无重叠。
- 展开：唯一内容区按钮 `left=324`，位于 319px 左侧栏之外。
- 收起：仍只有一个按钮，移动到 `left=82`，避开 `0..78 × 0..45` 红绿灯区域。
- 截图：`/tmp/byspace-sidebar-product-final/expanded.png`、`collapsed.png`。
- 几何结果：`/tmp/byspace-sidebar-product-final/result.json`。

构建与门禁：

- `npm run build:desktop`：通过。
- App Web production export：通过。
- 全 workspace `npm run typecheck`：通过。
- `npm run lint`：0 warnings / 0 errors。
- `npm run format:check`：通过。
- `git diff --check`：通过。

## 非本次范围

完整 CDP verifier 的既有 native fullscreen 检查在当前 dev 与 packaged macOS runtime 中均无法让 Electron 进入 fullscreen；本次范围内的侧栏、Settings 与窗口控制区检查通过。本次没有修改 fullscreen 行为。
