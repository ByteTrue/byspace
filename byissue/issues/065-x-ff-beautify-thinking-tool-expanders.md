---
kind: issue
title: 美化 thinking 与工具调用展开块
type: ff
created: 2026-10-09
---

# 美化 thinking 与工具调用展开块

## 做了什么

用户反馈 agent 流里两个展开 UI 丑：Thinking 块和工具调用（如 Codemode）展开后的内容区。具体三点：展开后内部灰色块与纯白背景不协调；header 底部直角遇上 detailWrapper 的圆角嵌套别扭；白底上一片突兀的灰色暗沉色块。明确与内容无关，纯样式/布局问题。

诊断：ExpandableBadge 展开后形成「白底 → surface1 header → 带 border 的 detailWrapper → surface2 + border 的内部代码块」的多层嵌套，灰底灰框层层相套，圆角→直角→圆角矛盾。违背 docs/design.md 的"whitespace is the design"和"Borders group, separate, or rarely emphasize"。

讨论中给出三个方案（A 引导线缩进 / B 统一浅色卡片 / C 完全无装饰），用户选 A：去掉卡片感，用 1px 左引导线 + 缩进表达从属关系，内容直接落在页面背景上。

## 改了哪些

packages/app/src/components/message.tsx（expandableBadgeStylesheet）：

- `detailWrapper`：四边边框 + 底部圆角 + surface1 背景改为仅 `borderLeftWidth: 1`（border 色）+ `marginLeft: 19`（对齐 header icon 中心：pressable padding 8 + icon 半宽 11）+ `paddingLeft: spacing[3]`。
- `pressableExpanded`：去掉 `backgroundColor: surface1`（浅色主题下与白底同色，无意义）。
- `pressableExpandedAttached`：删除（不再需要直角连接 header 与边框盒）。
- `detailWrapperBorderless`：简化为空对象（已无边框可去）。
- `pressableStyle` memo：移除对上述两个已删/置空样式的引用，依赖数组相应收窄。

packages/app/src/components/tool-call-details.tsx（styles）：

- `scrollArea` / `jsonScroll` / `diffContainer`：去掉 `surface2` 灰底 + border + 圆角，内容直接落页面背景。
- `fullBleedBlock`：去掉 `surface1` 背景。
- `jsonScrollError`：去掉红色边框（错误文本自身红色已足够）。
- `scrollText`：颜色 `foreground` → `foregroundMuted`，降低次要内容的视觉重量。

主题适配：浅色与深色（byspace/zinc/midnight/claude/ghostty）均不再引入多余 surface 色块；深色下引导线用 border 色，同样成立。

## 怎么验证的

- `npm run typecheck` 全绿（拉取 main 后 server 包曾报 `@bytetrue/protocol/tool-call-category` 声明过期，`npm run build:server` 重建后消除）。
- `npm run lint -- packages/app/src/components/message.tsx packages/app/src/components/tool-call-details.tsx`：0 warnings 0 errors。
- 用户真机验收通过（m00165："看上去非常非常棒，验收通过"）。

## 对 byissue/ 的影响

- 无 spec 更新：视觉样式可从代码直接重建，不满足 spec 准入判据。
- 无 notes：无仓库外部事实或平台坑点（诊断、方案对比、用户审美判断都在本 issue 和对话里）。
