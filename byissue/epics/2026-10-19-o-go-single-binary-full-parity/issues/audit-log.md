# Node → Go 逐文件审计台账

对应 Issue：`2026-10-20-o-line-by-line-node-audit.md`

结论口径：`PORTED`（有等价实现）/ `PARTIAL`（有但缺分支）/ `MISSING`（没有）/ `DROPPED`（决定不做）/ `N/A`（无运行时行为）。
每条都写证据位置，不带证据的结论视为未审计。

---

## 批次 1 · `archive/packages/server/src/server/` 顶层（76 文件）

### 已审计

| 文件                                 | 行数 | 结论               | 证据 / 缺口                                                                                                                                                                                                                                                                                              |
| ------------------------------------ | ---- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `service-proxy.ts`                   | 1039 | **MISSING**        | Go 无 HTTP/WS 反代。需要：脚本端口注册表、`<script>--<workspace>.<baseDomain>` 主机名路由、本地/公网 URL 投影、health 探测。`internal/relay` 只有 E2EE 中继，不是这个。                                                                                                                                  |
| `script-health-monitor.ts`           | 229  | **MISSING**        | 依赖 service-proxy，用于探测脚本存活并回调。Go 无对应。                                                                                                                                                                                                                                                  |
| `workspace-service-port-registry.ts` | —    | **MISSING**        | 脚本端口分配/回收。`workspace.script.start` 现在直接跑命令，不分配端口。                                                                                                                                                                                                                                 |
| `workspace-setup-runtime.ts`         | —    | **PARTIAL**        | Go 有 `internal/server/ws_plugin_setup.go` 跑 `byspace.json` 的 setup，但缺：阶段划分、`blocked` 状态与 `blockedSource`、change-request 门禁、`workspace_setup_progress` 的 `truncated` 之外的字段。                                                                                                     |
| `workspace-script-runtime-store.ts`  | —    | **PARTIAL**        | Go 有 `workspaceScripts` 内存表 + `script_status_update`，但无持久化、无端口、无健康状态。                                                                                                                                                                                                               |
| `daemon-config-store.ts`             | 1199 | **PARTIAL**        | Go `store.LoadDaemonConfig/SaveDaemonConfig` 读写嵌套 `{version,daemon:{...}}`；缺 `agentProfiles` 增删改查、`providers` 的 profiled 配置校验、迁移路径。                                                                                                                                                |
| `session.ts`                         | 7773 | **PARTIAL**        | 158 个消息 case 全部路由（协议 171 条入站全覆盖），但深度不一。详见下方「session.ts 逐 case」。                                                                                                                                                                                                          |
| `websocket-server.ts`                | 2771 | **PARTIAL** → 已补 | 连接生命周期。审计发现并修复：hello 超时（Node 15s/4001，Go 原本没有，半开连接会永久占坑）、shutdown 广播（Node 发 1001，Go 没有，重启时客户端只看到静默断开）、close code 数值对齐（Go 用 4400/4402，Node 用 4003/4002）。仍缺：外部会话 90s 宽限期重连（`externalSessionsByKey`）、运行指标 30s 刷写。 |

### session.ts 已确认的实现缺口

| Case                          | Node 行为                              | Go 现状                                                     |
| ----------------------------- | -------------------------------------- | ----------------------------------------------------------- |
| `workspace.script.start/stop` | 分配端口、注册 proxy 路由、健康探测    | 直接 `/bin/sh -lc` 跑命令，无端口/proxy（见 service-proxy） |
| `workspace.setup.run`         | 阶段化执行 + blocked 判定              | 逐条执行 + 日志，无 blocked                                 |
| `agent.skills.*`              | SHA-256 比对 + 事务写入 + 回滚         | 只读扫描 + 三态判断，无 add/update/delete                   |
| `agent.rewind`                | 文件快照回滚（conversation/code/both） | 返回 `ok:true` 占位                                         |
| `provider.usage.list`         | 8 家厂商真实抓取                       | 返回空数组                                                  |
| `hub.*`                       | Hub 远控                               | `not_connected` 占位                                        |

### 未审计（本批剩余 69 文件）

按行数排序，下一轮从这里继续：

`websocket-server.ts` 2771 · `bootstrap.ts` 1883 · `workspace-git-service.ts` 3601 ·
`worktree-bootstrap.ts` 1101 · `worktree-session.ts` 929 · `workspace-reconciliation-service.ts` ·
`workspace-archive-service.ts` · `workspace-auto-name.ts` · `workspace-bootstrap-dedupe.ts` ·
`workspace-source.ts` · `agent-history-search.ts` · `checkout-diff-manager.ts` ·
`resolve-workspace-id-for-path.ts` · `persisted-config.ts` · 以及其余 55 个。

---

## 批次 2-9

未开始。范围见 Issue。
