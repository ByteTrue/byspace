# 移植进度

一行一个文件。`结论` 只用 spec 里定义的四个值。

格式：`| 文件 | 结论 | Go 实现 | 测试 | 备注 |`

## 批次 1：tunnel（777 行）

| 文件                                            | 结论             | Go 实现                                   | 测试                                                            | 备注                                                                                                                          |
| ----------------------------------------------- | ---------------- | ----------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `server/tunnel-manager.ts` (567)                | PORTED（进行中） | `internal/tunnel/{frame,manager,peer}.go` | `frame_test.go`、`manager_test.go`（6 个用例，含真实 TCP 往返） | 帧编解码、本地 listener、字节泵、半关闭、peer 替换断开旧流、Close 释放端口已实现并验证。**未做**：D1→D2 的 relay 客户端与重连 |
| `server/tunnel-registry.ts` (210)               | 待做             | —                                         | —                                                               | —                                                                                                                             |
| `server/session/tunnel/tunnel-session.ts` (552) | 待做             | —                                         | —                                                               | —                                                                                                                             |
| `cli/ssh/ssh-tunnel.ts` (90)                    | 待做             | —                                         | —                                                               | —                                                                                                                             |

## 批次 2：service-proxy（1513 行）

| 文件                                              | 结论 | Go 实现 | 测试 | 备注 |
| ------------------------------------------------- | ---- | ------- | ---- | ---- |
| `server/service-proxy.ts` (1039)                  | 待做 | —       | —    | —    |
| `server/script-health-monitor.ts` (229)           | 待做 | —       | —    | —    |
| `server/workspace-service-port-registry.ts` (245) | 待做 | —       | —    | —    |

## 批次 3：agent-hooks（448 行）

| 文件                                                    | 结论 | Go 实现 | 测试 | 备注 |
| ------------------------------------------------------- | ---- | ------- | ---- | ---- |
| `terminal/agent-hooks/claude/claude.ts` (48)            | 待做 | —       | —    | —    |
| `terminal/agent-hooks/claude/claude-settings.ts` (117)  | 待做 | —       | —    | —    |
| `terminal/agent-hooks/codex/codex.ts` (32)              | 待做 | —       | —    | —    |
| `terminal/agent-hooks/codex/codex-settings.ts` (143)    | 待做 | —       | —    | —    |
| `terminal/agent-hooks/opencode/opencode.ts` (25)        | 待做 | —       | —    | —    |
| `terminal/agent-hooks/opencode/opencode-plugin.ts` (83) | 待做 | —       | —    | —    |

## 批次 4：self-update 与 directory-sync（453 行）

| 文件                                                                   | 结论 | Go 实现 | 测试 | 备注 |
| ---------------------------------------------------------------------- | ---- | ------- | ---- | ---- |
| `server/session/daemon/daemon-self-update-session-controller.ts` (138) | 待做 | —       | —    | —    |
| `server/directory-sync/internal/versioned-collection.ts` (141)         | 待做 | —       | —    | —    |
| `server/directory-sync/*`                                              | 待做 | —       | —    | —    |

## 批次 5：quota 6 家（~1500 行）

| 文件                                                | 结论 | Go 实现 | 测试 | 备注 |
| --------------------------------------------------- | ---- | ------- | ---- | ---- |
| `services/quota-fetcher/providers/claude.ts` (480)  | 待做 | —       | —    | —    |
| `services/quota-fetcher/providers/copilot.ts` (97)  | 待做 | —       | —    | —    |
| `services/quota-fetcher/providers/cursor.ts` (250)  | 待做 | —       | —    | —    |
| `services/quota-fetcher/providers/grok.ts` (181)    | 待做 | —       | —    | —    |
| `services/quota-fetcher/providers/kimi.ts` (342)    | 待做 | —       | —    | —    |
| `services/quota-fetcher/providers/minimax.ts` (275) | 待做 | —       | —    | —    |

## 批次 6：复核上一轮只「读导出面」的部分

`commands/**`（约 40 个）、`utils/**`（6 个）——上一轮按「导出面 + 调用点」判定，本轮逐个核对实现细节。
