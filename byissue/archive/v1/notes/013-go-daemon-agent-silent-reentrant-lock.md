---
kind: note
title: "Go daemon 里「agent 接受 prompt 后毫无反应」= 事件处理里重复加锁；定位靠协议 trace 而不是猜"
created: 2026-10-21
---

# 重复加锁死锁：agent 静默

## 症状

`create_agent_request` 带 `initialPrompt` 后，客户端只看到 `turn_started` + 一条
`user_message`，之后**什么都没有**：没有 `thinking`、没有 `text_delta`、没有 `tool_call`、
没有 `turn_completed`。**没有任何错误**，agent 记录里 `lastStatus` 停在 `running`。

浏览器里表现为「发完消息一直转圈」，CLI 里表现为 `byspace wait` 挂到自己的超时。

## 根因

`internal/agent/pi/pi.go` 的 `handleRawEvent` 在**持有 `s.mu` 的情况下**处理每个 pi 事件，
而它调用的 `handleEntryCaptureNotification` / `handleCommandResultNotification`
（`internal/agent/pi/rewind.go`）内部又 `s.mu.Lock()`。Go 的 `sync.Mutex` 不可重入 →
stdout 读循环永久死锁。

触发条件很窄：pi 扩展必须在 `session_start` 时发一条 `BYSPACE_ENTRY_CAPTURE`。
没有扩展就不会重入锁，所以是「无扩展 → 有响应，有扩展 → 静默」。

## 为什么难查

**pi 子进程行为完全正常。** trace 显示 `agent_start`、`message_update`（230 条）、
`turn_end`、`agent_end` 全部到达、顺序正确、内容完整。只有 Go 不再读下一行。
从外部看这就是「代理接受了 prompt 然后什么都不做」——和「模型很慢」无法区分。

我在这上面先后猜错了四个方向（`syncPiPersistence` 抢跑、缺 ready 握手、进程组、
MCP 注入），每一个都改了几行代码，每一次都没解决。这些都是**在猜测下动代码**。

## 有效的定位路径

1. **先造观测**：给 `jsonl.Process` 加持久化协议 trace（`BYSPACE_PI_TRACE=<path>`，
   见 `internal/agent/jsonl/trace.go`）。两个方向每一帧都带毫秒时间戳写入文件。
   **不能用 stderr**——daemon 自己的日志会与之交错，而且崩溃时 trace 会被截断。
2. **确认哪一侧出的问题**：trace 里有完整事件序列 ⇒ pi 没问题，问题在 Go。
3. **用现成的替换点二分**：`BYSPACE_PI_EXTENSION_PATH` 可以把扩展换成任意文件，
   于是「有扩展 / 无扩展」一次就能测出来。
4. **拆到最小片段**：`session_start` + 发 `BYSPACE_ENTRY_CAPTURE` → 阻塞；
   同一钩子发普通文本 → 正常。到此锁定为「标记 + 回环处理」的组合，而不是扩展本身。

总耗时从「改了四处仍无结论」变成「两步定位」。

## 守卫

`TestExtensionNotificationDoesNotDeadlock`：持锁调用 `handleExtensionNotification`，
3 秒超时。已验证把双重加锁放回去会 `panic: test timed out`。

**写这类测试时必须带超时**：死锁的默认表现是测试挂死（要等 `-timeout`），
而挂死的 CI 比失败的 CI 难处理得多。

## 一般化的规则

- **在持锁的函数里调用任何「可能自己加锁」的 helper 都是 bug**，尤其是从事件回调
  进到处理函数这一层。命名上加 `Locked` 后缀（如 `appendItemLocked`）是有用的约定，
  但这次两个 handler 名字里没有，就没有人发现。
- **一个事件处理器持有 session 锁长达整轮对话**本身也值得怀疑：读循环被业务逻辑阻塞，
  任何慢操作都会变成「agent 无响应」。更安全的形状是读循环只做派发，处理在锁外。
  这一条没有在本轮改（改动面大），记在这里。

## 顺带修掉的两个相关缺陷

- **`PI_SESSION_FILE` 等 pi 会话身份泄漏**（见
  `2026-10-21-pi-child-process-environment.md`）。
- **`syncPiPersistence` 抢跑**：agent 启动时立即发 `get_state`，而 pi 在 runtime 就绪前
  不响应，请求堵在 stdio 队列里。改为等 `Session.Ready()`。
