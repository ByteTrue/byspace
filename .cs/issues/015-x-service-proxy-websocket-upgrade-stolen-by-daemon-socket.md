---
id: 015
type: bug
status: closed
epic: null
created: 2026-08-02
---

# 服务代理转发的 WebSocket 升级被 daemon 自身的 /ws 抢走

## 现象

用户通过服务代理访问工作区的 dev server（`http://app--<workspace>--byspace-<hash>.localhost:6777`）时，页面每 ~400ms 整页重载一次，永远进不去。daemon 日志表现为客户端反复"连上还没 hello 就 1001 断开"（30s 内 `connectedAwaitingHello: 13`、`helloNew: 0`），Metro 侧则反复打印增量 bundle 日志。

## 证据

只读复现，同一个 Metro、同一份 bundle，两个入口对比（Playwright 只加载页面，不做交互）：

- 直连 Metro `http://localhost:50876`：12s 内 4 次导航（`/` → `/open-project` 的正常落定），无异常。
- 走服务代理：12s 内 **28 次导航**，并反复报
  `WebSocket connection to 'ws://…/hot' failed: handshake 400`、`ws://…/message` 同样 400。

HTTP 层坐实（curl 手写升级请求）：

| 目标                                 | 结果                                                               |
| ------------------------------------ | ------------------------------------------------------------------ |
| Metro 直连 `/hot`                    | `101 Switching Protocols`                                          |
| Metro 直连 `/hot`，Host 改成代理子域 | `101`（Metro 不看 Host）                                           |
| 经代理 `/hot`                        | `400 Bad Request`，`Content-Type: text/html`，`Content-Length: 11` |
| 经代理 `/message`                    | 同上                                                               |
| 经代理普通 GET                       | `200`（HTTP 路径正常）                                             |

`Content-Length: 11` + `text/html` 是 `ws` 库 `abortHandshake(socket, 400)` 的固定响应，说明 400 由 daemon 自己产生，请求根本没到 Metro。

## 根因

`bootstrap.ts` 在 HTTP server 上注册了服务代理的 upgrade 监听器，`websocket-server.ts` 随后用 `new WebSocketServer({ server, path: "/ws" })` 让 `ws` 库**也**注册了一个 upgrade 监听器。Node 会把 upgrade 事件派发给**所有**监听器，而 `ws` 的 `handleUpgrade` 对 `shouldHandle(req) === false`（路径不是 `/ws`）的请求直接 `abortHandshake(socket, 400)`（`node_modules/ws/lib/websocket-server.js:277`）。

代理监听器虽然注册在先，但它要 `net.connect` 到上游、在回调里才写数据；`ws` 的拒绝是同步的，**必然赢**。于是任何经代理的、路径不是 `/ws` 的 WebSocket 升级都被 daemon 自己回了 400。

dev server 的 HMR 通道属于此类（Metro 用 `/hot` 与 `/message`），而 HMR 握手失败对 dev client 不是"降级"——它会整页重载重试，于是形成死循环。

## 修复

新增 `packages/server/src/server/upgrade-routing.ts`：一个 upgrade 升级的归属约定 + 路由器。

- 服务代理在决定转发时调用 `markUpgradeClaimed(req)`。
- daemon 的 WebSocket server 改为 `noServer: true`，并通过 `attachDaemonUpgradeRouting` 注册唯一的路由监听器：**先看归属，再看路径** —— 已被代理认领的直接放行；否则路径等于 `/ws` 时交给 daemon 自己的握手；都不是则回 `400`（与 `ws` 原来的行为一致，避免 socket 悬挂）。

"先归属后路径"不是可选项：Vite 的 HMR 通道就是 `/ws`，若先判路径，工作区服务的 `/ws` 会被 daemon 抢走。变异验证：把两个判断调换顺序，`leaves a workspace service's /ws to that service` 立即失败。

`verifyClient` 与 `handleProtocols` 在 `noServer` 下仍由 `handleUpgrade` 调用（`ws` 在 `completeUpgrade` 前检查），认证与来源校验不变。

## 验证

- 新增 `packages/server/src/server/upgrade-routing.test.ts`（真 http 上游 + 真 `ws` + 真代理子系统，注册顺序与 bootstrap 一致）4 例：`/hot` 转发到上游、daemon `/ws` 仍能握手并收消息、工作区服务的 `/ws` 归服务、无人认领的升级仍回 400。修复前因模块不存在而红，修复后 4/4 绿。
- `service-proxy` / `script-proxy` / `upgrade-routing` / 三个 `websocket-server.*` 测试文件合计 57/57 通过。
- 三个 websocket-server 测试文件此前用空的 `createStub<HTTPServer>({})`，现在 daemon 会在 HTTP server 上注册监听器，故补上 `on: vi.fn()`。
- typecheck / lint / format:check 全绿；`terminal-stuck-size` e2e（真 daemon 真 `/ws`）通过。

## 备注

- 用户机器上的主 daemon（6777）需要用户自己重启才会生效；代理是主 daemon 提供的。
- 该缺陷与终端 013/014 无关，是在 013 验收过程中顺手发现的。
