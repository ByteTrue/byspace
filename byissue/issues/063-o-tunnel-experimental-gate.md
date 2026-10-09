---
kind: issue
title: "Daemon tunnel 实验性门控（默认关闭）与自定义 relay 说明"
type: feature
status: open
created: 2026-10-09
---

# Daemon tunnel 实验性门控（默认关闭）与自定义 relay 说明

> **读者：** 跨会话接手的人。062 交付的隧道功能按用户要求补两件事：标记实验性并默认关闭；自托管 relay 支持的验证与文档化。

## 为什么做

- Owner 拍板：隧道先按实验性发布——默认关闭，用户显式开启。避免未经验证的能力默认暴露。
- 自托管 relay 用户的数据安全关切：隧道流量必须走他们自己的 relay，不强制官方 relay。

## 现状（已核实）

- **自定义 relay 已经成立**：pairing offer 携带 `relayPublicEndpoint` + `relayPublicUseTls`（`pairing-offer.ts` 的 `createConnectionOfferV2`），D1 的 TunnelManager URL 完全来自 offer——自托管 D2 的 offer 天然指向其自托管 relay。所有 e2e 本就用本地 Node relay（= 自托管形态）隐式验证了这条。剩余工作是文档显式化。
- **实验性门控不存在**：062 的 config 只有 `tunnel.allowedPorts`，无开关。

## 方案

- `daemon.tunnel.enabled`（默认 false）：persisted schema + resolve + mutable 视图 + patch 通道 + RELOADABLE_PATHS。
- D2 侧 `tunnel.open` 先查 enabled（拒绝文案指向远端的 Tunnels 页开启开关）；D1 侧 `tunnel.create` 先查本机 enabled。
- `TunnelRegistryService.setEnabled` 热切换（仿 `relayRuntime.setEnabled` + `onFieldChange("tunnel.enabled")`）：true 时拉起已持久化 peers，false 时停全部；boot 时按 config 起或不起。
- app `/tunnels`：未开启时显示 Enable 卡（实验性说明 + 开启按钮，patch config）；开启后现有 UI + Experimental 标注。
- 文档：spec/connection.md、public-docs/connectivity.md（实验性 + 开启步骤 + 自托管 relay 说明）、062 交接手册 config 补 `enabled: true`。

## 验证口径

- 单测：open/create 在 disabled 时拒绝；registry disabled 时 add 拒绝、boot 不起、setEnabled 热切换。
- e2e：全部 tunnel 测试 config 加 `enabled: true`；GUI spec 改为「先见 Enable 卡 → UI 开启 → add tunnel」完整流。
- 门禁：typecheck/lint/format；既有回归不破。

## 执行记录

### 2026-10-09 · 完成：门控 + 自定义 relay 说明

**实验性门控（默认关闭）：**

- `daemon.tunnel.enabled`（缺省 false）全链落地：persisted schema → `resolveTunnelConfig` → mutable 视图（`createTunnelView`）→ patch 通道（`pickTunnelPatchFields`/`applyPersistedTunnelPatch` 按字段合并，enable patch 不清 allowedPorts）→ RELOADABLE_PATHS/PERSISTED_TO_MUTABLE_PATH。
- 服务端双门：D2 `tunnel.open` 与 D1 `tunnel.create` 先查 enabled（拒绝文案指向各自 Tunnels 页）；`TunnelRegistryService` boot 时不启动 managers、`add` 拒绝、`setEnabled` 热启停（bootstrap 接 `onFieldChange("tunnel.enabled")`，仿 relay.setEnabled）。
- app `/tunnels`：未开启显示 Enable 卡（说明 + 开启按钮，patch 热生效）；开启后原 UI + Experimental 标注。i18n 9 locale（`tunnels.experimental` + `tunnels.enable.*`）。

**自定义 relay（已成立，文档化）：**

- 核实 pairing offer 携带 `relayPublicEndpoint` + `relayPublicUseTls`（`pairing-offer.ts`），D1 TunnelManager URL 完全来自 offer——自托管 D2 的隧道天然走其自托管 relay，与 app 客户端同一信任模型（E2EE 不依赖 relay）。全部 e2e 本就用本地 Node relay（自托管形态）验证。写入 spec/connection.md「relay 归属」条与 public-docs/connectivity.md。

**调试插曲（记录）：** GUI e2e 一度失败——D2 open denied: disabled。探针（supervisor spawn + enabled config）全通，最终 dump config.json 发现 **spec 里 D2 的 daemonConfig 漏加 enabled**（只改了 server 侧测试文件）。教训与 notes/007 同源：先查实际输入再怀疑加载链。

**验证：** server 75/75（新增 open-disabled、add-disabled、boot-disabled、setEnabled 热启停 4 用例）；GUI e2e 1/1（Enable 卡 → UI 开启 → add → 字节转发，6.4s）；live 公网 relay e2e 1/1；i18n 51/51；typecheck/lint/format 0 违规。062 交接手册 config 已同步加 `enabled: true`。

**遗留：** 无阻塞项。Win 双机验证按 062 手册（已更新）进行。
