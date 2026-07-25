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

## 来源与维护

当前源码以首次干净引入的 Paseo `v0.2.0-beta.1` 为产品基础，并已按 release-delta 流程同步至 Paseo `v0.2.0`；Git 默认分支始终保持 BySpace-only ancestry。LICENSE 和 README 保留上游版权、AGPL 与来源归属。后续只按 Paseo 正式 release 审查并移植聚合差异，不导入上游提交历史。
