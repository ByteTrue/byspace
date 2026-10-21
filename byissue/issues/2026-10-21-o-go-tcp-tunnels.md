---
kind: issue
title: "Go 侧 TCP Tunnels 未实现（需第二台机器才能验证）"
type: feature
created: 2026-10-21
---

# TCP Tunnels

> **读者：** 接手「从外网把某个本地端口接出去」的人。

## 现状

`tunnel.*` 那批 RPC 在 Go 侧返回空或 `not_connected`。`server_info.features.daemonTunnels`
本轮已改为 `false`——此前它声明为 `true`，客户端会渲染入口而背后什么都没有。

## 为什么当时没做

这个功能**必须有两台机器**才能验证：隧道的一端在本机，另一端在远端 relay。没有第二台机器时
只能盲写，而盲写的风险高于收益——一个「看起来通了但实际转发到错误端口」的隧道比没有更糟。

## 需要什么条件才能开始

1. 第二台机器（或一个可 SSH 的远端），且能跑 relay 或连到已部署的 relay。
2. 明确隧道要转发的是**终端 RPC** 还是**任意 TCP 端口**（Node 两个都有：
   `tunnel-manager.ts` 是任意端口，`ssh-tunnel.ts` 是 SSH 端口转发）。

## 验收

- 本机起一个 HTTP 服务在某端口，建一条隧道。
- 在第二台机器上通过隧道地址访问到该服务。
- 断开后两端都清理干净（不留孤儿 listener）。

## 参考

- Node 实现：`archive/packages/server/src/server/tunnel-manager.ts`、`tunnel-registry.ts`、
  `archive/packages/cli/src/ssh/ssh-tunnel.ts`
- 台账：同上 MISSING 表，标为 DROPPED（条件不足）
