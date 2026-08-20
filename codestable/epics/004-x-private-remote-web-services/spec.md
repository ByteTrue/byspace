---
kind: epic
title: "私有远程 Web 服务"
status: closed
created: 2026-08-20
---

# 私有远程 Web 服务

## 这条线要改变什么

让一台已经运行 BySpace daemon 的机器，通过稳定的本地 URL，访问另一台已配对 daemon 的 loopback Web 服务。主要场景包括远程使用 AI Gateway，以及查看开发机上的 Web dev server；两者使用同一种 Remote Web Service，不建立 AI 专属分类。

这项变化跨 daemon-hosted Data Relay、daemon 间 E2EE 数据链路、Service Proxy、持久化、协议和 Web UI，且需要先证明新的数据面不会继承 Cloudflare Durable Object 免费操作额度风险，因此使用 Epic 承载。

- 关联 Project Spec：`codestable/spec/index.md` 中的“安全与可信边界”与“Workspace、Project 与生命周期”。
- 关联系统说明：`docs/architecture.md`、`docs/service-proxy.md`、`docs/data-model.md`、`docs/rpc-namespacing.md`、`docs/protocol-validation.md`。
- 历史证据：`origin/human-seahorse` 保留未合入的通用 TCP/TUN 实验，只作为选择性复用证据，不合并或 cherry-pick。

## 当前怎么理解

### 产品只有一种 Remote Web Service

一个映射由源 daemon 持久化，只包含稳定映射身份、本地名称、目标 daemon 身份/公钥和目标 loopback 端口。Relay endpoint/token 属于 daemon 当前运行配置，不写入映射；更换家里 B 或 VPS Relay 后无需重建映射。源 daemon 通过现有 Service Proxy 提供稳定 `.localhost` URL；普通 HTTP、SSE 和 WebSocket/HMR 都走同一个映射。

```text
浏览器或本地 HTTP 客户端
        │
        ▼
源 daemon Service Proxy 的稳定 localhost URL
        │
        │ E2EE 数据连接
        ▼
daemon-hosted WSS Data Relay
        │
        ▼
目标 daemon → 127.0.0.1/::1:<目标端口>
```

第一版只有 daemon-to-daemon 的 A1 场景：访问设备和目标设备都运行 BySpace daemon。不提供公共 preview URL，也不支持只有浏览器、没有 daemon 的设备。

### 控制面与数据面分离

现有 Cloudflare Relay 继续承担 Web App 与 daemon 的控制消息。Remote Web Service 数据不进入 Worker 或 Durable Object，而进入由任意 BySpace daemon 可选托管的独立 WSS Data Relay listener。

Data Relay Host：

- 与完整 daemon API 使用不同监听端口；公网反向代理或内网穿透只允许暴露 Data Relay 的 `/ws` 和 `/health`，不得暴露 daemon `6777`；
- 可以运行在家里开发机 B 上并由该机器的内网穿透暴露，也可以运行在只安装 BySpace daemon 的 VPS 上并由 Caddy/nginx/Cloudflare Tunnel 暴露；
- 只负责 Relay v2 WebSocket 会话配对、控制通知、密文字节转发和有界背压；
- 通过 access token 拒绝未授权的公网 WebSocket upgrade，daemon 公钥仍负责端到端身份和内容安全；
- 不解析 HTTP、Prompt、API Key 或模型输出；
- 不持久化 Remote Web Service 映射、目标端口或 daemon 私钥；
- 企业机 A 只建立固定域名上的出站 WSS 443，不运行任何内网穿透。

Data Relay 与现有 Relay E2EE channel 兼容，但作为新能力只需要 Relay v2；不为旧 daemon 建立降级路径。Relay 托管位置不决定服务方向：B 上 Agent 可经同一 Relay 访问 A 的 AI Gateway，A 上浏览器也可经它访问 B 的 Web dev server。

### HTTP 边界由 Service Proxy 保证

产品只支持 HTTP、SSE 与 WebSocket，不公开原始 TCP listener。源端必须由现有 Service Proxy 解析 HTTP 并显式接管 WebSocket upgrade，再为请求创建内部数据 channel。即使底层 channel 传递不透明字节，也不能向用户或局域网暴露任意 TCP 接口。

目标 daemon 每条数据连接只接收版本化的目标端口请求，并且只能尝试自己的 `127.0.0.1` 与 `::1`。线路上不得出现任意 hostname、Unix socket、命令或 LAN 地址。

### 映射稳定，请求不续传

- 映射与本地 hostname 由源 daemon 原子持久化，daemon 重启后恢复；
- 显示名变化不改变稳定 hostname；
- Data Relay 或目标 daemon 短暂离线不会删除映射；
- 网络中断立即终止当前 HTTP/SSE/WebSocket 流并清理目标资源；
- 不缓存、重放、断点续传或恢复活动请求；
- 后续新请求重新建立数据连接；目标不可达时快速返回明确错误。

### 质量约束与取舍

- 功能适合性：正确承载普通 HTTP、SSE 与 WebSocket/HMR；不以支持 AI Gateway 为由增加专属协议或 UI。
- 可靠性：映射跨源 daemon 重启保持，活动流中断时两端有界清理，控制面不被数据面故障拖垮。
- 性能效率：Data Relay 不经过 Durable Object；转发必须有有界缓冲和背压，不能用无限内存吸收慢端。
- 信息安全性：daemon 公钥继续作为目标身份锚点，数据在源与目标 daemon 间端到端加密；Relay 只见连接元数据和密文；目标只能是 loopback。
- 兼容性：新 RPC 使用 dotted namespace，能力集中通过 `server_info.features.remoteWebServices` 检测；没有旧 daemon fallback。
- 可维护性：复用现有 Relay v2/E2EE 与 Service Proxy，不引入 P2P、TURN、TUN、native helper、协议转换或 AI provider 自动配置。

## 完成结果

### 已完成范围

1. 穿刺 Node WSS Relay adapter 对现有 Relay v2 与 E2EE transport 的兼容性，并将它作为 daemon 的可选独立 listener 托管。
2. 建立 Remote Web Service 的 transport-neutral channel、target loopback session 和有界流控。
3. 扩展 Service Proxy 的 local-only remote route，并实现源 daemon 持久化映射。
4. 增加 create/list/delete RPC、统一能力门和最小通用 Web UI。
5. 用双 daemon 实测 HTTP、SSE、WebSocket、重启恢复、断线与无公网 alias。
6. 补充家里 B daemon + 内网穿透，以及 VPS daemon + Caddy/nginx 两套部署、健康检查、资源限制和运行说明。

### Issues

- [x] `issues/001-x-standalone-wss-data-relay-spike.md`：standalone Relay v2、E2EE、有界转发及 daemon-hosted listener 穿刺通过并已关闭。
- [x] `issues/002-x-daemon-remote-web-services.md`：daemon 数据链路、持久化、Service Proxy、RPC、UI、安全加固、部署文档与真机验证完成并已关闭。

### 暂不推进

- 无 daemon 设备的浏览器访问、公共 preview URL、分享链接或公网服务发现。
- 任意 TCP、UDP、SSH、数据库、VPN、P2P、TURN、NAT 打洞或 TUN/native helper。
- AI Gateway 类型、模型探测、Provider 自动配置、API Key 托管或协议转换。
- 活动 HTTP/SSE/WebSocket 的断点续传、缓存或透明重放。
- 将数据重新放回 Cloudflare Worker/Durable Object，或免费额度不足时静默回退控制 Relay。

### 已确认实现

- Data Relay 使用 `packages/relay` 的 Node adapter，由 `packages/server` daemon 生命周期按可选独立 listener 托管；不创建独立产品、安装包或镜像。
- 映射不持久化 Relay locator；运行时始终使用当前 daemon Data Relay 配置，因此 B-hosted Relay 迁移到 VPS 只需要修改 A/B 的 endpoint/token 并重启 daemon。
- 最小通用 UI 位于 Host Settings，只创建名称、目标 Host 和端口，不区分 AI Gateway 与 Web dev service。
- Source Service Proxy 对 HTTP 与 WebSocket 都按真实 socket 来源强制 loopback；目标 daemon 只连接自己的 loopback 端口。
- 实现已通过 108 个定向测试、build、全仓 typecheck/lint/format check、Web export、真实浏览器 CRUD、双向 A/B 真机链路、source daemon 重启恢复和最终独立复审。

## 关闭条件

以下条件均已由自动化测试、独立复审或隔离真机验证满足：

- 源 daemon 创建映射后得到稳定 localhost URL，重启后同一 URL 仍可使用。
- 目标只连接自己的 IPv4/IPv6 loopback 端口，非法目标无法进入协议或持久层。
- HTTP、SSE 与 WebSocket/HMR 通过双 daemon 真实链路工作；网络断开会终止当前流但保留映射。
- Remote Web Service 数据只经过 daemon-hosted WSS Data Relay listener，不产生 Cloudflare Worker/Durable Object 数据面操作。
- Data Relay 有健康检查、连接/缓冲/消息限制、优雅关闭和可复现部署说明。
- 数据面与控制面故障隔离，Relay 无法读取应用正文，持久化文件按项目规则原子写入并保持私有权限。
- 新旧 daemon 组合由单点 capability gate 明确拒绝，不存在散落 fallback。
- 定向测试、typecheck、lint、format 与 Web export 全部通过。

## 毕业回写

稳定能力、核心契约、长期边界与排除范围已经直接合并到 `codestable/spec/index.md` 的“私有远程 Web 服务”章节，包括：

- daemon-to-daemon、local-only 的 HTTP/SSE/WebSocket 能力与源端稳定映射；
- 任意 daemon 可选托管的独立 WSS Data Relay、daemon 间 E2EE，以及不经过 Cloudflare Worker/Durable Object 的数据面；
- loopback-only source/target 边界、当前配置与映射分离、B→VPS 无需重建映射的迁移契约；
- 网络中断终止活动流但保留映射，以及 capability gate 和明确非目标。

项目没有单独的 Vision 文档需要更新；本 Epic 没有把公共分享、browser-only 入口或通用网络隧道扩大为目标世界。

## 关闭结论

两个所属 Issue 均已关闭，直接推进范围已由自动化、真实浏览器、双向 A/B 真机和独立复审提供证据。控制面/数据面隔离、E2EE、资源限制、持久化、兼容性与部署迁移约束均已成为 Project Spec 的可独立阅读真相；无阻断关闭的遗留事项。
