# BySpace Project Spec

## 当前产品

BySpace 是一个 Web + CLI 环境，用于从浏览器或命令行监控和控制本机 AI coding agents。代码、凭据、Agent 进程、工作区和持久状态都留在本地 Node.js daemon；远程浏览器通过自托管的端到端加密 Relay 与 daemon 通信。

## 发行边界

- 支持：浏览器 Web/PWA、`byspace` CLI、本地 daemon、Cloudflare encrypted relay。
- 保留：Paseo `v0.2.0` 中的直接 Provider、ACP、自定义 Provider、Terminal、Git/worktree、Voice、Schedule、Loop 与 MCP 能力。
- 不支持：Electron、原生 iOS/Android、app-store/APK、marketing website、Electron Browser automation。

## 身份与发布

- 产品：BySpace
- npm/CLI：`@bytetrue/byspace` / `byspace`
- 环境变量：`BYSPACE_*`
- daemon home：`~/.byspace`
- 默认端口：`6777`
- Web：`https://byspace.pages.dev`
- Relay：`wss://byspace-relay.bytetrue.workers.dev:443`

## Agent 聊天完整性

- daemon 已提交的 Timeline 是聊天完整性的权威来源；live stream 负责低延迟展示，保留 subscription 不能证明浏览器没有漏收消息。
- 初始化、窗口恢复、重新显示 Workspace、gap 修复、显式刷新、rewind/reload 与旧历史分页共享每个 Host 的单一同步所有者；向前追赶和向前翻旧历史互不取消。
- 恢复前台或窗口焦点时立即权威追赶到当前 tail。并发响应按连接代际、Timeline epoch、cursor 与 source sequence ranges 合并，而不是按请求发出顺序判新旧；错误响应不能把聊天标记为已就绪。

## 来源与维护

当前源码以首次干净引入的 Paseo `v0.2.0-beta.1` 为产品基础，并已按 release-delta 流程同步至 Paseo `v0.2.0`；Git 默认分支始终保持 BySpace-only ancestry。LICENSE 和 README 保留上游版权、AGPL 与来源归属。后续只按 Paseo 正式 release 审查并移植聚合差异，不导入上游提交历史。
