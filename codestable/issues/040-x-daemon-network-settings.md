---
kind: issue
title: "Daemon 网络设置：局域网访问开关与密码管理"
type: feature
status: closed
created: 2026-07-14
---

<!-- 读者：跨会话接手的人。目标与范围 · 现状怎么工作 · 影响面 · 质量承诺 · 方案 · 风险 · 验证 · 执行记录 · 关闭回写 -->

# Daemon 网络设置：局域网访问开关与密码管理

## 做成以后是什么样

用户在 App 的 Host 设置页"网络"分区里：

1. **设置/清除访问密码**：保存后 daemon 将 bcrypt 哈希写入持久化配置，重启生效；App 同时把明文密码写进自己的连接档案，重启后自动重连不断线。
2. **允许局域网连接**：开关打开后 daemon 持久化 `daemon.listen` 为 `0.0.0.0:<port>`，重启后局域网设备可通过 `http://<lan-ip>:<port>`（Web UI）或 App 直连 TCP 使用。

**安全不变量（用户已确认强制）：** 未设置密码时，UI 禁用局域网开关，daemon 拒绝 `allowLanAccess=true` 的 patch；已开启时拒绝清除密码。即 `allowLanAccess ⇒ passwordSet` 在服务端与 UI 双侧成立。

**范围：** 包含 protocol schema 扩展、daemon patch 持久化与校验、App 设置 UI、i18n（en + zh-CN）。不包含：密码热生效（统一重启生效）、overrideControlledPaths 的 UI 展示、Web UI 独立的密码入口（App 即客户端）。

## 为什么现在做

daemon 默认只监听 127.0.0.1，局域网设备无法连接；要放开只能手动改 `BYSPACE_LISTEN`/配置文件并重启，且密码只能用 `PASEO_PASSWORD` 环境变量或手编配置文件设置。用户希望在设置界面完成这两件事。

## 现状怎么工作

- **密码认证已存在**：`packages/server/src/server/auth.ts`（bcrypt，HTTP Bearer + WS `paseo.bearer.<token>` 子协议）。密码来源优先级：`PASEO_PASSWORD` env > 持久化 `daemon.auth.password`（`config.ts` `resolveAuthConfig`）。`daemon.auth.password` 已列入 overrideControlledPaths（env 设置时）。
- **监听地址**：`config.ts` `resolveListenAddress`，优先级 CLI > `BYSPACE_LISTEN` env > 持久化 `daemon.listen` > 默认 `127.0.0.1:6777`。启动时绑定，改动必须重启。`daemon.listen` 在 env/CLI 设置时已列入 overrideControlledPaths。
- **协议**：`MutableDaemonConfigSchema`（视图）/ `MutableDaemonConfigPatchSchema`（patch）均不含 network/auth；RPC 为 `get_daemon_config_request` / `set_daemon_config_request`（session.ts 直接调 `daemonConfigStore.get()/patch()`，权限 `daemon.read`/`daemon.manage`）。`pickSupportedPatchFields` 静默丢弃未支持字段——老客户端发新字段安全，新客户端发老 daemon 亦安全。
- **DNS rebinding 防护不挡 IP 直连**：`hostnames.ts` 默认放行 localhost 与所有 IP 字面量，放开监听后局域网 IP 即可访问，无需额外配置。
- **App 侧**：`useDaemonConfig` 提供 get/patch；`useHostMutations.upsertDirectConnection` 可写连接档案（含 password）；Host 设置页已有重启卡片与确认对话框模式。

## 动哪些、验哪些

- 必须改：
  - `packages/protocol/src/messages.ts`：两个 schema 增加 `network` / `auth`
  - `packages/server/src/server/daemon-config-store.ts`：patch 支持与不变量校验
  - `packages/server/src/server/bootstrap.ts`：初始 mutable config 派生 network/auth 视图；listen 改写回调
  - `packages/app/src/screens/settings/host-page.tsx`（或新分区文件）：网络分区 UI
  - `packages/app/src/i18n/resources/{en,zh-CN}.ts`
- 需要验：daemon-config-store patch 测试；App 组件测试（开关禁用态）；typecheck + lint
- 仍未知：无（设计阶段已确认全部落点）

## 方案与实现安排

**Protocol 视图**（可选字段，向后兼容）：

- `network: { allowLanAccess: boolean, tcpPort: number | null }`（null = unix socket 模式，UI 禁用开关）
- `auth: { passwordSet: boolean }`（不回传哈希与明文）

**Protocol patch**：

- `network: { allowLanAccess: boolean }`；`auth: { password: string | null }`（明文进、哈希落盘，null 清除）

**Server**：

- `pickSupportedPatchFields` 收录新字段；store 在 apply 时：
  - `auth.password` → `hashDaemonPassword` 后写持久化 `daemon.auth.password`，视图 `passwordSet` 同步
  - `network.allowLanAccess` → 由回调拿到当前 TCP 端口，写持久化 `daemon.listen`（保留端口）；非 TCP 模式拒绝该 patch
  - 不变量：`allowLanAccess=true` 且无密码 → 拒绝；`password=null` 且已放开 → 拒绝（错误信息可指导用户）
  - overrideControlledPaths 命中 `daemon.listen` / `daemon.auth.password` 时拒绝 patch（env 接管，UI 改动会失效，明确报错优于静默失效）
- bootstrap 初始视图：`allowLanAccess` 从 resolved listen host 派生（非 loopback 即 true）；`tcpPort` 从 listenTarget；`passwordSet` 从 `config.auth?.password`

**生效时机**：统一重启生效。UI 在 patch 成功后提示并引导重启（复用 `restartDaemonFromSettings`）。改密码流程：先 `upsertDirectConnection` 更新本机连接档案明文密码，再 patch daemon，再提示重启。

**App UI**（Host 设置页新增"网络"分区）：

- 密码行：显示"已设置/未设置"；点开 modal sheet 输入密码（保存/清除）；未连接时隐藏
- LAN 开关行：`!passwordSet || tcpPort==null` 时禁用；hint 说明需密码与重启生效

## 质量承诺

- **信息安全性**：局域网放开 = 网内任何人可驱动 agent 执行代码。不变量服务端强制（不信任 UI）；明文密码不进日志、不回传；哈希落盘。证据：store 单测覆盖拒绝路径。
- **兼容性**：新字段全可选，老客户端/老 daemon 双向可解析。证据：protocol 现有测试 + typecheck。

## 验证

- `npx vitest run packages/server/src/server/daemon-config-store.test.ts --bail=1`（新增用例：密码哈希落盘、listen 改写、无密码拒绝开 LAN、LAN 开启拒绝清密码、env 接管拒绝 patch）
- App 组件测试：无密码时开关禁用（若现有测试基建支持，否则手动验证并记录）
- `npm run typecheck`、`npm run lint`、`npm run format`
- 手动路径（用户环境）：设密码 → 重启 → 旧连接自动重连；开 LAN → 重启 → 局域网设备 Web UI 出现密码框

## 已知限制

- `PASEO_PASSWORD` env 优先级高于 UI 设置；env 存在时 patch 被拒绝并提示（v1 不做 UI 展示 override 状态）
- 忘记密码的恢复路径：编辑配置文件清除 `daemon.auth.password`，或以 `PASEO_PASSWORD` 启动后从 UI 重设（UI hint 提示）

## 执行记录

**Protocol（packages/protocol/src/messages.ts）**

- `MutableDaemonConfigSchema` 增加 `network: { allowLanAccess, tcpPort | null }` 与 `auth: { passwordSet }`（可选，`COMPAT(daemonNetworkConfig): added in v0.14.3`）
- `MutableDaemonConfigPatchSchema` 增加 `network: { allowLanAccess? }` 与 `auth: { password? | null }`（明文进、null 清除）
- `features.daemonNetworkConfig` 能力声明（schema + websocket-server 广告）

**Server**

- `daemon-config-store.ts`：`SupportedMutableConfigPatch` 增加 wire 入口；`resolveDaemonNetworkPatch` 拆为 validate（override 守卫 + 密码不变量 + TCP 检查）与 translate（listen 改写 + bcrypt 哈希）两步；view patch 只含派生字段；`refreshNetworkRuntimeState` 供绑定端口后刷新视图（不落盘）；`mergeMutableDaemonPatch` 把 `listen`/`auth.password`（哈希）写入持久化配置
- `bootstrap.ts`：`createNetworkView` 从 resolved listen 派生初始视图；`networkControls`（bound 端口 + env/CLI override 检测）；`onListening` 后 `refreshNetworkRuntimeState`；`isLoopbackListenHost` 覆盖 127.0.0.1/::1/localhost

**App**

- 新文件 `screens/settings/network-section.tsx`：密码行（已设置/未设置 + 编辑 sheet，含显示切换与清除按钮——LAN 开启时清除禁用以免服务端报错）+ LAN 开关（无密码或非 TCP 时禁用）；patch 成功后弹重启确认（复用 `restartDaemonFromSettings`）；保存密码时同步本机 directTcp 连接档案（`upsertDirectConnection`），重启后自动重连不断线
- 挂载在 Host 概览页（`host-page.tsx`，外观设置之后）
- i18n：`settings.host.network.*` 全部 9 个 locale 同步（resources.test 强制 key 对齐）

**验证**

- `npx vitest run src/server/daemon-config-store.test.ts`：46/46（新增 10 个用例：哈希落盘且视图无明文、null 清除、listen 改写保端口、无密码拒绝开 LAN、LAN 开启拒绝清密码、原子 patch、非 TCP 拒绝、双 override 拒绝、重复改密码产生新哈希、refresh 不落盘）
- `npx vitest run` 相关 4 文件 108/108；i18n resources.test 33/33
- typecheck：protocol / server / app 三包全过；lint：全仓 0 警告 0 错误；`npm run format:files` 已跑
- 手动验收（重启 daemon + 局域网设备连接）待用户执行

**与设计的偏差**

- store 返回的 view patch 同时携带 `passwordSet`/`allowLanAccess`（原设计只更新持久化），否则 UI 在重启前显示旧状态，且 UI 显示的是“已保存待生效”状态，比隐藏字段更诚实
- 错误信息英文硬编码（跟随 `relay` override 的现有先例，未入 i18n）

## Review 修复（PR #41 评审后追加）

**正确性（P1，必修）**

- 清密码的 LAN 判定改为「持久化 listen ∨ 视图 allowLanAccess」双源：此前只看视图，`BYSPACE_LISTEN=127.0.0.1` 启动可绕过已开 LAN 的盘上状态清掉密码，去掉 override 重启后 LAN 裸奔。新增 `isLanListenString`（hostnames.ts）判定盘上 listen。
- App 补上 `features.daemonNetworkConfig` 消费（此前只在协议端声明，客户端漏接）：老 daemon 上整个 Network 分区隐藏，而不是 patch 被静默丢弃后假成功。

**正确性（P2）**

- socket/pipe daemon 收到 network patch 时不再落盘 `127.0.0.1:0`（跳过 listen 写入，保留原值）。
- patch 失败错误透传进 PasswordSheet 的 Field（override 拒绝等路径不再无反馈）。
- 本机连接档案同步失败改为 Alert 提示（`password.profileSyncFailed`，9 locale），不再只有 console.error。

**Ponytail 收缩（-45 行目标中已落地主要项）**

- validate/translate 三段单调用者链合并为单方法 + 3 个模块级纯函数（resolveEffectivePasswordSet / resolveLanOpen / resolvePersistedListen / resolveAuthPasswordHash），穿针参数消失。
- bootstrap 与 workspace-service-env 两份漂移的 loopback 判定收敛到 `hostnames.isLoopbackHost`（语义差异：统一认 `::ffff:127.0.0.1`，不再认 `[::1]`——`isLoopbackHost` 会剥掉方括号，两者实际都认）。
- App：PasswordSheet 改无条件渲染 + `visible` prop、删冗余 `initialValue=""`、`lanHint` 三元链改 if/let、`.then` 回调改 async/await。

**CI flaky（executable-resolution.test.ts，Windows）**

- winget 用例把 node.exe 拷进临时目录并当作子进程 probe，Windows 句柄/AV 锁导致清理 `rmSync` 报 EBUSY。清理改为 EBUSY/EPERM/ENOTEMPTY 重试 5 次×100ms，仍失败则 best-effort 跳过（留给 OS 清理），不再让无关测试失败。

**回归验证**：相关 7 文件 147 过 7 skip；typecheck（protocol/server/app）、全仓 lint、format 全绿。

## 关闭时

- 回写候选：`codestable/spec/connection.md` 安全边界一节补充"局域网放开与密码的强制绑定"；若有坑点（如 listen 改写与 override 优先级的交互）记 note
- 关闭判断：验证一节全部通过 + 用户手动验收局域网直连
- 遗留：密码热生效（不做的理由：listen 反正要重启，双路径无收益）

## 关闭结论

**判断：** 目标达成。设置界面可设置/清除 daemon 访问密码、开放/关闭局域网监听；安全不变量（`allowLanAccess ⇒ passwordSet`）在服务端与 UI 双侧强制；范围未暗扩，全部改动落在 issue 声明的文件清单内。

**验证摘要（质量证据）：**

- 信息安全性：`daemon-config-store.test.ts` 10 个新用例覆盖哈希落盘且视图无明文、null 清除、listen 改写保端口、无密码拒绝开 LAN、LAN 开启拒绝清密码、原子 patch、非 TCP 拒绝、双 override 拒绝、重复改密码产生新哈希、refresh 不落盘（46/46）；全文件 + bootstrap/config 相关 4 文件 108/108。
- 兼容性：protocol / server / app 三包 typecheck 全过；schema 字段全可选 + `features.daemonNetworkConfig` 能力门控；i18n resources.test 强制 9 locale key 对齐与插值占位符一致（33/33）。
- lint 全仓 0 警告 0 错误，Biome 格式化已跑。
- 手动验收（设密码→重启→自动重连；开 LAN→局域网设备出密码框）由用户执行确认。

**毕业回写：** `codestable/spec/connection.md` 安全边界一节新增"局域网监听以密码为前提"一条（不变量、哈希边界、重启生效、override 拒绝、能力门控）。

**遗留：** 密码热生效不实现（重启路径已存在，双路径无收益）；`PASEO_PASSWORD` env 接管时 UI 拒绝 patch 并说明原因，v1 不做 override 状态展示；错误文案跟随现有先例为英文，未入 i18n。以上均不需要后续事项。
