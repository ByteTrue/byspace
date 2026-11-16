# 调试 daemon 相关问题时，先确认进程加载的是 src 还是 dist

> **读者：** 半年后调试「daemon 行为和源码对不上」或「e2e 里 daemon 连接静默挂死」的人。
> **自检：** 一句话结论 · 触发场景 · 细节/步骤/坑 · 相关 issue/spec/代码位置。

---

**结论：** 改了 `packages/server` 源码后，凡是不走 vitest 的路径（supervisor 启动的 daemon、e2e isolated daemon、探针脚本）默认加载 `packages/server/dist`——必须先 `npm run build`（server workspace）再复现，否则跑的是旧代码、症状指向错方向。同理，`packages/client/dist` 被 e2e 的 daemon-client-loader 动态 import，改 client 后要 `npm run build:client`。另一个独立坑：自写 WebSocket factory 必须转发 `protocols` 参数，否则连接带密码的 daemon 时被拒且 DaemonClient 静默无限重连。

**何时用：**

- 改了 server/client 源码后跑 e2e（`packages/app/e2e`）或 spawn 真实 daemon 复现问题。
- daemon 的行为与新写的代码不一致（比如新 RPC 报"不存在"或走到旧分支）。
- 用 `ws` 库自写 factory 连 BySpace daemon（尤其 daemon 设了密码）。

**细节：**

- **加载优先级：** `packages/server/scripts/supervisor-entrypoint.ts` 的 `resolveWorkerEntry` 依次探测 src-adjacent js → **dist** → src ts；dist 存在即胜出。e2e 的 isolated daemon（`packages/app/e2e/support/helpers/isolated-host-daemon.ts`）spawn supervisor（tsx），但 supervisor 内部 spawn worker 时仍选 dist。所以 vitest（走 src import）通过 ≠ 真实进程通过。
- **症状特征：** 新 RPC 的 schema 校验通过、错误文案却是旧分支的（如 issue 062 的 "This daemon has no tunnel manager"）；或 dist 里根本没有新模块。快速验证：`grep '<新标识>' packages/server/dist/server/server/<模块>.js`，命中为 dist 新；再对照进程行为。
- **protocols 坑：** `ws` 的 `new WebSocket(url, { headers })` 第二参是 protocols 数组，传 options 对象会被当成 protocol 列表（或丢失）。daemon 设密码后要求 `byspace.bearer.<password>` subprotocol（`websocket-server.ts` 的 `selectWebSocketProtocols`），factory 不转发 protocols → 连接被拒 → DaemonClient 内部重连循环**不抛错**，外层 await 永远挂住，且 daemon.log 只有 "Rejected WebSocket connection with invalid daemon password"。修法见 `packages/app/e2e/support/helpers/node-ws-factory.ts`：`new WebSocket(url, options?.protocols ?? [], { headers })`。
- **诊断顺序：** ① tail 对应 BYSPACE_HOME 的 daemon.log（e2e 临时 home 在 `$TMPDIR/byspace-e2e-secondary-host-*`，目录按轮次新建）；② 检查 dist 时间戳与内容；③ 给挂住的连接加超时，别让它无声吃掉整个测试时限。

**相关：** issue 062（`byissue/issues/062-x-daemon-tunnel.md`）批次 3 执行记录；AGENTS.md「Build workspace packages before diagnosing cross-package type errors」条款是同一原则的类型错误版。
