---
kind: issue
title: "对齐 macOS 黄金 12px 窗口/卡片曲率、提亮主内容区为纯白并引入全局悬浮层级"
type: ff
status: closed
created: 2026-09-24
---

# 对齐 macOS 黄金 12px 窗口/卡片曲率、提亮主内容区为纯白并引入全局悬浮层级

## 预期与实际

预期：

1. 界面曲率与 macOS 系统原生窗口/卡片曲率自然呼应，内外控件满足同心圆角法则；
2. 主内容区（工作区画布、设置详情页）提一档纯白，与左右浅灰色侧边栏清晰分离；
3. 内容区内的卡片、消息框和输入框采用细腻的环境悬浮阴影（Elevation Shadow）与白底画布形成景深层次。

实际：

1. 此前 4px 过硬，20px 药丸化严重，8px 对大卡片依然生硬；
2. 整个应用（左栏、中间、右栏、设置详情）全都是同一种浅灰色底色（`#f6f7f8`），主次不分；
3. 纯白模式下的阴影此前被完全置空为 transparent，导致内容区毫无悬浮感与层次。

## 根因与决策

1. **曲率与同心律**：
   - 输入框外框设为 **12px**（`theme.borderRadius.lg`），对齐 macOS 窗口标准曲率；
   - 内部紧贴控件（发送键、附件、语音等）设为 **6px**（`theme.borderRadius.base`），满足 $R_{inner} = R_{outer} - \text{Padding}$ 同心平行。
2. **色彩层级分明**：
   - 将 `lightSemanticColors.surface0`（主内容区画布 / `surfaceWorkspace`）提为 **`#ffffff`（纯白）**；
   - 左右侧边栏（`surfaceSidebar`）保持 **`#f6f7f8`（浅灰）**；
   - 修正设置页详情面板（`contentPane` / `detailContainer`）背景色为 `surface0`（纯白），彻底根除全灰面板问题。
3. **全局悬浮层级（White-on-White with Elevation）**：
   - 恢复并微调 `lightShadow`（`sm` / `md` / `lg`）；
   - 为悬浮输入框（Composer `inputWrapper`）、悬浮消息框（`bubble`）、设置卡片（`card`）添加柔和高级的环境微阴影，使纯白卡片在纯白内容区上优雅立体浮现。

## 改了哪些

- `packages/app/src/styles/theme.ts`：
  - 更新 `BORDER_RADIUS`：`base: 6px`, `md: 8px`, `lg: 12px`, `xl: 14px`。
  - `lightSemanticColors`：`surface0` 与 `surfaceDiffEmpty` 更新为 `#ffffff`。
  - 恢复全套 `lightShadow` 层次。
- `packages/app/src/composer/input/input.tsx`：
  - `inputWrapper` 使用 12px 圆角并配置 `...theme.shadow.md` 悬浮阴影。
  - 内部按钮（发送、附件）对齐 6px 同心规范。
- `packages/app/src/composer/index.tsx` & `agent-controls/index.tsx`：
  - 控制按钮统一对齐 6px。
- `packages/app/src/components/message.tsx`：
  - 消息气泡 `bubble` 增加 `...theme.shadow.sm` 悬浮效果。
- `packages/app/src/styles/settings.ts`：
  - 设置卡片 `card` 增加 `...theme.shadow.sm` 悬浮阴影。
- `packages/app/src/screens/settings-screen.tsx`：
  - 设置页详情区域 `contentPane` 和移动端 `detailContainer` 显式应用 `surface0`（纯白背景）。

## 怎么验证的

- 单测回归：`control-geometry.test.ts`、`theme.test.ts`、`layout.test.ts`、`state.test.ts` 全部通过。
- 全量静态检查：`npm run typecheck`、`npm run lint`、`npm run format:check` 全绿（0 error / 0 warning）。

## 对 byissue/ 的影响

无影响。确立了“左右侧边浅灰、中央主区纯白、卡片与输入框悬浮立体、内外控件同心”的现代桌面设计范式。
