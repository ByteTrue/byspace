---
kind: issue
title: "Data Relay UI configuration and Remote Web Services UX redesign"
type: feature
status: closed
created: 2026-08-21
---

# Data Relay UI configuration and Remote Web Services UX redesign

## 目标

为 Private Remote Web Services 功能提供完整的 UI/UX 重构与纯界面化配置能力：

1. 消除对环境变量和手动修改配置文件的依赖，用户可在 Web UI 上直接配置、启动、管理 Data Relay（中继节点与客户端连接），并实现热重载生效。
2. 重构 Host Connections 中的 Remote Web Services 界面，消除死胡同式的空白状态，提供清晰的心智模型指引、状态徽章、向导式配置、常用端口预设（Vite、Next.js、AI Gateway、Ollama）以及一键复制 URL 等能力。

## 范围

- **包含**：
  - 协议层：`MutableDaemonConfigSchema` 与 `ServerInfoStatusPayload` 扩展支持 `dataRelay` 配置与详细状态。
  - 服务端：`PersistedConfigSchema`、`DaemonConfigStore`、`bootstrap.ts` 支持动态重载与管理 Data Relay 监听器及客户端运行时。
  - 前端 UI：
    - 新增 Data Relay 配置面板与设置弹窗（支持“作为中继服务器”和“连接已有中继”两条直观路径，支持一键生成随机高强度 Token）。
    - 重构 Remote Web Services 区域，在未配置中继时提供引导入口，在已配置时展示清晰的服务列表、复制链接与状态指示。
    - 添加服务表单中增加常用场景预设与生成的本地域名实时预览。
  - 多语言：更新 `en.ts`、`zh-CN.ts` 等文案。
- **不包含**：自动公网穿透/第三方 Tunnel 自动开通（由用户已有 Tunnel 或公网 IP 提供）。

## 影响范围

- `packages/protocol/src/messages.ts`
- `packages/server/src/server/persisted-config.ts`
- `packages/server/src/server/config.ts`
- `packages/server/src/server/daemon-config-store.ts`
- `packages/server/src/server/bootstrap.ts`
- `packages/server/src/server/websocket-server.ts`
- `packages/app/src/screens/settings/remote-web-services-section.tsx`
- `packages/app/src/screens/settings/data-relay-section.tsx`
- `packages/app/src/screens/settings/host-page.tsx`
- `packages/app/src/i18n/resources/*.ts`

## 验证结果

- `npm run typecheck`：通过（全 monorepo 无类型错误）。
- `npm run lint`：通过（oxlint 0 errors, 0 warnings）。
- `npm run format:check`：通过。
- `vitest`：`messages.remote-web-services.test.ts`、`daemon-config-store.test.ts`、`remote-web-service-manager.test.ts`、`remote-web-service.local.e2e.test.ts`、`use-remote-web-services.test.tsx` 37 项测试全部通过。
- 端到端双机环境动态重载模拟测试：完整验证了双 Daemon 在未配置中继状态下，动态通过 ConfigStore 启动 Relay Server、建立 Client 握手、创建 Service 映射、执行 E2EE HTTP 路由、SSE 流式推送与 WebSocket HMR 全双工回显通信。
- Web Export：`npm --prefix packages/app run build:web` 成功生成 Web Bundle。

## 关闭结论

- **完成度判断**：目标与范围全部达成。消除死胡同体验，支持纯 Web UI 端到端配置并热重载生效。
- **毕业回写**：稳定事实已合并至 `codestable/spec/index.md`（「私有远程 Web 服务」章节中关于 Data Relay UI 配置与生命周期热重载规范）。
- **遗留事项**：无阻塞项。
