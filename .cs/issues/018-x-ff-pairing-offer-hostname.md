---
kind: issue
title: "配对 offer 携带主机名，扫码添加免手动改名"
type: ff
status: closed
created: 2026-08-05
epic: ".cs/epics/2026/07/21/terminal-experience/spec.md"
---

# 配对 offer 携带主机名，扫码添加免手动改名

## 背景

手机扫码添加 host 时显示名是 `srv_...` 开头的 serverId，每次添加后都要手动改名。根因：扫码导入路径（`OfferLinkListener`）调用 `upsertDaemonFromOfferUrl(url)` 时不带 label，store 回退到 serverId；只有粘贴链接路径（`PairLinkModal`）会先连接探测 hostname 再作 label。

## 做了什么

把 daemon 主机名直接放进配对 offer，所有导入路径（扫码、粘贴、deep link）自动获得可读显示名，无需额外连接探测。

- `packages/protocol/src/connection-offer.ts` — `ConnectionOfferV2Schema` 增加可选 `hostname` 字段（`.optional()`，旧 daemon 的 offer 无此字段仍可解析；旧客户端解析含新字段的 offer 时未知键被忽略，双向兼容）。
- `packages/server/src/server/connection-offer.ts` — `createConnectionOfferV2` 填入 `os.hostname()`，与 `server_info.hostname` 同源。
- `packages/app/src/runtime/host-runtime.ts` — `upsertConnectionFromOffer` 的 label 回退到 `offer.hostname`；显式 label（粘贴路径的探测结果）优先，行为不变。已有非 serverId 名字的 host 不会被覆盖（`upsertHostConnectionInProfiles` 的 `nextLabel` 规则）。

## 怎么验证的

- `packages/protocol/src/connection-offer.test.ts`：新增 hostname round-trip + 无 hostname 旧 offer 解析测试，7/7 通过。
- `packages/app/src/runtime/host-runtime.test.ts`：新增 "falls back to the offer hostname as the label" 测试，58/58 通过。
- `packages/server/src/server/session/daemon/daemon-session.test.ts`：7/7 通过。
- `npm run build:client`（重建 protocol 声明）后 `npm run typecheck`、`npm run lint`、`npm run format`、`git diff --check` 全部通过。

## 对 `.cs/` 的影响

无已记录真相受影响：配对 offer 属于协议边界，新增可选字段符合协议的向后兼容规则（不破坏旧客户端解析、旧 daemon 生成）；显示名行为未改变任何状态机或权限模型。
