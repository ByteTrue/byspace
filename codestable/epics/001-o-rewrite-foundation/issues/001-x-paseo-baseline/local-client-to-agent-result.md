# Web/CLI 的一次请求如何变成 Agent Timeline

## 一句话模型

Web 或 CLI 完成 daemon hello 后发送带关联 ID 的 JSON 请求；daemon session 把它路由到 Agent manager，provider adapter 驱动本机 Agent 进程，manager 再把用户输入、流式事件、工具调用和结束状态写成 canonical Timeline 并推送给所有订阅客户端。

## 从连接到可观察结果

Web 的每个已保存主机都有自己的 runtime 和 `serverId`。它通过 `packages/client` 建立 WebSocket；CLI 使用相同 daemon 协议，但还负责从参数、环境、配置、本地 IPC 或 pairing offer 中选择目标。连接首先进行 hello、身份与能力协商，此后一个物理 socket 复用相关请求/响应和非请求触发的状态、目录与 Timeline 推送。

创建 Agent 时，daemon 根据项目、workspace、cwd、provider 和模型配置建立持久身份。Agent manager 而不是 provider adapter 拥有创建、恢复、中止、关闭、权限等待和 Timeline 投影。这个所有权使 Web 刷新、多个客户端观察以及 provider 重启不会直接绑定某一种上游事件格式。

Pi adapter 启动 `pi --mode rpc`，通过 stdin/stdout 的逐行 JSON 发送 prompt、abort、state/history 等请求，接收文本、思考、工具生命周期、压缩、重试和扩展 UI 事件。adapter 把已认识的事件映射到公共 Agent 语义；未知 Pi 事件必须被记录或忽略，不能击穿整个 daemon。

客户端通过 live 推送看到流式变化，也能按 cursor 重新获取 Timeline。重新连接时，以 daemon 的 canonical 投影校准本地 replica；缓存键必须包含主机和 workspace 身份，不能把两台机器的同名项目合并。

## Go 重写必须守住什么

- hello、server-info、请求关联、错误边界、心跳与 backpressure 是所有功能的底层契约。
- Agent manager 与 provider adapter 分层：Pi session handle 不能成为产品 Agent ID，Pi 事件不能成为公共 Timeline 类型。
- 持久化写入需要原子性；daemon 重启后恢复的是可解释状态，而不是伪造仍在运行的进程。
- 尚未实现的功能通过 capabilities 声明，不通过删除协议或前端模型伪装不存在。
- CLI 与 Web 应能观察同一事实源；CLI daemon stop 只终止自己拥有的进程。

## 证据入口

- `docs/architecture.md`
- `docs/data-model.md`
- `docs/providers.md`
- `packages/protocol/src/`
- `packages/client/src/`
- `packages/server/src/server/websocket-server.ts`
- `packages/server/src/server/session.ts`
- `packages/server/src/server/agent/agent-sdk-types.ts`
- `packages/server/src/server/agent/providers/pi/`
- `packages/cli/src/utils/client.ts`
- `packages/cli/src/commands/daemon/local-daemon.ts`
