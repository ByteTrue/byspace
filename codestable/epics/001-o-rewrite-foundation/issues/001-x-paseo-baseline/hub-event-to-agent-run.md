# Hub 的外部事件如何变成主机上的 Agent 执行

## 一句话模型

人类先由 CLI 向一个确定 Hub origin 登录并申请一次性 enrollment token，再把 token 交给本地 daemon；daemon 生成并只在本机保存自己的关系密钥，直接连接 Hub，随后 Hub 只能通过 grant 限制的 `hub.execution.*` 会话请求 daemon 创建和观察执行。

## 两种身份不能混用

CLI 的 Hub 登录代表人和组织，用于管理项目、配置、部署 workflow 和发起 enrollment。daemon relationship 是另一套身份：CLI 不把长期人类凭据交给 daemon，只传一次性 token；daemon 生成 relationship secret，并向 Hub 提交 verifier。撤销、重连和凭据轮换围绕这条 daemon-owned 关系进行。

Hub origin 对凭据作用域严格。现有规则要求公开环境使用 HTTPS，返回的 daemon WebSocket 与 Hub HTTP origin 同 host。这意味着 `hub.byspace.cc.cd` 最适合同时承载 dashboard、API、enrollment、webhook 和 daemon WebSocket；不要无证据地拆成 `api.*` 与 `worker.*`。

## 从外部 trigger 到结果

GitHub、Slack 或 Discord 事件先到 Hub。Hub 负责组织和项目配置、provider app 凭据、workflow 选择、重试和回复权限，然后选择一个已授权 daemon relationship 发出执行。daemon 为执行建立受控 workspace/Agent，拥有本地文件、provider 凭据、运行过程与归档；Hub 通过窄协议观察状态并接收结果。

这条路径不经过 Relay。Relay 解决客户端到 daemon 的不可信传输；Hub 是拥有组织、workflow 和外部 provider 状态的可信服务。多主机 UI 也不是 Hub 的替代品。

## 源码边界

Paseo monorepo 只包含 daemon 一侧的 relationship/execution controller、协议和 CLI Hub 命令。Hub 服务、dashboard、数据库和 provider integrations 位于外部 `getpaseo/hub` 仓库，可通过 `@getpaseo/hub` 或容器运行，并使用嵌入式存储或 PostgreSQL。

保留 Hub 因此至少需要：

- Go daemon 实现 relationship、enrollment、grant 和 execution RPC；
- CLI 实现 exact-origin 登录、connect/revoke、项目/配置/workflow 等命令；
- byspace 拥有一个可部署 Hub 服务路径，并验证 GitHub/Slack/Discord 连接；
- 明确是 fork/adapt 外部 Hub 还是重写，而不是从 monorepo 的客户端代码猜服务端。

Cloudflare 可为 Hub 提供 DNS、TLS、WAF 与反向代理，但现有 Hub 有 PostgreSQL、长连接及 Slack/Discord gateway 进程，首版不应假定它能直接改造成纯 Worker。

## 证据入口

- `docs/hub.md`
- `public-docs/hub/`
- `packages/server/src/server/hub/relationship-remote.ts`
- `packages/server/src/server/hub/relationship-controller.ts`
- `packages/server/src/server/hub/daemon-executions.ts`
- `packages/server/src/server/hub/execution-session.ts`
- `packages/cli/src/commands/hub/`
- 外部来源：`https://github.com/getpaseo/hub`
