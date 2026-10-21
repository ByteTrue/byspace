---
kind: issue
title: "Go 侧缺 Service Proxy 整条链路：脚本能跑，但没有预览 URL"
type: feature
created: 2026-10-21
---

# Service Proxy 与脚本预览

> **读者：** 接手「让 `workspace.script.start` 真的能给出一个可以点开的预览地址」的人。

## 现状

`type: "service"` 的脚本能启动，能拿到 `PORT` / `WORKSPACE_SCRIPT_PORT` / 兄弟服务端口
（`BYSPACE_SERVICE_<NAME>_PORT`），`lifecycle` 与 `health` 也如实上报。

**缺的是最后一段**：Node 侧 `service-proxy.ts`（1039 行）把端口反向代理到
`<script>--<workspace>.<baseDomain>`，并配 `script-health-monitor.ts` 做健康探测与重启。
Go 侧没有对应实现，所以 payload 里没有可访问的 URL，脚本只能靠用户自己去 `localhost:PORT`。

## 为什么当时没做

这是整块反向代理（HTTP + WebSocket 升级、主机名解析、端口回收），不是「补一个字段」。
逐文件审计时判断：独立设计比顺手补洞更安全。

## 需要决定的几件事

1. **主机名从哪来**：`baseDomain` 配置项 + DNS（自建需泛解析），还是纯路径前缀
   （`/proxy/<workspace>/<script>/`，不需要 DNS）。
2. **TLS 与证书**：泛域名证书，还是只支持明文给本机/内网用。
3. **WebSocket 升级**：Vite/Next 的 HMR 依赖它，不做的话预览页能用但改代码不刷新。
4. **端口回收**：脚本停止后端口何时可复用——现在分配器有回收，但反向代理的路由表也要跟着清。

## 验收

- 起一个 `type: "service"` 的脚本，payload 给出一个可用 URL。
- 用浏览器打开该 URL 能看到脚本的页面。
- 该 URL 上的 WebSocket 能连通（HMR 或不刷新即可验证）。
- 停止脚本后 URL 立刻不可用，端口可被下一个脚本分配。

## 参考

- Node 实现：`archive/packages/server/src/server/service-proxy.ts`（1039 行）、
  `script-health-monitor.ts`（229 行）、`workspace-service-port-registry.ts`
- 已有：`internal/workspace` 的端口分配器、`workspaceScriptPayload` 的 `lifecycle`/`health`
- 台账：`epics/2026-10-19-o-go-single-binary-full-parity/issues/audit-log.md` 的 MISSING 表
