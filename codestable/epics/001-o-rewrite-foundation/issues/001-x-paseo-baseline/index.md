---
kind: issue
title: "重建 Paseo 的系统基线"
type: explore
status: closed
created: 2026-08-27
related_issue: ""
---

# 重建 Paseo 的系统基线

## 要弄清什么、怎样算够

- **支持的决策：** Web 到底复制哪些源码；哪些服务职责由 Go daemon 重写、CLI 如何迁移；Relay、Hub 与多主机如何分界；第一条 Pi 闭环怎样证明架构而不删后续能力。
- **本轮边界：** Paseo monorepo 的 Web、client、protocol、server、CLI、Relay 与 Hub 客户端；外部 Relay/Hub 只确认来源和部署契约，不推断其未读内部实现。
- **停止条件：** 能沿本地 Agent、远程主机和 Hub 自动化三条触发路径讲到可观察结果；组件能归入复制、适配、Go 重写、自有服务、外部来源或永久排除；影响分成必须改、需要验和仍未知。

## 一句话：触发怎样变成结果

Web 或 CLI 先选择一个由 `serverId` 标识的 daemon，通过直连或 E2EE Relay 建立普通 daemon 协议会话；daemon 把请求交给项目、Agent、终端等领域服务，provider adapter 驱动本机 Agent 并把结果写回 canonical Timeline；Hub 则通过独立的 daemon-outbound 授权关系把外部事件变成受限执行。

## 先读哪里

1. [`local-client-to-agent-result.md`](local-client-to-agent-result.md) — 解释 Web/CLI 的一次 Agent 请求如何穿过 daemon 和 Pi，并回到 Timeline。
2. [`remote-client-to-host.md`](remote-client-to-host.md) — 解释多主机、直连、Relay 路由和 E2EE 为什么是四个不同责任。
3. [`hub-event-to-agent-run.md`](hub-event-to-agent-run.md) — 解释 Hub 为什么不经过 Relay，以及 CLI 人类身份与 daemon 关系如何分离。
4. [`migration-map.md`](migration-map.md) — 按目标代码所有权查看复制、适配、Go 重写、外部来源与分阶段顺序。

## 已经确认的主叙述

Paseo Web 是共享 Expo 应用的 Web 平台产物，不存在一个可以孤立复制的 `web/` 目录。它经 `packages/client` 使用 `packages/protocol`，并依赖 Relay 加密、代码高亮和插件 UI。共享 Web 代码仍会导入 browser-safe 的 desktop adapter，因此排除 Electron 包不等于立即删除所有名为 `desktop` 的前端文件。

Node daemon 是事实源：一个物理 WebSocket 同时承载 JSON 请求/推送与终端、文件传输二进制帧；Agent manager 负责生命周期和 Timeline，provider adapter 只负责各 Agent 原生运行时。CLI 既监督本地 daemon，也是完整的远程协议客户端。

多主机由 Web/CLI 保存并隔离多个 daemon 连接；Relay 只按 `serverId` 和连接 ID 转发不透明帧，业务内容由客户端与 daemon 端到端加密。Hub 是另一条直接关系：CLI 取得一次性 enrollment token，daemon 保存自己的关系凭据并直接连 Hub，Hub 只获得受 grant 限制的执行 RPC。

**必须修改：** Web 品牌和连接默认值；Go daemon 承接的全部 Node 服务职责；CLI 与新 daemon 的连接实现；daemon 侧 Relay 和 Hub 客户端；最终自有 Relay/Hub 部署配置。

**需要验证：** Web-only 构建闭包；首轮 JSON 与二进制 wire fixtures；Timeline 顺序与恢复；Go NaCl 加密互操作；Cloudflare Durable Object 的多连接、hibernation 和二进制 opcode；外部 Hub 与 Relay 源码许可证和实际部署契约。

**已决：** 产品与二进制名为 `byspace`；daemon 使用独立 `~/.byspace` 且不直接读写 Paseo home；CLI 与 daemon 使用同一个 Go 二进制，TypeScript CLI 仅作行为标尺。

**仍未知：** Hub 是 fork/adapt 还是重写；插件采用 Node sidecar 还是版本化新 ABI；Relay v1 是否兼容；纯 Web 如何重新表达少数 Electron-only 用户结果。

## 曾排除的理解 / 仍未知

- 曾错误地把 Relay、多主机、CLI、Hub 和后续 provider 当成排除项。用户已纠正：唯一永久排除的是桌面原生客户端和移动原生客户端。
- Pi-only 是首轮实施顺序，不是长期产品边界。
- Hub 与 Relay 不是同一服务，也不存在“没有 Hub 就没有多主机”的依赖。
- `packages/website` 是营销/文档站，不是 Hub 或 Relay。
- Paseo monorepo 中的 Cloudflare Relay 是旧部署实现；生产 Relay 在外部 Elixir 仓库。它可作为 byspace Cloudflare 版本的起点，但不能未经测试宣称生产等价。
- Hub 服务实现不在 Paseo monorepo；现有仓库只有 daemon/CLI 一侧的关系和执行协议。

## 关掉时材料去哪

- 稳定的迁移边界、首轮切片和已确认风险 → 本 Epic `spec.md`
- 实现后成为当前事实的路径 → `codestable/spec/`
- 证据路径、外部来源与被纠正的误解 → 留在本 Explore

## 关闭结论

三条触发—结果路径、组件迁移地图、永久排除项与外部来源已经达到可行动深度，并实际指导了后续 Web import、Go daemon、Agent/Pi、WebSocket、持久化与 Web 闭环 Issues。稳定边界已经进入本 Epic `spec.md`；Go NaCl 互操作与 Cloudflare Relay 行为验证作为明确后续切片保留，不伪装成已完成。用户已授权关闭满足证据条件的既有事项，本 Explore 关闭。
