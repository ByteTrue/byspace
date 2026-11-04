---
kind: issue
title: 桌面端顶栏、侧栏性能、弹窗与通知
status: fixed
created: 2026-11-04
closed: 2026-11-04
epic: 2026-10-31-o-web-frontend-rewrite
commits: [ad0b1c04d, 493aeaaff, 90dc664ab, 0e1ac92f8, dabfd4373]
---

# 桌面端顶栏、侧栏性能、弹窗与通知

用户在 macOS 开发版桌面窗口上反馈的 7 项，一次性快改。都在 `main`，CI 通过（`0e1ac92f8`），`npm run audit` 全过。

## 各项

1. **顶部一行不整齐**：红绿灯原来按「窗口顶边往下 36px」居中，而换成 shadcn 后外壳的顶行是「离顶边 8px 起、高 36px」。`internal/gui/titlebar_darwin.go` 改按外壳的行居中；外壳的顶行合成一个组件 `SidebarTopBar`（`web/src/core/components/sidebar/sidebar-header-row.tsx`），各页标题、侧栏开关、设置的 Back 共用，正文标题按基线对齐（`items-baseline`）。
2. **收起侧栏时正文标题压住红绿灯**：正文头部的开关按钮补上给红绿灯留的位置，展开时正文头部不再画这个按钮（避免两个按钮挤着）。
3. **拖侧栏和收起展开卡**：三处原因。拖动时把 `--sidebar-width` 写在 provider 上会让整个应用每帧重算样式，改成只写在 shadcn 自己按宽度布局的两个元素上、每帧一次；指针事件不标记已处理会让 react-resizable-panels 每次移动都做命中测试（读布局），改为标记；侧栏收起时取消目录订阅、展开时重新订阅并重拉，改为保持订阅，路由页面 memo 化。测量：Chromium 4 倍 CPU 限速下拖动一程超过 20ms 的帧由 42 降到 1，WebKit 由 95 降到 0。
4. **⌘K 面板太小**：宽度 `sm:max-w-2xl`，列表限高加大，搜索框占满一行，文件搜索的转圈浮在输入框右端。
5. **输入框灰色**：不是 bug，是 shadcn InputGroup 的规则——里面任何控件 disabled 就整组变灰，这里发送按钮在空输入时是 disabled。在这一个外框上取消这条规则。
6. **确认弹窗**：桌面端原来调 Wails 原生 `MessageDialog`。改为所有平台都用页内 shadcn `AlertDialog`，删掉 `/_byspace/desktop/confirm` 与没人用的 window-action 端点，最后一处 `window.alert` 换成 toast。规则写进 `docs/design.md`。
7. **通知**：三层原因叠加，一次修完。
   - Go daemon 从来没发过 `agent_attention_required`（或旧的 `attention_required` 流事件），也没记录 `client_heartbeat`，所以客户端的 `shouldNotify` 永远是 false。照 Node 的 `websocket-server.ts broadcastAgentAttention` 补上（`internal/server/agent_attention_broadcast.go`）：记录每个连接的心跳，presence 策略选最近活跃的那个客户端弹通知，可见客户端正在看这个 agent 时不弹，没人在场才走 Web Push。
   - 桌面端用 `window.Notification`，但 WKWebView 里它不起作用。改为桌面端经 `/_byspace/desktop/notify` 交给 Wails 的 notifications 服务（macOS 通知中心、Windows toast、Linux freedesktop），点击通知聚焦窗口并打开对应 agent；轻量模式释放了窗口时直接加载那条路由。
   - 通知服务要 bundle 签名才工作。`scripts/dev-desktop.mjs` 现在把二进制装进签名的 `BySpace Dev.app`（独立 bundle id `com.bytetrue.byspace.dev`）再启动，脚本原本删 `CFBundleURLTypes` 的正则还漏掉了嵌套数组，一起修好。启动时就申请通知权限，而不是等第一个 agent 结束。

## 途中发现并修掉

- **daemon 只在「没人正在看」时给 agent 打 finished 标记**（`attentionIsFocused` 的门槛），而 Node 每次 running→idle 都打标记、由客户端清掉。接通心跳后这个门槛会让看完就走的 agent 没有可清的标记，CI 上 `sidebar-workspace-mark-unread` 两条失败。改回 Node 行为，Go 测试与相关 52 条 e2e 通过（`0e1ac92f8`）。
- **audit 的两处判据过时**：工作区行换成 shadcn 的链接后还按 button 找 Chief；Claude 带 xhigh 的模型会多一个 `Ultra Code` 档位，菜单文案是句首大写的 `Ultra code`，校验用的名单里没有。已修（`dabfd4373`）。

## 未验证

- macOS 通知的实际横幅、点击通知后的跳转：开发版已请求权限并在系统通知库里注册了 `com.bytetrue.byspace.dev`，端到端已验证 daemon 发出且前端调用通知（/tmp/probe-notify.mjs），但开发版窗口没在前台时锁屏抓不到横幅，需用户自己看一眼。
- Windows / Linux 的原生通知（Wails 服务本身支持，没跑过）。
- Windows 桌面窗口的红绿灯不涉及（平台专用）。

同日追加：**工作区顶栏右侧的按钮「又肿又挤」**（`fc9d887dc`）。运行脚本、打开编辑器、git 操作（Push/Pull/Commit）这几组按钮用的是 shadcn 默认尺寸（带文字时 36px 高），顶栏本身只有 36px，旁边其它图标是 28px 的 ghost。给这三组加了尺寸参数，工作区顶栏统一传 shadcn 的 `sm` / `icon-sm`（28px），间距收紧；Changes 面板里只出菜单的形式不变。

同日第三轮（`f8429c9d2`）：顶栏按钮改成 ghost 图标（运行脚本、打开编辑器、git 操作），不再是一排带边框的胶囊挨着一排裸图标；浅色下 `--sidebar-accent` 从 `#f5f5f5` 改 `#e5e5e5`（离页面底色只差 1% 时选中行看不出来）；输入框去掉 shadcn 的 3px 焦点光圈和焦点边框，它本身有边框阴影，叠起来像双重边框。git split button 的两种形态拆成两个函数（之前 lint complexity 超限）。
