---
kind: issue
title: "Daemon 系统服务部署：CLI 与设置页可选开机自启"
type: feature
status: open
created: 2026-09-18
---

<!-- 读者：跨会话接手的人。目标与范围 · 根因证据 · 现状怎么工作 · 影响面 · 质量承诺 · 方案 · 风险 · 验证 · 关闭回写 -->

# Daemon 系统服务部署：CLI 与设置页可选开机自启

## 做成以后是什么样

用户可以把 daemon 交给操作系统的服务管理器托管，而不是从终端里拉起：

1. **CLI**：`byspace daemon install-service` 注册系统服务并立即启动；`byspace daemon uninstall-service` 注销；`byspace daemon service-status` 报告是否已注册、是否由服务托管。
2. **App**：Host 设置页（本机 daemon 时可见）新增一行开关，文案按平台如实描述（macOS「登录时启动」、Linux「开机自启」、Windows「登录时启动」），开关状态来自 daemon 自报，而不是客户端本地记忆。
3. **行为**：服务托管后 daemon 随登录会话（或 boot，按平台能力）自动运行，崩溃自动重启；`byspace daemon stop` 仍然能真正停住它（不被服务管理器立刻拉回），`restart` 仍然有效。

**范围：** 包含服务注册/注销/状态查询的 CLI 命令、daemon 侧服务状态查询与安装 RPC、App 设置页开关、i18n（9 locale）。不包含：把 daemon 暴露到公网、以 root/system 级 daemon（launchd system domain / systemd system unit）安装、Docker 场景（容器里由 runtime 负责，明确拒绝）、守护进程自身的热更新改造。

**归属：** 根 `issues/`。不挂 Epic；连接与配置的既有边界见 [spec/connection.md](../spec/connection.md)。

## 为什么现在做 / 当前坏在哪

**根因（已复现并定位）：** 从终端启动的 daemon 在用户 Cmd+Q 退出该终端后，daemon 及其派生的 agent 进程会突然无法访问局域网地址；所有 agent 同时报 `Provider retry: Connection error.`；重启 daemon 即恢复。这与 mihomo / 代理无关——被阻断的是**局域网直连**（模型端点 `http://10.1.115.59:23000`，走 en7，不经 TUN）。

**机制：** macOS 26+ 的 Local Network 权限按 **responsible process** 判定，而 responsible pid 是沿 spawn 血统继承的，`detached: true`/setsid 不会改变它。

- 终端活着：responsible = Terminal.app，签名身份可解析、权限为 allowed，连接正常。
- 终端退出：responsible 进程消失，系统无法解析其签名身份，**fail closed 阻断**该进程树的所有局域网连接。
- 重启 daemon 之所以「修好」，只是因为在**另一个活着的终端**里重启，新进程树重新绑定到一个活着的 responsible 进程。

**证据（四次故障，时间戳精确到毫秒对齐）：**

| 日期  | Terminal Cmd+Q       | `Failed to get the signing identifier` / 首个 agent 报错 |
| ----- | -------------------- | -------------------------------------------------------- |
| 09-15 | 18:33:47 (pid 1931)  | 18:34:04                                                 |
| 09-17 | 10:41:02 (pid 20399) | 10:41:34                                                 |
| 09-18 | 11:04:48 (pid 36158) | 11:06:22                                                 |
| 09-18 | 11:25:43 (pid 16191) | 11:25:48                                                 |

- 该错误日志在过去三天**只出现在这四段故障窗口内**，其它时间一次都没有：
  `UserEventAgent: Failed to get the signing identifier for <terminal pid>: No such process` → `LocalNetwork: found bundle id com.apple.Terminal by UUID ...`。
- 当前 daemon 进程树（supervisor 24533、worker 24534、pi 26331、pi 26381）用 `responsibility_get_pid_responsible_for_pid` 查询，responsible 全部指向当前 Terminal（24392），而 supervisor 自身 `SESS=0`（已脱离会话但未脱离 responsibility）。
- **受控复现**：临时 `.app` 内跑 `fetch("http://10.1.115.59:23000")`，父进程被杀后立即 `EHOSTUNREACH`，日志出现同样的 `Got local network blocked notification` + `did not find bundle ID`。
- **反向验证（修复方向成立）**：同一请求改由 `launchctl submit` 启动，responsible = 自身且无 bundle ID，请求正常返回 `401`，无任何 blocked 记录。launchd 托管确实使 responsible 变为自身（活着），从而绕开该 fail-closed 路径。

**不做会怎样：** 只要用户从终端启动 daemon（这是当前推荐路径，见 `docs/development.md`），任何一次终端退出都会静默瘫痪所有 agent 的模型请求，且表象是「网络问题」，排查成本极高。

## 现状怎么工作

- **启动路径**：`packages/cli/src/commands/daemon/local-daemon.ts` 的 `startLocalDaemonDetached` 用 `spawnProcess(process.execPath, [runner, ...args], { detached: true, stdio: ["ignore","ignore","ignore"] })` 拉起 `packages/server/scripts/supervisor-entrypoint.ts`。supervisor 自己已有 pid lock、worker 崩溃重启与 graceful shutdown（`workers`/`IPC restart and crash restart enabled`）。
- **停止/重启**：`stopLocalDaemon` 优先走 `shutdown_server_request` RPC，失败回落 owner PID signal；`runRestartCommand` = stop + detached start。
- **状态**：`resolveLocalDaemonState` 从 `byspace.pid` 读 pid/listen/`desktopManaged`；`pid-lock.ts` 记录 `BYSPACE_DESKTOP_MANAGED=1` 派生的 `desktopManaged`。
- **设置页**：`host-page.tsx` 以 `useIsLocalDaemon(serverId)` 判定是否渲染本机专属区块；`NetworkSection` 是「跟 daemon 配置相关、需重启生效」的既有范式，可作新开关的模板（含能力门控 `features.daemonNetworkConfig`）。
- **能力门控**：`ServerInfoStatusPayloadSchema.features` 为纯 optional 布尔集合，客户端用 `useHostFeature`。本功能沿用同一机制。
- **安装来源**：`install-origin.ts` / `npm-global-cli.ts` 判定 daemon 是否跑在 npm global 安装下（self-update 用）。服务化必须沿用这套判定：**不是 npm global 安装（如仓库 dev、`tsx` 直跑、Docker）时应拒绝注册服务**，否则会注册一个指向临时 checkout 的服务。
- **现状缺口**：仓库内完全没有 launchd / systemd / Task Scheduler / 开机自启相关代码（全仓 `rg` 无命中）。

## 动哪些、验哪些

- 必须改：
  - `packages/cli/src/commands/daemon/`：新增 `install-service.ts` / `uninstall-service.ts` / `service-status.ts`（或合并为一个 `service.ts`），并注册进 `index.ts` 与 `cli.ts` 的别名单
  - 新增 `packages/cli/src/commands/daemon/service/`：按平台拆 `launchd.ts` / `systemd.ts` / `windows-task.ts` + 共享的「解析服务定义」层
  - `packages/protocol/src/messages.ts`：`MutableDaemonConfigSchema` 增加服务状态视图字段、新增 `daemon.service.install.request|response` 与 `daemon.service.uninstall.request|response`（dotted + 方向后缀）；`features` 增加 `daemonServiceInstall`
  - `packages/server/src/server/daemon-config-store.ts`（或同级新模块）：服务状态视图派生 + install/uninstall 的校验与执行
  - `packages/server/src/server/session.ts` + `operation-permissions.ts`：新 RPC 分发与权限（`daemon.manage`）
  - `packages/app/src/screens/settings/`：新增 `daemon-service-section.tsx`，挂到 `host-page.tsx`（`isLocalDaemon` 为真时）
  - `packages/app/src/i18n/resources/*.ts`：9 个 locale 同步
- 需要验：
  - macOS：注册 → 退出 Terminal → agent 仍能访问局域网模型端点（本 issue 的核心验收）
  - macOS：`stop` 之后不被 launchd 拉回；`restart` 之后 responsible 仍是自身
  - Linux：systemd user unit 在 `loginctl enable-linger` 前后的行为差异
  - Windows：Task Scheduler 任务指向 `node.exe <entry>.js` 而非 `.cmd` shim
  - 拒绝路径：Docker / dev checkout / 非 npm global 安装
  - `npm run typecheck`、`npm run lint`、相关 vitest 文件
- 仍未知：
  - 全新机器（无既有 Local Network 授权）上，launchd 托管的**无 bundle ID** 进程是否会触发一次系统弹窗，还是静默放行。本机实测静默放行，但本机 Terminal 早已授权过；需要在干净环境穿刺确认
  - Windows 上「无 bundle ID 等价物」的防火墙/局域网限制是否存在同类问题（平台不同，机制很可能不存在，但不能假设）

## 方案与实现安排

**统一抽象先行。** 三平台差异集中在「服务定义 → 安装/卸载/查询」这一层，其余（参数校验、路径解析、状态视图、UI）共享。先定义平台无关的 `ServiceSpec`（label、可执行文件绝对路径、参数、日志路径、环境变量、是否需要 login/boot 触发），再由三个后端各自翻译成本平台格式。不要在命令层写 `if (process.platform === ...)` 分支堆。

**macOS（launchd）。** 写 `~/Library/LaunchAgents/cc.cd.byspace.daemon.plist`（沿用 `byspace.cc.cd` 倒写；最终 label 实现时定一次，不要多处硬编码）并 `launchctl bootstrap gui/<uid>`；卸载用 `bootout`。关键取舍：

- **`KeepAlive` 必须是 false**，靠 supervisor 自身的崩溃重启能力。若为 true，`byspace daemon stop`（走 shutdown RPC）会被 launchd 立刻拉回，破坏既有 stop 语义。用 `RunAtLoad: true` 满足「登录时启动」。
- plist 里必须写 **node 与 runner 的绝对路径**（`process.execPath` + `resolveDaemonRunnerEntry()`），因为 launchd 不读 shell 配置，`PATH` 里没有 mise/volta shim。
- **环境变量要在安装时快照**，至少 `BYSPACE_HOME`、`BYSPACE_LISTEN`、`BYSPACE_HOSTNAMES`、`BYSPACE_RELAY_*`、`BYSPACE_WEB_UI_ENABLED`、`PATH`。launchd 环境极简，依赖登录 shell 才能解析的变量（mise 的 `__MISE_*`、`PATH`）必须显式落进 plist，否则 agent 进程找不到 `pi`/`claude` 等二进制。

**Linux（systemd user unit）。** 写 `~/.config/systemd/user/byspace.service` + `daemon-reload` + `enable --now`。`Restart=on-failure`（同样避免 `always`，保持 stop 语义）；`WantedBy=default.target`。已知取舍：user unit 默认随登录会话结束而停止，需要 `loginctl enable-linger $USER` 才能真正常驻——安装流程应检测并明确提示（或提供 `--linger` 选项），不要静默降级成「只有登录时在跑」。

**Windows（Task Scheduler）。** 用 `schtasks` 或 PowerShell `Register-ScheduledTask` 注册登录触发任务，指向 `node.exe` + runner entry（**不是** `byspace.cmd` shim，后者依赖 cmd 解析）。卸载 `Unregister-ScheduledTask`。Windows 没有 launchd 那套 responsible-process 门禁，本 issue 在 Windows 上的价值是「开机自启 + 崩溃重启」，不是修 bug，文案不要暗示安全问题。

**状态视图与判定「由服务托管」。** daemon 不应仅凭「服务文件存在」就自报托管（文件可能是陈旧残留）。状态判定分级：`not-installed`（无服务文件）/ `installed-stopped` / `installed-running-not-this-process` / `managed-by-service`（服务定义的 pid 或 label 与当前进程一致）。判定方式按平台取最可靠信号（launchd：`launchctl print gui/<uid>/<label>` 的 pid；systemd：`systemctl --user show -p MainPID`；Windows：任务的上次运行结果 + 进程匹配）。拿不到可靠信号时降级为 `unknown`，UI 不显示开关而不是显示错误状态。

**RPC 与能力门控。** 新 RPC 按 [rpc-namespacing.md](../../docs/rpc-namespacing.md) 用 `daemon.service.install.request` / `.response` 成对；权限复用 `daemon.manage`。App 侧用 `features.daemonServiceInstall` 门控整个分区（老 daemon 隐藏而非假成功），模型同 `NetworkSection` 的 `daemonNetworkConfig`。注册/卸载后需要重启或至少重新查询状态——沿用 `NetworkSection`「操作成功后引导重启 + 刷新」的既有交互，不新造模式。

**有界简化（明确不做）：**

- 不做 root/system 级服务（launchd system domain、systemd system unit、Windows 服务）。用户场景是「自己的开发机」，user 级足够，且系统级会把 agent 的执行身份变成 root，改变权限模型。
- 不做服务定义的热迁移（安装后改 `BYSPACE_LISTEN` 等需重新 install）。上限：只支持安装时快照的环境；触发条件：用户改配置想生效时重新跑 `install-service`；方向：不引入配置 diff 与自动重写。
- 不做 Docker 内自托管（容器里 `tini` + runtime restart policy 已是该场景的正解），检测到容器环境直接拒绝并说明。

**质量目标（按九特征选取）：**

- **可靠性**（主要目标）：本 issue 修的是「终端退出导致全部 agent 静默失败」。结果 = daemon 生命周期与启动它的终端解耦。来源 = 上面的根因证据。证据 = macOS 上退出 Terminal 后模型请求仍成功的实测记录 + 故障窗口内不再出现 `blocked notification` 日志。
- **可操作性/兼容性**：能力门控 + 拒绝路径必须有可行动的错误文案（dev checkout、Docker、非 npm global 各自说明原因），不能只报「失败」。证据 = 单元测试覆盖三类拒绝。
- **信息安全性与安全性**：服务定义包含绝对路径与环境快照，可能含敏感值（如密码相关 env）。结果 = 服务文件权限收紧（0600/0644 视内容）、不把 `BYSPACE_PASSWORD` 之类写进服务文件。证据 = 安装后校验文件权限与内容的测试。

## 风险与穿刺

| #   | 风险                                                                             | 怎样算打通                                                                                               |
| --- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | 干净机器上 launchd 托管的无 bundle ID 进程仍需系统弹窗授权，导致「装了也连不上」 | 在未授权过 Local Network 的 mac 上安装服务并访问局域网端点，确认静默通过或给出可行动的授权引导           |
| 2   | launchd 极简环境下 agent 二进制解析失败（`pi`/`claude` 找不到）                  | 服务托管下创建一个 pi agent 并成功跑一轮，而非只在 CLI 里 `curl` 成功                                    |
| 3   | `KeepAlive` / `Restart` 取值不当，`stop` 被服务管理器拉回                        | `byspace daemon stop` 后 30 秒内进程不再出现；`service-status` 报 stopped                                |
| 4   | Windows 任务指向 `.cmd` shim 导致解析失败                                        | Windows 上注册任务后能实际拉起 daemon（CI windows-latest 至少覆盖「生成的任务 XML/命令正确」的单元测试） |
| 5   | 状态判定被陈旧服务文件欺骗，UI 显示错误的「已托管」                              | 手动删除/替换服务文件后 `service-status` 与 UI 报 `not-installed`/`unknown`，不谎报                      |

**建议先做穿刺 1 + 2**（macOS 是本次根因平台，也是唯一有隐私门禁的平台），确认通路后再铺三平台实现与 UI。穿刺 1 若失败，本 issue 的方案需要改（可能要走「打包成带 bundle ID 的 .app 包装器 + 用户授权」），所以必须先验。

## 验证

- 单元测试（真实依赖优先，mock 仅限不可控外部命令）：
  - 服务定义生成：三平台各自把 `ServiceSpec` 翻译成正确的 plist / unit / task 定义（纯函数，易测）
  - 拒绝路径：Docker、dev checkout（非 npm global）、已安装时重复 install、未安装时 uninstall
  - 状态判定：`managed-by-service` / `installed-stopped` / `not-installed` / `unknown` 四态，含服务文件陈旧的情况
  - 服务文件内容不含敏感 env；权限位正确
- 手测（**核心验收**）：macOS 上 `install-service` → 在一个新的 Terminal 里 `byspace daemon restart`（或直接由服务拉起）→ **Cmd+Q 退出所有 Terminal** → 在 App 里给 agent 发一条消息，确认模型请求成功、不再出现 `Connection error`；同时 `log show` 中该窗口无 `Got local network blocked notification`
- 手测：`byspace daemon stop` 后进程确实不再被拉起；`service-status` 状态正确；`uninstall-service` 后开机不再自启
- `npm run typecheck`、`npm run lint`、`npm run format`；i18n resources 测试（9 locale key 对齐）
- 跨平台：Linux/Windows 的真机验证列入发布清单（CI 只覆盖可自动化的单元部分，遵循 [docs/qa.md](../../docs/qa.md) 的平台矩阵与证据要求）

## 执行记录

### 2026-09-20 · 穿刺 + macOS 第一片（CLI）

**两个穿刺都通过，且拿到机制级证据**（本机 macOS 27.0）：

- **穿刺 1（Local Network）**：一次性 LaunchAgent 访问真实模型端点 `10.1.115.59:23000` → HTTP 200，无 blocked 记录。日志给出与终端场景的机制分界：launchd 场景是 `Failed to find bundle ID, ignoring`（按可执行文件 UUID 解析身份后放行），终端故障场景是 `Failed to get the signing identifier ... No such process`（fail closed）。`ignoring` vs `No such process` 就是放行与阻断的分界，方案不需要 .app 包装器。
- **穿刺 2（agent 二进制）**：launchd 默认环境 PATH 仅 `/usr/bin:/bin`，`pi`/`claude`/`node` 全部解析不到；把安装时快照的 PATH 写进 `EnvironmentVariables` 后全部解析成功。环境快照是功能前提，不是优化。

**已落地（`b3fc6f311`）**：`daemon service-status`（四态，以 launchd 实报为准）/ `install-service` / `uninstall-service`，ServiceSpec 抽象层（`packages/cli/src/commands/daemon/service/`），KeepAlive=false，拒绝路径（dev checkout / Docker 各自说明）。server package.json 新增 `./daemon-install-origin` 与 `./npm-global-cli` 子路径导出供 CLI 复用。

**真实验收**：用实现渲染的 plist 在隔离 home（6799 端口）把 daemon 跑在 launchd 下：`running`、HTTP 200、**supervisor 的 responsible = 自身 pid**（用 `responsibility_get_pid_responsible_for_pid` 实测）、PPID=1。终端退出的故障机制就此解除。

**过程发现并加固**：测试脚本 heredoc 丢变量导致 runner 路径为空的 plist 被 launchd 接受（`exit code 0` 秒退），据此给 `buildDaemonServiceSpec` 加了空/相对路径防线。

**剩余**：systemd / Task Scheduler 后端、daemon RPC（`daemon.service.*`）+ `features.daemonServiceInstall` 门控、App 设置页开关 + i18n 9 locale、干净机器弹窗穿刺（风险 1 的未授权环境部分）。

## 关闭时

- 回写候选：
  - `byissue/spec/connection.md`：补一条「daemon 可由系统服务托管，其生命周期与启动终端解耦」及其与权限门禁的关系
  - `docs/development.md`：启动/停止路径增加 service 方式；说明 launchd/systemd 的环境快照要求
  - 若穿刺 1 有意外结论（如需要 bundle ID 包装器），先记 note 再回写
- 关闭判断：macOS 核心验收通过（退出 Terminal 后 agent 仍可用）+ 三平台单元测试绿 + 拒绝路径与状态判定覆盖 + 用户确认真机验收
- 遗留：待定，取决于穿刺结果；已知范围外项（root/system 级服务、服务定义热迁移、Docker 自托管）在「有界简化」中已说明理由，不需要后续事项
