---
kind: decision
title: "先在 Expo 版照 shadcn/ui 改样式，再重写前端"
created: 2026-10-31
superseded-by: ""
---

# 先在 Expo 版照 shadcn/ui 改样式，再重写前端

组件样式以 shadcn/ui 为唯一参照，浅色深色一起改，布局不动；先在现有的 Expo 版（`packages/app`）里落地，不等前端重写。这样美化能尽快看到效果，而重写是更大的独立工程。代价是重写时组件代码要再写一遍，所以样板页和基础设定按 shadcn 的主题变量和组件规格来记录，重写时直接沿用。

## 背景

讨论过程见 [UI 美化 talk](../talks/2026-10-31-ui-style-refresh.md)。之前试过的 Linear 式局部换肤、Claude 暖羊皮纸风格和 impeccable 的选方向流程都没有成立。
