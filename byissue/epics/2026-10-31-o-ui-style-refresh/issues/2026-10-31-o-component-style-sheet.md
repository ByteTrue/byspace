---
kind: issue
title: "组件样板页：现状对照 shadcn/ui"
type: feature
created: 2026-10-31
---

# 组件样板页：现状对照 shadcn/ui

## 目标与范围

做一个能在 BySpace 文件面板里直接打开的 HTML 样板页 `design/component-sheet.html`，让用户按编号挑选和修改；定稿后作为本 Epic 的视觉契约。

包含：

- **A 基础设定：** 颜色（浅色、深色）、字体和字号、字重、圆角、阴影、焦点环。
- **B 基础组件：** `components/ui/` 和 `components/headers/` 里所有看得见的控件，每个都列出默认、悬停、按下、焦点、禁用、加载、选中等实际会出现的状态。
- **C 组合部件：** 侧栏、标签栏和顶栏按钮、输入框、消息和工具调用、Markdown 和代码块、设置卡片、文件树、Diff 顶栏、空状态。

不包含：改 app 代码；任何布局变化。

## 约束

- BySpace 的 HTML 预览会拦截外部请求（CSP `default-src 'none'`），样板页必须自包含：字体用系统字体或内嵌的 `data:` 字体，现状截图用 `data:` 图片。
- 每一项左边是现状截图，右边是照 shadcn 源码数值做的浅色和深色；编号固定（A1、B3……），用户按编号反馈。
- 数值出处是 `design/references/shadcn/` 里的主题变量和组件源码快照。

## 验证

- 在开发版 BySpace 的文件面板里实际打开，浅色、深色、悬停、焦点都能看到。
- 用户逐项确认，反馈记在下面的执行记录里。

## 执行记录

### v1（2026-10-31）

- 参照快照：shadcn/ui commit `b8d7baa`，存于 `design/references/shadcn/`（主题变量、八种风格的 `cn-*` 样式、两套组件源码，MIT）。样板页取风格 **nova**（紧凑版的默认风格，按钮 32 / 28 / 24）、底色 **neutral**；每一项的说明里写了对应的 `cn-*` 类，数值都从快照里抄。
- 文件：`design/component-sheet.src.html` 是手写源文件；`python3 design/build-sheet.py` 把字体（Geist、Inter、Geist Mono，woff2）、现状截图（webp）和用到的 Lucide 图标内嵌，生成自包含的 `design/component-sheet.html`（约 340 KB）。素材在 `design/sheet-assets/`。生成文件和素材不参与格式化（`.oxfmtrc.json`），参照快照不参与 lint 和格式化。
- 内容：N1–N4 现状截图（开发版 8081，浅色深色）；A1–A3 基础设定；B1–B9 基础组件及其状态；C1–C7 组合部件。右上角可以切换 Geist、Inter、系统字体对比。
- 没放进来：文件树、Diff 顶栏、终端标签、历史列表行、定时任务卡片、首页入口卡片、新建工作区页、命令面板、通知横幅。
- 验证：按 BySpace 预览的 CSP 和 sandbox 在无头浏览器里渲染 1440 和 760 两种宽度，字体加载、8 张截图都正常，无控制台错误；在开发版 BySpace（6778）的文件面板里打开 `component-sheet.html`，预览正常（面板约 800px 宽时自动变成上下排列）。

### 反馈

（等用户按编号反馈）
