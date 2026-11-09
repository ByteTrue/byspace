# Schedules

定时任务和 heartbeat 都由 daemon 执行，不依赖 App 页面保持打开。cron 按任务时区计算下次运行；未指定时区使用 UTC。手动 Run now 不推进下次运行时间，也不占用最大运行次数。

## Agent 任务

每次运行使用任务配置的 provider、模型、模式和思考档，并创建自己的 workspace：local 隔离是在同目录创建独立 workspace，worktree 隔离是创建 BySpace 管理的 worktree。运行结束后按 `archiveOnFinish` 归档本次 workspace，不归档项目原有的主 workspace。

运行记录从启动时就关联本次 workspace 和 agent，agent ID 使用 UUID，保证运行历史能被新旧客户端读取。daemon 重启时把中断的运行记为失败并清理其 workspace，错过的时段不补跑，直接计算下一次运行。

## Heartbeat

Heartbeat 把提示词送回目标 agent。目标 agent 被归档或不存在时，heartbeat 结束，不能继续向一个不可达目标发送。Agent 用 `byspace schedule` / `byspace heartbeat` 管理自己的 heartbeat 和 schedule，不能操作其他 agent 的 heartbeat。
