# 移植进度

一行一个文件。`结论` 只用 spec 里定义的四个值。

格式：`| 文件 | 结论 | Go 实现 | 测试 | 备注 |`

## 批次 1：tunnel（777 行）

| 文件                                            | 结论   | Go 实现                                                   | 测试                                                    | 备注                                                                                                                                                                                                |
| ----------------------------------------------- | ------ | --------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/tunnel-manager.ts` (567)                | PORTED | `internal/tunnel/{frame,peer,manager,relaypeer}.go`       | `frame_test.go`、`manager_test.go`、`relaypeer_test.go` | 帧编解码、本地 listener、字节泵、半关闭、peer 替换断开旧流、relay client（role=client + E2EE 发起方 + 退避重连）。未经真机验证的部分：relay 配对路径只断言了 URL 形状，等两个真实 daemon 跑起来再验 |
| `server/tunnel-registry.ts` (210)               | PORTED | `internal/tunnel/registry.go`                             | `registry_test.go`                                      | 6 个用例：文件 0600、坏文件容错、门控即 kill switch（端口重绑定证明释放）、删除持久化、Add 校验、状态聚合                                                                                           |
| `server/session/tunnel/tunnel-session.ts` (552) | PORTED | `internal/tunnel/target.go`、`internal/server/tunnels.go` | `target_test.go`、`internal/server/tunnels_test.go`     | D2 侧：三道门（特性门控、密码、白名单）+ 拨号 + 双向字节泵；RPC 已接真实实现（list/open/close/stats/create/remove）。二进制帧分发修了：tunnel opcode 在 terminal 之上，之前会被当坏 slot 静默丢弃   |
| `cli/ssh/ssh-tunnel.ts` (90)                    | PORTED | `internal/ssh/{parse,tunnel}.go`                          | `ssh_test.go`（6 用例）                                 | `ssh://` URI 解析与校验（含 option 注入）、`ssh -W` stdio 转发、非交互选项。**未接进 CLI 的 `-H` 参数**，下一步做                                                                                   |

## 批次 2：service-proxy（1513 行）

| 文件                                              | 结论               | Go 实现                                                                                | 测试                                        | 备注                                                                                                                                                                       |
| ------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/service-proxy.ts` (1039)                  | PORTED             | `internal/serviceproxy/{hostname,proxy}.go`、`internal/server/service_proxy_wiring.go` | `proxy_test.go`（8 用例，含真实 HTTP 往返） | 主机名规则（脚本·分支·项目、DNS 上限、重音分解）、按 Host 路由的反向代理、WebSocket 透传、Host 保留。已接进 daemon：脚本启动注册路由、停止注销、payload 带 hostname 与 URL |
| `server/script-health-monitor.ts` (229)           | PORTED             | `internal/serviceproxy/health.go`                                                      | `health_test.go`（5 用例，含真实端口探测）  | 两次失败才 unhealthy（一次是抖动）、宽限期内不探测、只在变化时广播、路由消失时清理状态                                                                                     |
| `server/workspace-service-port-registry.ts` (245) | PORTED（此前已有） | `internal/server/script_ports.go`                                                      | `script_ports_test.go`                      | 端口分配器（固定/范围/脚本三策略）、按 (workspace, script) 稳定分配、显式请求冲突检测                                                                                      |

## 批次 3：agent-hooks（448 行）

| 文件                                                    | 结论   | Go 实现                                          | 测试                        | 备注                                                   |
| ------------------------------------------------------- | ------ | ------------------------------------------------ | --------------------------- | ------------------------------------------------------ |
| `terminal/agent-hooks/claude/claude.ts` (48)            | PORTED | `internal/agenthooks/provider.go`、`registry.go` | `install_test.go`（8 用例） | 事件到状态映射、config-file 安装策略                   |
| `terminal/agent-hooks/claude/claude-settings.ts` (117)  | PORTED | `internal/agenthooks/provider.go`                | `install_test.go`（8 用例） | JSON 合并：保留用户 hook、按 marker 过滤、坏文件不覆盖 |
| `terminal/agent-hooks/codex/codex.ts` (32)              | PORTED | `internal/agenthooks/registry.go`                | `install_test.go`（8 用例） | 5 个事件（含 PermissionRequest → needs-input）         |
| `terminal/agent-hooks/codex/codex-settings.ts` (143)    | PORTED | `internal/agenthooks/provider.go`                | `install_test.go`（8 用例） | 同 claude 的合并语义，写 `~/.codex/hooks.json`         |
| `terminal/agent-hooks/opencode/opencode.ts` (25)        | PORTED | `internal/agenthooks/registry.go`                | `install_test.go`（8 用例） | 5 个 session/permission 事件                           |
| `terminal/agent-hooks/opencode/opencode-plugin.ts` (83) | PORTED | `internal/agenthooks/plugin.go`                  | `install_test.go`（8 用例） | 插件文件安装、拒写非我所写的同名文件、报告串行化       |

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
