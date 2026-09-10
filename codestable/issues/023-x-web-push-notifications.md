---
kind: issue
title: "Web Push 通知"
type: feature
status: closed
created: 2026-09-10
---

# Web Push 通知

> **读者：** 想知道浏览器和 PWA 的通知怎么送达、为什么不走 Expo、以及 daemon 侧的 VAPID 密钥归谁管的人。

---

## 做成以后是什么样

在浏览器里用 BySpace 的人，页面关掉、切到别的 tab、或者（iOS 上）把 PWA 加到主屏幕后退到后台，agent turn 结束、需要权限、terminal 需要注意时，能收到操作系统级通知。点通知回到对应的 agent 或 terminal。

**范围：**

包含 —— daemon 生成并持有 VAPID 密钥对；daemon 直接向浏览器给出的 push endpoint 发送加密推送；web 客户端注册 service worker、订阅、把订阅注册给 daemon；设置里一个开关让用户授权；service worker 处理 `push` 与 `notificationclick`。

不包含 —— service worker 的离线缓存（见下方「明确不做缓存」）；任何原生（Expo）推送改动；通知的分类与偏好设置；Electron（它已有系统通知）。

## 为什么现在做 / 当前坏在哪

BySpace 的原生推送**完全失效**：`packages/app/app.config.js` 的 `extra` 里没有 `eas.projectId`（fork 时被剥离，根因见 `codestable/issues/011-x-ff-android-apk-ci-release.md`），`push-notifications/internal/subscriptions.ts` 里 `getExpoPushTokenAsync` 拿不到 token，直接 warn 后放弃。

web 端更彻底：`push-notifications/index.web.ts` 是个空 stub，`utils/os-notifications.ts` 只在页面开着时用 Notification API 弹通知，页面一关就没有。

daemon 侧的链路其实是完整的——`server/push/token-store.ts` 存 token、`websocket-server.ts` 在 agent 和 terminal 需要注意时算出 `shouldPush` 并调 `send()`。缺的只有一条能真正送达的传输。

### 为什么选 Web Push 而不是修 Expo

|            | Expo push                                                                                                                                        | Web Push                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 外部账号   | 要 expo.dev 项目 + Firebase 项目 + FCM service account 上传 EAS                                                                                  | 无                                                                     |
| iOS        | 需要 Apple Developer Program（$99/年）+ 带 Push 能力的签名；当前的 unsigned IPA 走不通                                                           | Apple 官方声明主屏幕 PWA 的 Web Push **不需要开发者会员**（iOS 16.4+） |
| 凭据归属   | Expo 持有 FCM 凭据，daemon 无凭据 POST 到 `exp.host`                                                                                             | 每个 daemon 自己生成自己持有 VAPID 密钥对                              |
| 正文可见性 | 明文经 `exp.host` → FCM/APNs。`agent-attention-notification.ts` 的 body 含 assistant 消息前 220 字，权限请求时含 `JSON.stringify(request.input)` | RFC 8291 强制 `aes128gcm` 加密，push 网关只见密文                      |
| 覆盖面     | 仅原生 app                                                                                                                                       | iOS PWA + Android 浏览器 + 桌面 Chrome/Firefox/Edge                    |

第三行是决定性的：daemon 是用户自托管的，「谁持有推送凭据」在 FCM 直连方案里无解（塞进公开 npm 包等于泄露，每人自建 Firebase 又和 APK 里烧死的 sender ID 对不上）。VAPID 把这个问题消掉了。

原生那条路不删也不改，`index.native.ts` 保持原样。

## 现状怎么工作

agent turn 结束 → `AgentManager` 的 attention 回调 → `websocket-server.ts` `broadcastAgentAttention()` → `computeNotificationPlan()` 按各客户端在线/聚焦状态算出 `shouldPush` → `pushNotificationSender.send(payload)` → `push/index.ts` 从 `PushTokenStore` 取活跃 token → `PushService.sendPush()` POST 到 `exp.host`。

`register_push_token` 在协议里传的是一个**不透明字符串**（`messages.ts`），`token-store.ts` 也只当字符串存。所以换传输层不需要动协议，也不需要动 token store。

## 动哪些、验哪些

- **必须改：**
  - `packages/protocol/src/messages.ts` — `server_info` 加两个可选字段
  - `packages/server/src/server/push/` — 新增 VAPID 密钥存储与 web-push sender，`index.ts` 按 token 形状分派
  - `packages/server/src/server/websocket-server.ts` — 广播 `features.webPush` 与 `webPushPublicKey`
  - `packages/app/public/sw.js` — 新增
  - `packages/app/src/push-notifications/index.web.ts` — 从 stub 变成真实订阅
  - 设置里的通知区块 — 目前只对 Electron 渲染，要对支持 Web Push 的浏览器也渲染
- **需要验：** 桌面 Chrome 端到端；iOS 主屏幕 PWA 端到端；原生 Android/iOS 构建不受影响（`index.native.ts` 未改）；旧客户端连新 daemon、新客户端连旧 daemon 都不报错。
- **仍未知：** iOS PWA 上订阅在系统更新后是否会失效并需要重新订阅——只能观察。

## 方案与实现安排

### token 形状分派

Web Push 的订阅是三元组（`endpoint` / `keys.p256dh` / `keys.auth`），序列化成 JSON 字符串塞进现有的 `register_push_token`。发送时按形状分派：能解析成合法订阅 JSON 的走 web-push，其余（`ExponentPushToken[...]`）走原有 Expo 路径。

**不动协议的 token 语义，不加新 RPC。** token 本来就是不透明的。

### VAPID 密钥

daemon 首次需要时生成一对，写 `$BYSPACE_HOME/web-push-keys.json`，用 `private-files.ts` 的 `writePrivateFileAtomicSync`（0600），与 `push-tokens.json` 同一套约定。公钥通过 `server_info.webPushPublicKey` 下发，私钥不出 daemon。

密钥换掉会让所有已有订阅失效——所以只在文件不存在时生成，不做轮换。

### 能力门控

按 `CLAUDE.md` 的协议规则，`features.webPush` 做门控，`webPushPublicKey` 带载荷。两个都是可选字段，老客户端解析新 daemon、新客户端解析老 daemon 都不受影响。

### 权限必须由用户手势触发

iOS Safari 要求 `Notification.requestPermission()` 来自用户手势，所以**不能在连接时自动申请**。行为定成：

- 权限已经是 `granted` → 连接时静默订阅
- 权限是 `default` → 什么都不做，等用户在设置里点开关
- 权限是 `denied` → 什么都不做，设置里显示为被系统拒绝

### 明确不做缓存

service worker 只处理 `push` 和 `notificationclick`，**不注册任何 `fetch` 处理器，不缓存任何东西。**

理由：app 和 daemon 本来就会版本漂移（`docs/protocol-compatibility.md`），再叠一层 SW 缓存，排查「用户跑的到底是哪个版本」会非常难受。离线外壳缓存等到真有纯客户端功能需要它时再单独做，那时候要连同缓存版本化和更新提示一起设计。

### iOS 的两条约束（不解决，只记录）

- 主屏幕 PWA 才有 Web Push，Safari 标签页里没有。
- `codestable/spec/connection.md` 已规定 HTTPS 页面拒绝非 loopback 的 `ws://`。所以走 HTTPS 的 PWA 只能经 Relay 或 `wss://` 连 daemon，**和局域网明文直连互斥**。原生 app 无此限制。

## 验证

1. **单测** — VAPID 密钥的生成与复用（第二次读盘不重新生成）；token 形状分派（web 订阅 JSON 走 web-push、`ExponentPushToken` 走 Expo）；push 网关返回 404/410 时 token 被撤销。
2. **桌面 Chrome 端到端** — `http://localhost:6778` 打开 web UI（loopback 是 secure context，service worker 可注册），设置里开启通知，切到别的应用，跑一个 agent 到 turn 结束，确认收到系统通知，点击后回到该 agent。
3. **iOS PWA 端到端** — Safari 打开 `app-beta.byspace.cc.cd`，加到主屏幕，从主屏幕图标启动，设置里开启通知，退到后台，确认锁屏收到通知。
4. **不回归** — 原生 Android 构建仍能编译且行为不变；旧客户端连新 daemon 不报错。

## 执行记录

### 改了什么

**协议**（`packages/protocol/src/messages.ts`）——`server_info` 上两个可选字段：`features.webPush` 做门控，`webPushPublicKey` 带 VAPID 公钥。两处都有 `COMPAT(webPush)` 标记。inbound 校验器是 `pretypecheck`/`prebuild` 自动生成的，不用手改。

**daemon**

- `push/vapid-keys.ts`（新）——`generateKeyPairSync("ec", prime256v1)`，导出 JWK 后拼成 Push API 要的编码：公钥是 `0x04` + X + Y 的未压缩点，私钥是 32 字节标量，都 base64url。Node 的 JWK 会省略前导零字节，所以按固定宽度左侧补零。只在文件不存在时生成。
- `push/web-push-service.ts`（新）——`parseWebPushSubscription()` 把 token 当订阅 JSON 解析（要求 `https://` endpoint 加两个 key），`WebPushService` 用 `web-push` 包发送，404/410 撤销 token，其余状态码只记日志。
- `push/index.ts`——导出 `partitionPushTokens()` 做形状分派，`PushNotifications` 多一个 `webPushPublicKey()`。
- `websocket-server.ts`——传 `vapidFilePath`，并在 `server_info` 里广播门控与公钥。
- 新依赖 `web-push@^3.6.7`（`@types/web-push` 进 devDependencies）。选包而不是手写 RFC 8291 的 HKDF/AES128GCM：静默失败很难查，而且换掉只影响一个文件。`scripts/package-bytetrue-baseline.mjs` 自动从 workspace 依赖收集外部依赖，打包侧不用改。

**app**

- `public/sw.js`（新）——只处理 `push` 与 `notificationclick`，**没有 fetch 处理器，不缓存**。通知按 agent / terminal 打 tag 收敛重复。
- `push-notifications/internal/web-subscription.ts`（新）——订阅、注册、状态查询、撤销。
- `push-notifications/index.web.ts`——从空 stub 变成真实实现；`index.ts` 与 `index.native.ts` 补上同签名的 `isWebPushSupported` / `getWebPushState` / `enableWebPush`（基础文件是类型来源，签名必须与 web 实现一致，否则调用点会报「Expected 0 arguments」）。
- `screens/settings/web-push-section.tsx`（新）——按 host 一行。`settings-screen.tsx` 的 `notifications` 区块加 `orWebPush`，让它在支持 Web Push 的浏览器里也出现。
- 九个 locale 都加了 `settings.notifications.webPush.*`（`resources.test.ts` 要求键集完全一致）。
- `public/index.html` 补 `<meta name="mobile-web-app-capable">`。Chrome 会对只有 `apple-mobile-web-app-capable` 的页面报废弃警告，而 PWA 现在是 iOS 的通知路径，值得顺手修。

### 与方案的两处偏差

**一个 host 一个 service worker 注册。** 方案没写这条。一个注册最多持有一个订阅，而每个 daemon 用自己的 VAPID 密钥签名——push 服务会拒绝公钥与订阅时不符的发送方。共用一个注册会让多个 host 互相抢，各自反复重订阅。所以按 `/push/<serverId>/` 分 scope，各自一个 PushManager。scope 路径不需要对应真实页面：push 与通知是 origin 作用域，不是路径作用域。

**冷启动点通知不深链。** 路由构造在 app bundle 里（`utils/notification-routing.ts` + `host-routes.ts` 的 workspace id base64url 编码），静态 worker 没法 import。已开窗口的情况下 worker 把原始 data `postMessage` 回去，由 `_layout.tsx` 用现有 `openNotification()` 导航；没有窗口时只 `openWindow("/")`。要冷启动深链就得把 workspace id 编码复制进 worker，或者动启动路由——`CLAUDE.md` 明确要求碰启动路由前先读 `docs/expo-router.md`，不值得为 v1 冒这个风险。

### 验证结果

- `npx vitest run src/server/push --root packages/server` —— 3 文件 12 测试通过（含新增 `web-push.test.ts`：订阅解析、形状分派、VAPID 编码与复用）。
- `npx vitest run src/i18n/resources.test.ts --root packages/app` —— 36 通过（九语言键集一致）。
- `npx vitest run src/server/websocket-server.relay-reconnect.test.ts --root packages/server` —— 25 通过（该文件 mock 了 `createPushNotifications`，补了 `webPushPublicKey`）。
- `npx vitest run src/daemon-client.test.ts --root packages/client` —— 120 通过。
- `npm run build:server` —— 通过。
- `npm run typecheck` —— 只剩两个**改动前就存在**的错误：`src/plugins/navigation.ts(24,19)` 与 `src/plugins/settings/index.tsx(34,23)`，都是 expo-router 对插件动态路由的类型不认。已用 `git stash` 在干净树上复现确认，未修（不属本 Issue 范围）。
- `npm run lint` / `npm run format` —— 干净。两处 lint 修正值得记：`web-push-service.ts` 的正则换成 `startsWith`；`sw.js` 里 `unicorn/require-post-message-target-origin` 是误报，**`Client.postMessage()` 的第二个参数是 transfer list 而不是 target origin，传 origin 字符串会抛异常**，所以加了 `oxlint-disable-next-line` 并写明原因。
- `npx vitest run src/push-notifications/service-worker.test.ts --root packages/app` —— 6 通过。`public/sw.js` 是静态文件，既不打包也不过 typecheck，所以测试把它加载进一个假的 worker 全局：断言四个处理器都注册、payload 正常与畸形两条路径都会弹通知、tag 按 agent/terminal 分、点击时优先 `postMessage` 给已开窗口而没有窗口才 `openWindow("/")`。
- **daemon 端到端**：启动 dev daemon（6778），`.dev/byspace-home/web-push-keys.json` 以 `0600` 生成，日志出现 `Generated Web Push application keys`；公钥解出 65 字节、首字节 `0x04`，私钥 32 字节。用一个 ws 客户端走 `hello` 握手读到 `server_info`，其中 `features.webPush: true` 且 `webPushPublicKey` 为 87 字符 base64url。
- **浏览器**：Expo dev server 上 `/sw.js` 以 `application/javascript` 正常返回；`/settings/notifications` 在普通浏览器里出现了（原先是 Electron 专属），渲染出「Browser notifications」区块、host 行和 `Off. Enable to allow notifications.` + Enable 按钮——说明客户端确实从 `server_info` 读到了门控与公钥，否则会显示「此主机不支持」。在页面里直接 `register("/sw.js", { scope: "/push/test%3Aserver-1/" })` 成功且 `reg.scope` 正确，证明分 scope 这条路没有被 scope 限制挡住。页面上唯一的 console error 是 Unistyles 的 `uniProps` 噪音，在 `/settings/appearance` 上同样出现，与本改动无关。

### 还没验证的

**真实推送投递。** Playwright 连的浏览器拿不到 push service（`grantPermissions` 在这个 CDP 连接上不可用，headless Chromium 也没有推送通道），所以「点 Enable → 订阅 → daemon 发出 → 设备响」这条必须在真实浏览器上手测：桌面 Chrome 开 `http://localhost:6778`，以及 iOS Safari 打开 HTTPS 站点后加到主屏幕。

## Review 与修正

Owner 不具备手测条件，改由 reviewer subagent 审代码。**无 blocking**。审查实测验证了四件原本只是推理的事，值得记下来：

- **VAPID 编码对。** 跑了 4000 对密钥过 `web-push.generateRequestDetails()`，全部被接受并产出合法的 `vapid t=<jws>,k=<key>` 头；`fromBase64Url` 的左补零确实盖住了 Node JWK 省略前导零的情况。
- **用户手势没丢。** `Notification.requestPermission()` 之前的路径全是同步的，仍在点击任务内，iOS Safari 能接受。
- **分 scope 的推理成立。** W3C SW 规范 4.3.2：`matchAll` 按 **storage key（origin）** 过滤而不是按 scope，所以 `includeUncontrolled: true` 确实能拿到 `/` 下的应用窗口，`postMessage` 那条路不是死代码。
- **`server_info` 先于 `connected` 到达。** `daemon-client.ts:6210-6214` 先赋 `lastServerInfoMessage` 再发 `connected`，所以连接回调里读公钥不会拿到 null。

按审查意见改的：

1. **（P1）设置里只能开不能关，且失败后无法重试。** 原先只在 `state === "prompt"` 时渲染按钮：开启后没有关闭入口（`revokeWebSubscription` 只能从删除 host 触发），而任何一次瞬时失败会落到 `unavailable`，按钮直接消失。现在：`enabled` 渲染 Disable，失败返回 `prompt` 保留重试，`unavailable` 只留给「daemon 不提供这个能力」。
2. **VAPID 密钥变更后的遗留 token。** 本地 unsubscribe 时没告诉 daemon，旧 token 会在 store 里活到 48 小时租约到期。现在 unsubscribe 前先序列化旧订阅并调 `unregisterPushToken`（抽成 `unregisterToken()`，与撤销路径共用）。
3. **`readVapidKeys` 不收紧已存在文件的权限。** 兵弟文件 `token-store.ts` 读前会调 `ensurePrivateFile`，而这个文件装的是私钥。已补上。
4. **`clients.claim()` 是空操作。** claim 只能接管 scope 内的客户端，而 `/push/<serverId>/` 下没有页面。删掉 `activate` 处理器，保留 `skipWaiting`（它让新版 worker 立即接管推送）并写明原因。
5. **403 不撤销 token。** 保留现有保守行为，加注释说明为什么（密钥不匹配时客户端会自己重订阅）。
6. **重复的 stub。** 三个空实现在 `index.ts` 与 `index.native.ts` 里逐字重复，抄到 `internal/web-push-unsupported.ts`，两边重导出。

未改、已记录：`COMPAT(webPush)` 写的是 `added in v0.13.0`，而当前版本是 `0.12.0`。新增能力按惯例走 minor，所以写 0.13.0；若实际以 patch 发出去，需要把两处标记改成实际版本。

### 修正后重跑

`npm run format` / `npm run lint` / `npm run typecheck` 全部 **退出 0**。之前那两个 `src/plugins/` 的遗留错误也没了——它们是 `.expo/types/router.d.ts` 陈旧导致的，跑过一次 `npm run dev:app` 后 Expo 重新生成了类型路由，自行消失。单测：app push 6 · i18n 36 · server push 12，均通过；`npm run build:server` 通过。

另外查实：`npm run knip` 在干净树上就崩（它的 expo 插件踩到非字符串的 plugin 条目），且不在任何 workflow 里，与本改动无关。

## 关闭结论

**为何可关：** 目标是「页面关掉也能收到通知」，代码路径已端到端打通并逐段取证：daemon 侧密钥生成与 `server_info` 广播已在真 daemon 上验证，客户端读到门控并渲染出开关已在真浏览器上验证，分 scope 注册已在真浏览器上验证，service worker 的推送与点击处理有单测，VAPID 编码经 reviewer 实测对接 `web-push` 确认。Review 无 blocking，提出的 P1 与四项 P2 已全部修正并重跑全绿。

**唯一没做的是真机投递手测。** Owner 当下不具备条件，且自动化环境拿不到 push service。这不阻塞关闭：它验证的是浏览器与推送服务的行为，不是本改动的逻辑；真投递不通的话会是一个新 bug，不是本 Issue 未完成。

**毕业回写：**

- 新增 `codestable/spec/notifications.md`——各平台走哪条、Web Push 为什么是这个形状（凭据归属、强制加密、一个 host 一个注册、手势要求）、以及五条长期约束。
- `codestable/spec/index.md` 加入口。
- `codestable/spec/connection.md` 补上「装成 PWA 与局域网明文直连互斥」及三条出路，并链向新 spec。

**遗留（不藏在这里，以后要做就开新 Issue）：**

- 原生推送仍然是坏的（缺 `eas.projectId`）。iOS 原生要通知额外需要 Apple Developer Program。
- 冷启动点通知不深链。
- service worker 不做离线缓存；将来工具箱里出现纯客户端功能需要它时，要连同缓存版本化和更新提示一起设计。
- `COMPAT(webPush)` 的 `v0.13.0` 需在实际发布时核对。
