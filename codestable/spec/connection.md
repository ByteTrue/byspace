# 连接与发布通道

App 与 Relay 的地址按发布通道选择；用户的自定义配置始终优先。

## 通道与地址

- Stable 构建使用 `app.byspace.cc.cd`，prerelease 构建使用 `app-beta.byspace.cc.cd`；选择集中在发布通道定义，不散落多处判断。
- Stable 与 prerelease 使用同一个 Relay：`relay.byspace.cc.cd:443`，不保留 Beta Relay 兼容通道。
- 用户自定义 App/Relay endpoint 覆盖通道默认值。

## 安全边界

- Hosted HTTPS 页面在创建 WebSocket 前拒绝非 loopback 的 `ws://` Direct endpoint，并给出可行动提示；loopback、`wss://`、Relay 与同源 Web UI 不受影响。
- 上一条让**装成 PWA 与局域网明文直连互斥**：service worker 只在安全上下文里注册，而从 HTTPS 源加载的页面又连不了 `ws://192.168.x.x`。两者要同时成立，只能走 Relay、`wss://`，或给 daemon 配一张受信证书。原生 App 没有这个限制，它不是网页。影响到的能力见 [通知送达](notifications.md)。
- 配对 offer 携带可读 hostname，新 Host 首次保存时默认采用；缺少 hostname 的旧 offer 与旧客户端保持双向兼容。

## 历史证据

- [Epic 002 交付记录](../epics/002-x-retained-capabilities-delivery/spec.md)
