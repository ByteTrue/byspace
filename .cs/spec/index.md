# BySpace Project Spec

## 当前产品

BySpace 是一个 Web + CLI 环境，用于从浏览器或命令行监控和控制本机 AI coding agents。代码、凭据、Agent 进程、工作区和持久状态都留在本地 Node.js daemon；远程浏览器通过自托管的端到端加密 Relay 与 daemon 通信。

## 发行边界

- 支持：浏览器 Web/PWA、`byspace` CLI、本地 daemon、Cloudflare encrypted relay。
- 保留：Paseo `v0.2.0` 中的直接 Provider、ACP、自定义 Provider、Terminal、Git/worktree、Voice、Schedule、Loop 与 MCP 能力。
- 不支持：Electron、原生 iOS/Android、app-store/APK、marketing website、Electron Browser automation。

## Terminal

Terminal Tab 可以在切换后保留本地 renderer 状态，但保留挂载不等于继续消费输出：只有当前可见的 retained Terminal 持有 daemon stream；隐藏 Tab 立即停止订阅，重新显示时通过 daemon 的权威 snapshot/revision 恢复隐藏期间的最终状态。同屏 split pane 中未聚焦但仍可见的 Terminal 继续持有 stream。

## Agent Timeline

空闲 Provider runtime 回收不阻塞已有 Timeline 首屏：浏览历史不唤醒 Provider，继续执行时才恢复。

## 项目准备

Project Settings 保留对 `byspace.json` 的精确手工编辑，也提供 Configure/Review with agent 入口。入口始终沿用当前 Host、项目与仓库目录，只创建一份可检查和修改的 Agent draft，不自动发送或直接修改项目。

Agent 使用 bundled `byspace-project-setup` Skill 检查干净 worktree 的可重复准备、高频命令的可发现性，以及长期服务的并行运行风险。建议必须由仓库证据导出并在修改前展示；现有配置和未知字段应保留，secrets、共享资源与破坏性操作必须单独确认。

只有声明支持该 Skill 的 Host 才显示可执行入口；Skill 未安装或版本漂移时先安装或更新，失败保留当前项目上下文并允许重试。旧 Host 只提示升级，不用普通 Agent prompt 模拟降级能力。

## 身份与发布

- 产品：BySpace
- npm/CLI：`@bytetrue/byspace` / `byspace`
- 环境变量：`BYSPACE_*`
- daemon home：`~/.byspace`
- 默认端口：`6777`
- Web：`https://app.byspace.zijieapi.de5.net`
- Relay：`wss://relay.byspace.zijieapi.de5.net:443`

## Agent 聊天完整性

- daemon 已提交的 Timeline 是聊天完整性的权威来源；live stream 负责低延迟展示，保留 subscription 不能证明浏览器没有漏收消息。
- 初始化、窗口恢复、重新显示 Workspace、gap 修复、显式刷新、rewind/reload 与旧历史分页共享每个 Host 的单一同步所有者；向前追赶和向前翻旧历史互不取消。
- 恢复前台或窗口焦点时立即权威追赶到当前 tail。并发响应按连接代际、Timeline epoch、cursor 与 source sequence ranges 合并，而不是按请求发出顺序判新旧；错误响应不能把聊天标记为已就绪。

## 来源与维护

当前源码以首次干净引入的 Paseo `v0.2.0-beta.1` 为产品基础，并已按 release-delta 流程同步至 Paseo `v0.2.0`；Git 默认分支始终保持 BySpace-only ancestry。LICENSE 和 README 保留上游版权、AGPL 与来源归属。后续只按 Paseo 正式 release 审查并移植聚合差异，不导入上游提交历史。
