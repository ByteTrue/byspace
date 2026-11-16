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

### 2026-11-05 实现与验证

- 新增 `web/src/components/info-hover-card.tsx`，由 `InfoHoverCard`、`InfoHoverCardTrigger`、`InfoHoverCardContent` 组合使用。统一即时打开、100ms 关闭宽限、focus 不打开、compact 不依赖 hover；内容使用 shadcn popover token，默认宽 260px。
- workspace 信息卡、项目路径、分支切换、模型提示、上下文/Provider 用量、diff 文件路径、assistant 文件链接、设置说明、worktree 文档说明、完整连接错误、workspace/agent 标签详情已迁移。标签保留原 `workspace-tab-tooltip-*` 测试锚点，内容模型不变。
- 清扫后保留的 `Tooltip` 只用于按钮/控件的短名称及快捷键，例如新建 workspace、发送、附件、脚本动作、面板切换。`WithTooltip` 保留给这类短标签；菜单、Popover、对话框、行内 `group-hover` 不在本事项内。
- `docs/hover.md` 已写清信息卡与短 Tooltip 的选择规则，以及 compact 的非 hover 路径要求。

验证：

- `web/src/components/info-hover-card.browser.test.tsx`：真实 Chromium 验证 focus 不打开、跨越 portal 空隙不闪断、离开关闭、compact 不弹卡；2 项通过。
- 隔离 Vite + Chromium 使用真实 `InfoHoverCard` 和完整应用 CSS：断言 260px 宽、白色 popover、shadcn 描边环/阴影，且不改变后续布局、不越出 viewport；桌面截图已人工查看。临时服务、文件已清理，未启动 BySpace daemon。
- web 生产构建、全仓 typecheck/lint 通过。

### 2026-11-06 完整应用验收与关闭

- 隔离 dev daemon + Vite 的完整应用中，无头 Chromium 逐项验证项目路径卡、workspace 卡、模型信息卡和 Appearance → Sidebar 设置说明卡。路径卡和设置卡宽 260px、在 viewport 内；项目卡移出后正常关闭，没有 console/page error。设置卡截图已人工查看。
- Chief 不是 git checkout，不显示分支选择器；分支内容仍由同一共享组件承载，其打开/关闭行为由浏览器组件测试覆盖。上下文/Provider 用量需要真实用量状态，未伪造数据；共享组件和调用点类型检查覆盖。
- `npm run audit:browser -- --base http://127.0.0.1:8082`：12/12。`npm run audit -- --no-browser`：Go 测试、入站/出站字段对账、账本检查全部通过。typecheck、lint、format 通过。
- 关闭结论：共享组件、内容选择规则和可达的完整应用场景均已验收，可以交付关闭。长期规则毕业到本 Epic spec 与 `docs/hover.md`；未覆盖的外部数据场景不另造验收结论。
- 引用修复：旧全名检索 0 处，路径改名不影响其他文档。

### 2026-11-06 PR #41 CI 回归修复

- CI run `42179891758` 的第 4、11、13 分片失败后，读取日志与 sidebar drag trace，确认项目路径卡在 pointer capture 拖拽期间覆盖 workspace 行；完整应用还复现 Diff 路径卡遮挡相邻文件行，以及手机宽度下用量卡不可见却发起请求。
- 共享组件现在在鼠标按下和 trigger 真正离开文档时关闭卡片，且不取消原控件的 press/drag；compact 不向调用方报告打开。组合 trigger 在 open 更新时替换 DOM 节点不算卸载。`readOnly` 只读卡及 Radix Popper wrapper 不参与命中测试，明确链接仍可点击；普通路径文本不能为了选择而挡住相邻行。workspace 复制按钮等交互卡不使用该选项。
- `web/src/components/info-hover-card.browser.test.tsx` 加载完整应用 CSS，7 项通过：portal 空隙、wrapper 与相邻行命中、真实 CDP pointer capture drag、press 不取消、trigger 卸载、真实自定义 ContextMenu trigger 组合、compact。打开态断言排除 Radix 关闭动画节点。
- `changes-pane-comparison.spec.ts`、`provider-usage-tooltip.spec.ts`、`sidebar-reorder.spec.ts` 共 9 项通过，其中用量卡改为桌面视口并验证关闭后的不可见状态。web 生产构建、全仓 typecheck、lint、format check 通过。

### 2026-11-06 第二轮 CI 证据与修复

- CI run `42187356716` 新增 file-editing 两项、workspace-agent-tab 一项失败；扩大本地范围后稳定复现。真实自定义 `ContextMenuTrigger` 在 open 更新时替换 DOM，旧实现把 ref 暂时为 null 误当卸载；最小真实组合测试先红后绿，完整 file-editing + agent-tab 19 项通过。
- sidebar drag 的命中日志显示 `elementFromPoint` 命中项目卡文本 `<span>`，workspace pointer down 没有到达 anchor 或 dnd-kit。取消恢复普通文本命中的规则后，完整项目/workspace/pinned 拖拽通过。
- 新 CI 中 sidebar unread 仅首轮失败、重试通过，未归因为 hover 产品回归；扩大本地范围后该文件全部通过。
