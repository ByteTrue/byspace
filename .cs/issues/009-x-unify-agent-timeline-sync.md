---
kind: issue
title: "收敛 Agent Timeline 同步所有权"
type: refactor
status: closed
created: 2026-07-29
epic: ""
---

# 收敛 Agent Timeline 同步所有权

## 目标

将 Agent Timeline 的请求、并发仲裁、响应应用与同步状态收敛到每个 Host 一个 owner。窗口恢复、重显 Workspace、初始化、gap recovery、手动刷新、rewind 与旧历史分页必须共享可证明的顺序规则；不能继续依赖局部的“最新请求胜出” gate。

## 背景

Issue 008 证明了保留 subscription 不代表 live 消息完整，并建立了窗口 focus 与 retained Workspace 的真实浏览器恢复用例。但它引入的 viewed-only request gate 只覆盖一类 forward fetch，而初始化、older、reload、rewind 仍由不同调用方发请求，最终共享 SessionContext 的全局响应入口。

daemon 的请求处理包含异步等待，因此请求发出顺序不等于 Timeline 快照新旧顺序。旧请求响应可能仍包含有用的缺失 row；`tail`、`after`、`before` 与 epoch reset 也不能互相按 request serial 覆盖。

## 不变量

- daemon committed Timeline 是完整性来源；live stream 只负责低延迟展示。
- selective subscription 只控制 push membership，不证明消息完整。
- 每个 Host 只有一个 Timeline 请求 owner；React 只报告可见性和用户意图。
- forward 与 older 是独立 lane：older 不完成初始化或 forward ready，forward 不取消有效的 before page。
- response request ID 只做 correlation；数据是否可合并由 epoch、cursor、sequence range 与当前 replica 决定。
- 较早请求的有效 canonical row 可以补入；它不能完成较新的控制 intent，也不能让 cursor、pagination metadata 或 epoch 回退。
- 同 agent 的 live reducer queue 在应用 authoritative page 前 flush。
- 可见恢复立即发 authoritative fetch；相同形状的旧请求不能阻塞它。
- Host 断线、重连、reconcile server ID 与 dispose 会终止旧连接的控制状态和响应应用权。

## 范围

- 复用现有 `viewed-timeline-sync.ts` membership/catch-up state machine。
- 复用 `session-stream-reducers.ts` canonical/live reconciliation。
- 将 owner 生命周期移到 Host runtime / DirectorySync。
- 初始化、refresh、reload、rewind、older pagination 全部路由到 owner。
- 删除 viewed-only request gate 与跨 owner transport dedupe。
- 不重写 AgentStreamView、virtualizer 或 daemon Timeline 协议。

## 验收场景

- 首次 tail 在途时 window focus/foreground，恢复 intent 不丢失。
- 两个 forward response 反序到达，有用 row 可合并，控制状态不被旧 response 完成。
- 新 forward 请求失败后，旧请求的有效 response 仍可提供数据。
- older 与 forward 并发时互不取消，`startSeq/endSeq/hasOlder` 保持一致。
- epoch rollover 与旧 epoch response 反序时不会回退 replica。
- 断线重连或 SessionProvider 重挂载后，旧连接 response 不再应用。
- focus 与 retained Workspace E2E：1 秒内发请求，2 秒内显示 daemon 已提交但 live 漏送的消息。

## 验证

- Timeline owner、canonical reducer、visibility policy、Directory/Host 集成、初始化与 older 分页目标单测：8 files / 210 tests 通过。
- 真实 Desktop Chrome：`viewed-agent-timelines.spec.ts` 6/6 通过，覆盖 focus、retained Workspace、双 pane、grace 取消订阅与重连；恢复用例要求 1 秒内请求、2 秒内显示遗漏消息。
- `npm run typecheck`、`npm run lint`、`npm run format:check`、`git diff --check` 全部通过。
- `npm run build --workspace=@bytetrue/byspace-app` Web export 通过。
- 三轮独立 reviewer 发现的协议 error 就绪误判、epoch supersede 无重试、初始化 ID 残留、测试形态违规与旧连接测试未消费 rejection 均已修复；最终没有未解决的 blocker/high/medium。

## 关闭结论

Agent Timeline 现在由每个 Host 的单一 owner 管理。React 只发布可见 agent 与 browser activation；初始化、恢复、gap、显式 refresh、rewind/reload 和 older 分页共用同一个请求登记与响应应用边界。forward/older lane 独立，旧连接与旧 daemon epoch 不能回退 replica，较早响应中的有效同 epoch row 仍可按 sequence ranges 合并，协议 error 不会被误判为 ready。原 viewed-only request gate 与跨 owner dedupe 已删除，渲染层和 daemon 协议未重写。

稳定的产品真相已毕业到 `.cs/spec/index.md` 的“Agent 聊天完整性”；实现细节与并发不变量保留在 `docs/timeline-sync.md`。没有遗留 blocker/high/medium，也没有需要另开 issue 的已知缺口。
