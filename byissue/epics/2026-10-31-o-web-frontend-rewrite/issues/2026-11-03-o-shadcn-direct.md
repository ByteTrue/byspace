---
kind: issue
title: "界面组件直接用 shadcn：自己写的组件换成 shadcn 现成的，删掉自己的代码"
type: refactor
created: 2026-11-03
---

# 界面组件直接用 shadcn：自己写的组件换成 shadcn 现成的，删掉自己的代码

## 目标与范围

用户定的原则（2026-11-03）：shadcn 有的就直接用，尽量不自己写，尽可能减少以后的维护量；不管能不能和原来保持一样，都要换。只有 shadcn 怎么都没有、也完全找不到替代组件的，才保留自己写的。

所以外观和交互跟 shadcn 走，前几步「和旧版逐像素一致」的要求在这里不再适用。用 shadcn 组件时按 shadcn 文档的组合方式在调用处直接写，不再包一层自己的组件；状态色这类业务含义用 `className` 加在 shadcn 组件上。

shadcn 现在还有一整套对话界面组件（Message、Message Scroller、Bubble、Attachment、Trace、Code Block、Marker、Questionnaire）和基于它们的 AI Elements 写法（Chat、Tool、Reasoning、Plan、Queue、Subagent、Terminal、Confirmation、Prompt Input、Model Selector、Context、Checkpoint、File Tree），和 BySpace 的对话界面几乎一一对应，也按这个原则换。

## 对照表

| 现在自己写的                                                                                 | 换成 shadcn                                                           | 批  |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --- |
| 开关 `core/components/ui/switch`                                                             | Switch                                                                | A1  |
| 分段控件 `segmented-control`                                                                 | Tabs                                                                  | A1  |
| 状态徽标 `status-badge`                                                                      | Badge（状态色用 `className`）                                         | A1  |
| 快捷键 `shortcut`（两份）                                                                    | Kbd / KbdGroup                                                        | A1  |
| 加载圈 `loading-spinner`、`synced-loader`                                                    | Spinner                                                               | A1  |
| 提示框 `core/components/ui/alert`、各处提示条                                                | Alert                                                                 | A1  |
| 外链 `external-link`                                                                         | Button `variant="link"`                                               | A1  |
| 输入框 `text-input`、`adaptive-text-input`、`form-field`、`search-field`、设置行里的输入框   | Input / Textarea / InputGroup / Field / Label（手机上保留 44px 高）   | A2  |
| 按钮封装 `core/components/ui/button`、`icon-button-chrome`、`control-geometry`、各种 trigger | Button（variant / size）                                              | A3  |
| 提示 `core/components/ui/tooltip`                                                            | Tooltip                                                               | A3  |
| 弹窗 `adaptive-modal-sheet` 及各个弹窗、确认框                                               | Dialog / Drawer / Sheet / AlertDialog                                 | B   |
| 提示消息 `toast-host`                                                                        | Sonner                                                                | B   |
| 菜单引擎 `menu/`、`adaptive-menu`、`sheet-menu`、`menu-kit`、`snap-drawer`                   | DropdownMenu / ContextMenu                                            | B   |
| 下拉选择 `select-field`                                                                      | Select                                                                | B   |
| 组合框 `combobox`（754 行）                                                                  | Combobox                                                              | B   |
| 命令面板 ⌘K、输入框里的 @ 补全                                                               | Command / CommandDialog                                               | B   |
| 侧栏行、手机侧栏                                                                             | Sidebar（手机上是它自带的 Sheet）                                     | C   |
| 分屏 `split-container`、`resize-handle`                                                      | Resizable                                                             | C   |
| 滚动区 `overlay-scrollbar`、`scrollable-code-surface`、`horizontal-scroll-boundary`          | ScrollArea                                                            | C   |
| 设置卡片和行、提示卡片、空状态、骨架屏                                                       | Item / Card / Separator / Empty / Skeleton                            | C   |
| 折叠区                                                                                       | Collapsible / Accordion                                               | C   |
| 定时任务表格、快捷键列表                                                                     | Table                                                                 | C   |
| 用量条                                                                                       | Progress                                                              | C   |
| 对话时间线 `agent-stream`                                                                    | Chat（Message Scroller）                                              | D   |
| 用户消息、助手回复、图片附件 `message.tsx`                                                   | Message / Bubble / Attachment                                         | D   |
| 工具调用、思考过程、计划、待办、子 agent、终端输出、「Worked for 10s」                       | Trace（Tool / Reasoning / Plan / Queue / Subagent / Terminal / Task） | D   |
| 权限请求                                                                                     | Confirmation                                                          | D   |
| 提问卡片 `question-form-card`                                                                | Questionnaire                                                         | D   |
| 输入框 `composer`                                                                            | Prompt Input                                                          | D   |
| 模型和思考档位选择                                                                           | Model Selector                                                        | D   |
| 上下文用量 `context-window-meter`                                                            | Context                                                               | D   |
| 回退 `rewind`                                                                                | Checkpoint                                                            | D   |
| Markdown 代码块                                                                              | Code Block                                                            | D   |
| 文件树、改动树                                                                               | File Tree                                                             | D   |

保留自己写的（shadcn 没有、也找不到替代）：终端（xterm.js）、文件编辑器（CodeMirror）、Diff 画布、Mermaid 图、Markdown 解析（markdown-it，渲染出来的代码块用 Code Block）、拖拽排序（dnd-kit）、图片缩放查看器、文件拖放、工作区标签栏（能拖动、能关闭，Tabs 做不了）、状态圆点和各种图标。

## 做法

每批：调用处改成直接用 shadcn 组件，删掉自己的组件和只给它用的代码，`npx shadcn add` 补缺的组件；相关单元测试和端到端用例按新组件的结构改；`docs/design.md`、`docs/forms.md`、`docs/menus.md`、`docs/mobile-panels.md` 里讲自己组件的部分改成讲 shadcn 组件或删掉。

## 验证

- 每批：`npm run typecheck`、`npm run lint`、`npm run format:check`，`web/` 单元测试，受影响页面的端到端用例，桌面与手机、浅色与深色截图逐页看过；推 CI，16 个端到端分片全过。
- 全部做完：对照表里「自己写的」一栏的文件都已删除，`rg` 查不到它们的导入。

## 执行记录
