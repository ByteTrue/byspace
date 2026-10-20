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

| `workspace-git-service.ts` | 3601 | **PARTIAL** → 已补推送 | Go 有 `internal/workspace/git.go` 的读侧（status/diff/commits/forge）与 `runtime_services.go` 的文件+diff 订阅，但**从不广播 `workspace_update` / `checkout_status_update`**。前端 `workspace-directory-reconciliation.ts` 与 `session-context.tsx` 都在监听这两个消息，收不到就只在全量拉取时才更新。已补：工作区增/改/归档、worktree 创建、git 状态变化时主动推送。仍缺：观察目标的重连自愈相位、LRU 缓存层、并发限流。 |

### 工具盲区（本轮发现并修掉）

`go-emit-parity.mjs` 对 `payload: z.discriminatedUnion(...)` 的消息标为 opaque 后**整条跳过**，
于是 `workspace_update` 这种「payload 是联合体」的消息即使从未发送也不会被报出来。
已改为：opaque 只跳过**字段**比对，仍然检查**是否发送过**。补上后立刻暴露 4 条 NEVER_SENT。

同时修掉解析器的两个盲区：

- 标识符参数（`sendSessionMsg(..., respType, ...)`）被 `slice(1,-1)` 切成 `espTy`，导致所有 `respType` 派生的响应都识别不到
- 同一分支内 `if` 二次赋值 `respType` 时只认第一个（`github_search_response` 被误报）；顺手把该处代码改成两个显式调用，静态可见

| `bootstrap.ts` | 1883 | **PARTIAL** → 已补 | 启动流程。已补：`BYSPACE_LISTEN` 支持 unix socket / named pipe（Node 支持 6 种形式，Go 只做 TCP）、启动时清理废弃的 `agent-timelines` 目录。仍缺：managed helper process 台账对账（`reapStale`）、启动时 skills 维护、`terminalProfiles`/`agentProfiles` 从启动参数注入、trustedProxies。 |

| `worktree-bootstrap.ts` | 1101 | **PARTIAL** → 已补核心 | **创建工作区/worktree 后从不跑 setup**——`setupTerminalId` 恒为 nil，`byspace.json` 的 setup 命令在新 worktree 里永远不执行，导致「新建的 worktree 看起来就绪，但第一条命令就失败」。已补：`workspace.create` 与 `create_byspace_worktree` 都异步启动 setup 并流式上报进度；无 setup 命令时在 `setupSkippedReason` 里说明。测试 `TestWorkspaceCreateRunsSetup` / `TestWorkspaceCreateReportsSkippedSetup`。仍缺：`runtimeEnv` 解析（worktree 专属环境变量注入终端）、失败时清理、`runWorktreeAutoTerminals`、脚本生命周期的 port/proxy 部分。 |
| `worktree-session.ts` | 929 | **PARTIAL** | worktree 会话级操作大多走 `internal/workspace/git.go`；缺自动终端与脚本 teardown。 |

| `workspace-archive-service.ts` | 643 | **PARTIAL** → 已补核心 | **归档工作区时不停它的 agent、不关它的终端**——只把工作区记录的 `archivedAt` 翻了一下。归档掉的 agent 仍在跑并继续消耗 token，PTY 也一直占着。已补 `archiveWorkspaceContents`：关闭该工作区的全部 agent 运行时、杀掉其终端、归档 agent 记录并广播。测试 `TestArchiveWorkspaceStopsItsAgents`（已验证移除修复即失败）。仍缺：按引用计数判断目录是否可删（`isDirectoryUnreferenced`）、`archiveByScope` 的批量语义。 |

| `agent-history-search.ts` | 188 | **MISSING** → 已补 | 历史搜索是**分词 + 六级 tier + 字段优先级**的相关性排序（workspace > title > branch > project，每 token 必须命中，可跨字段）。Go 只有「标题/cwd/ID 子串包含」——多词查询搜不到、无相关性排序、无法与多主机分页结果合并。已按 Node 重写：`internal/server/history_search.go` + `match.TokenizeQuery`，`filterAndSortAgents` 改为走它。4 个测试覆盖跨字段、排序、容错、空查询。 |
| `resolve-workspace-id-for-path.ts` | 46 | **MISSING** → 已补 | 按路径解析工作区：精确匹配优先，否则**最深**的包含工作区，且**永不匹配 home 目录**（否则吞掉所有路径）。Go 只有精确字符串比较，传 worktree 子目录时找不到。已补 `store.ResolveWorkspaceIDForPath` + 5 个断言。 |
| `persisted-config.ts` | 521 | **PARTIAL** | Go 读写 `{version,daemon:{...}}` 结构已对齐；缺 schema 校验与迁移路径。 |

| `checkout-diff-manager.ts` | 413 | **MISSING** → 已补 | **文件订阅与 diff 订阅的轮询从未启动**：`PollSubscriptionsOnce` 只有测试里手动调用过，`New()` 里没有任何 goroutine 驱动它。于是「编辑器里订阅了文件」和「diff 面板订阅了变更」在真实运行中**永远收不到推送**。已补 `startSubscriptionPoller`（1s 周期），`Close()` 时停止。测试 `TestFileSubscriptionFiresWithoutManualPoll`（已验证移除轮询即失败）。差异：Node 用文件系统 watcher + 150ms 防抖，Go 用 1s 轮询——更省依赖，延迟略高。 |

| `workspace-script-runtime-store.ts` | — | **MISSING** → 已修字段 | 脚本 payload 的**字段名全错**：协议要 `scriptName`/`type`/`hostname`/`port`/`lifecycle`(running\|stopped)/`health`，Go 发的是 `name`/`command`/`status`。整个 `workspace.script.start.response` 与 `script_status_update` 客户端校验失败，脚本面板什么都不显示。已按 schema 重写并加测试。仍缺：端口分配与 proxy 路由（见 service-proxy）。 |
| `daemon-config-store.ts` | 1199 | **PORTED** | `agentProfiles` 经 `set_daemon_config` 透传即可；前端选择器把 profile 展开成具体 provider/model/mode，daemon 只存不解释。 |

| `pid-lock.ts` | 364 | **PARTIAL** → 已补 | Node 的锁是 JSON（pid/startedAt/hostname/uid/listen/heartbeat）+ 30s 心跳 + **5 分钟陈旧回收**。Go 只写裸 PID：崩溃后 pid 被无关进程复用时，`IsStale` 无从判断，锁会一直挡住重启。已补 `PIDLockInfo`/`ReadPIDLock`/`IsStale`/`TouchPIDLock`，`serve` 启动时检查并拒绝重复实例，30s 心跳；旧格式（裸整数）仍可读。4 个测试覆盖往返、旧格式、死 pid、过期心跳。 |

| `config.ts` | 812 | **PARTIAL** → 已补安全项 | Node 支持 30 个环境变量，Go 缺关键几个。已补：**Host 白名单**（`BYSPACE_HOSTNAMES`/`BYSPACE_ALLOWED_HOSTS` + `config.daemon.hostnames`），挡 DNS rebinding —— 绑定 loopback 的 daemon 仍可被 `evil.example` 解析到 127.0.0.1 后访问，Host 头是唯一信号。实测伪造 Host 返回 403，`127.0.0.1`/`localhost`/机器名正常。仍缺：`BYSPACE_PASSWORD` 密码鉴权、`BYSPACE_TRUSTED_PROXIES`、git 并发限流、`BYSPACE_LOG_*` 日志级别、relay TLS 覆盖。 |
| `home-workspace.ts` | 391 | **PARTIAL** → 已补 | Node **每次启动都重新断言** Home 的展示属性；Go 发现已存在就 `return nil`。label 一旦丢失（手改、旧版本、合并出错），Chief 就不再置顶、还多出 `+` 按钮。已补：按 cwd 重新打标而非新建重复记录，用户自设标题保留。2 个测试。 |
| `web-ui.ts` | 271 | **PORTED** | gzip/br 内容协商、SPA 回退、连接提示注入、缓存头均已对齐。 |
| `tunnel-manager.ts` | 567 | **MISSING** | 完整 TCP 端口转发子系统（每端口一个 listener + relay 流复用 + 断连宽限）。Go 的 `tunnel.*` 只是 `not_connected` 占位。**暂不实现**：验证需要两台机器，owner 明确说当前不具备条件，盲写风险高于收益。 |

| `relay-transport.ts` | 554 | **PARTIAL** → 已补 | 缺两件事：**keepalive**（Node 每 10s ping，30s 无应答即判定 half-open 并强制重连——否则中继悄悄消失时 `Read` 永不返回、`Close` 永不到达，daemon 以为自己还连着而手机一直超时）、**退避**（Node 线性退避到 30s，Go 固定 2s 会一直捶一个挂掉的中继）。均已补。 |
| `workspace-registry.ts` | 714 | **PORTED** | 记录投影与命名规则（title 优先、否则 displayName）已在 `buildWorkspaceDescriptor` 与 `buildProjectDescriptor` 对齐。 |
| `workspace-directory.ts` | 721 | **PARTIAL** → 已补 | `resolveWorkspaceRootAgent` 缺失：子代理会话应归组到发起对话的根 agent，跨工作区时停在边界，遇环返回 nil。已补 `internal/server/agent_tree.go` + 4 测试。同时修正 parent 关系的存储位置——共享词表用 label `byspace.parent-agent-id`，Go 原本存在私有字段里。 |

| `ws_git_system.go` / `pi/rewind` | — | **MISSING** → 已补 | `agent.rewind` 之前只是把内存 timeline 截断：provider 完全不知道，下次水合就把旧分支恢复回来。已按 Node 实现：生成 pi 集成扩展（`internal/agent/pi/extension.go`，移植自 `createPiBySpaceExtensionFile`），提供 entry capture（把用户消息映射到 pi 的树条目 id）与 tree navigation（`byspace_tree` 命令调用 `ctx.navigateTree`）。`agent.rewind.request` 现在走真实 provider 导航，失败会返回错误而不是假成功。 |
| `server.go` listen | — | **MISSING** → 已补 | daemon 只绑一个 loopback 族：前端把 `127.0.0.1` 归一成 `localhost` 后浏览器可能解析到 `::1`，连接超时并表现为「未连接主机」。已补双栈绑定（`listen_dual.go`），`127.0.0.1`/`localhost`/`[::1]` 三种地址实测均可连。 |
| `hostnames.ts` | — | **已修正实现** | 我最初把 Host 白名单加在 `ServeHTTP` 上，拦掉了静态资源和 API，导致整个前端「未连接」。Node 只在 **WebSocket 升级**时校验（`websocket-server.ts:737`），并且未配置白名单时默认不限制。已改到 `handleDirectWS`，默认放行。 |

### 未审计（本批剩余 50 文件）

按行数排序，下一轮从这里继续：

`websocket-server.ts` 2771 · `bootstrap.ts` 1883 · `workspace-git-service.ts` 3601 ·
`worktree-bootstrap.ts` 1101 · `worktree-session.ts` 929 · `workspace-reconciliation-service.ts` ·
`workspace-archive-service.ts` · `workspace-auto-name.ts` · `workspace-bootstrap-dedupe.ts` ·
`workspace-source.ts` · `agent-history-search.ts` · `checkout-diff-manager.ts` ·
`resolve-workspace-id-for-path.ts` · `persisted-config.ts` · 以及其余 55 个。

---

## 批次 2-9

未开始。范围见 Issue。
