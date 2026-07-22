---
kind: issue
title: "阻止 Hosted Web 发起不安全的局域网 Direct"
type: ff
status: closed
created: 2026-07-22
epic: ""
---

# 阻止 Hosted Web 发起不安全的局域网 Direct

## 做了什么

Hosted HTTPS 页面在创建 WebSocket 前拒绝明文非环回 Direct，避免失败连接仍把 Chrome 标签页持续标成 Not Secure；环回、TLS 和 daemon 自带 Web UI 的同源直连不受影响。

## 改了哪些

- `packages/app/src/utils/test-daemon-connection.ts` — 在统一探测入口增加浏览器安全边界。
- `packages/app/src/utils/test-daemon-connection.test.ts` — 覆盖 HTTPS 局域网阻止及 HTTP、TLS、环回放行。
- `public-docs/web-ui.md` — 记录无需反代的可信局域网直连方式。

## 怎么验证的

定向 Vitest 6/6、全仓 typecheck、lint、format check 和 App Web export 均通过。

## 对 .cs/ 的影响

- 无已记录 Project Spec 真相受影响；Direct 仍受支持，只收紧 Hosted HTTPS 到明文非环回地址这一不安全入口。
