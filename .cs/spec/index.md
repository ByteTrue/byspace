# BySpace Project Spec

## 当前产品

BySpace 是一个 Web + CLI 环境，用于从浏览器或命令行监控和控制本机 AI coding agents。代码、凭据、Agent 进程、工作区和持久状态都留在本地 Node.js daemon；远程浏览器通过自托管的端到端加密 Relay 与 daemon 通信。

## 发行边界

- 支持：浏览器 Web/PWA、`byspace` CLI、本地 daemon、Cloudflare encrypted relay。
- 保留：Paseo `v0.2.0-beta.1` 中的直接 Provider、ACP、自定义 Provider、Terminal、Git/worktree、Voice、Schedule、Loop 与 MCP 能力。
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

当前源码以 Paseo `v0.2.0-beta.1` 的精确 tree 为来源，但 Git 默认分支使用无父提交的 BySpace-only clean history。LICENSE 和 README 保留上游版权、AGPL 与来源归属。未来只按 Paseo release 做新的 source snapshot，不再逐 commit 同步。
