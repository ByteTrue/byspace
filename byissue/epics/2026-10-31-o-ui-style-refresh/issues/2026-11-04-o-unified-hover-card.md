---
kind: issue
title: "悬浮提示统一为一个 hover card 组件"
type: refactor
created: 2026-11-04
---

# 悬浮提示统一为一个 hover card 组件

## 现状与问题

侧栏悬浮内容有两套并存：workspace 行用 Radix `HoverCard`（`web/src/sidebar/workspace-hover-card.tsx`，`docs/hover.md` 点名的正例），项目路径等地方用 shadcn `Tooltip`（`web/src/sidebar/project-block.tsx:123` 的路径、「Switch workspace branch」「Change model」等）。Tooltip 那套是突兀的黑条，和 workspace 的信息卡风格不一致，且两套行为（延迟、宽度、内容形态）各自为政，难维护。

## 目标

1. 一个共享的悬浮组件（以 `workspace-hover-card.tsx` 的 HoverCard 形态为基准：无打开延迟、100ms 关闭宽限、focus 不触发），样式遵循 `docs/design.md`。
2. 全局清扫：把还在用 `Tooltip` 展示内容的调用点捋一遍换成统一组件。纯图标按钮的短文字提示（如工具栏 icon 的名称）是否保留 Tooltip，实现时先盘点再定——判断标准是「内容是否值得一张卡」，不搞一刀切。
3. `docs/hover.md` 的 Floating content 一节随之更新，指向统一组件。

## 范围

- **包含**：`web/src` 内所有 hover 悬浮内容；`web/src/components/with-tooltip.tsx` 的去留。
- **不包含**：`group-hover` 显隐的行内控件（那是 `docs/hover.md` 另一半规则，不是悬浮卡）；菜单、Popover、对话框。

## 验证

侧栏逐行 hover（项目路径卡、workspace 卡、分支/模型选择器）视觉一致；指针在卡与触发器之间移动不闪断；compact 布局不依赖 hover。清单过 `docs/hover.md` 的 checklist。

## 执行记录

（实现时追加）
