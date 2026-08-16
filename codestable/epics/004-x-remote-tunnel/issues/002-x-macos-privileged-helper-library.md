---
kind: issue
title: macOS privileged helper 与 HEV library wrapper
type: feature
status: closed
created: 2026-08-15
updated: 2026-08-16
---

# macOS privileged helper 与 HEV library wrapper

## 2026-08-16 范围纠正

用户确认实际需求只是按需访问另一个 daemon 的选定端口，并未要求一个虚拟 IP 自动覆盖所有端口。本 Issue 的 privileged helper/HEV/TUN 方向因此被已关闭的 `003-x-on-demand-tcp-forward.md` 取代，不再是产品前置条件。

现有 source 和验证记录继续作为历史证据保留，但不得继续投入 upgrade、签名、notarization、root gate 或 daemon bootstrap 工作。Issue 已按用户授权作为被取代的实现实验关闭。

## 目标

在不把 daemon 变成 root、也不把 HEV standalone CLI 当作生命周期边界的前提下，为 Remote Tunnel 建立一个可安装、可撤销、可签名的 macOS 查看端网络组件。它只负责 BySpace 自己的虚拟 peer `/32` 和 TUN data plane；远程身份、E2EE Relay carrier 和多路复用由后续 Issue 负责。

归属：`codestable/epics/004-x-remote-tunnel/spec.md`。

## 已有证据

Issue 001 的 macOS ARM64 穿刺已经证明 HEV 2.17.1 data plane 可用，但原始 CLI 的 TERM handler 在无活跃流时 3 秒内不收敛，不能直接分发。

在同一 pinned commit `9a06bc6e7989da54e3d32ff701ef7a7ce4995d3a` 上，我又以 `ENABLE_LIBRARY` 重建了 `libhev-socks5-tunnel.a`，链接一次性 C probe。probe 在工作线程运行 `hev_socks5_tunnel_main_from_file(-1)`；主线程等待一个活动虚拟 IP TCP 流后调用公开的 `hev_socks5_tunnel_quit()`。结果：

- `mainResult=0`，控制线程到 worker join 用时 `688ms`。
- 活动 TCP 流在 quit 后关闭。
- `lifecycle.log` 记录 `UP interface=utun9` 与 `DOWN interface=utun9`。
- 停止后 `utun9` 不在接口列表，`10.253.254.2` 不再有 BySpace `/32`，默认路由仍回到 Mihomo 的 `utun8`。
- probe、fixture 和运行日志仍在 `/tmp/byspace-tunnel-spike.rjAJ2q/`，没有进入产品代码或发布资产。

这只关闭了“library quit 是否可由正常控制线程驱动”的证据缺口；它没有证明 helper 安装、IPC 权限、签名、真实 Relay carriage 或跨平台支持已经完成。

## 当前实现状态

`packages/server/native/remote-tunnel-helper/` 当前已有 **source、一次性 installer、daemon socket client 与一次本机 root runtime 证据，但尚未接 daemon bootstrap 或 release packaging** 的边界：

- 一次性 installer 只在首次显式安装请求管理员授权；普通用户 preflight 在 `osascript` 前拒绝任何已安装/部分安装状态，root 内联脚本取得 installation lock 后再次拒绝既有 binary、plist 或 launchd job，因此 `--install` 不能成为重复提权或 update 路径。root 在首次发布前复制到 root-owned staging、校验 digest、验签并原子发布；之后 start、stop、reconnect、测试与 cleanup 只连接 owner-only `/var/run/byspace-tunnel-<uid>.sock`，不得再调用 `osascript` 或 `sudo`；
- daemon socket client 已实现严格 framing、安装状态检查、`START/READY`、`STOP/STOPPED`、timeout、error 和 disconnect 收敛；focused tests 通过，真实 socket 连接也通过，但尚未接入 daemon bootstrap 或远端 carrier；
- 常驻 root supervisor 验证连接方 UID，并为每个 session fork 受限 helper；supervisor 退出或 client disconnect 时都监督 session 收敛。session root parent 只从 Unix socket 接受有界 `START`/`STOP` frame，并在 fork 后关闭 parent 的 accepted control fd，避免异常 session 泄漏 descriptor；
- root session parent 只创建 `utun`、配置地址并安装/删除精确 `/32`；HEV/lwIP packet data plane 在 fork child 中运行，child 在启动 HEV 前清空 supplementary groups，并永久降权到已认证 daemon UID；没有 HEV shell hook、用户配置路径或任意 route API；
- hash-locked HEV source patch 在 event task 注册外部 TUN fd 后发 readiness callback；root parent 只有在收到 callback 且未观察到 child exit 时才报告 `READY`，不把这个时序检查夸大为未来存活保证；
- 正常 STOP 由降权 child 的控制线程调用 `hev_socks5_tunnel_quit()`；root parent 最多等待 3 秒，再 TERM 等待 1 秒，最后 KILL 并只再等待 1 秒；无论 worker 是否按期 reap，root parent 都继续独立清理并将异常结果失败关闭；
- v1 源码为收紧 root 权限，暂时只接受 local `10.253.0.1` 与 peer `10.253.0.2..10.253.255.254`。这不是把 Epic 的最终持久地址分配改成固定池；接 carrier 前仍须冻结“冲突时拒绝、由受信任策略选择其他池、或升级协议”的产品策略，daemon 不能自行提交任意 public/LAN route；
- build 会验证 parent/submodule remote、gitlink、commit、递归 clean tree、patch/license SHA；随后用 `git archive` 从精确锁定的 object ID 物化临时源码，在受控 tool environment 中全量重编，并以 macOS `lockf(1)` 内核锁串行发布 arm64/macOS 14 ad-hoc artifact、manifest、HEV MIT 与 lwIP BSD-3-Clause 文本；失败保留上一个完整 artifact，中断在下次运行时 rollback；
- 当前 source slice 明确拒绝 `--release` 和任意 signing identity，在 CI 能验证指定 Developer ID certificate、Team ID 与最终分发容器 notarization 之前不产生可 promotion 的签名声明。

### 2026-08-16 后续 review 与 source 修复

`resident supervisor` 的首次真实 gate 随后被 read-only security review 正确打回。旧安装 artifact 有两个会使 runtime 证据失真的问题：`fork` 后 parent 没有关闭 accepted control fd，可能让 `closed` 永远 pending 并逐 session 泄漏 descriptor；`wait_for_session()` 还把六秒 deadline 从 `fork` 开始计算，健康 tunnel 会被提前 SIGKILL。

- source 已修复 parent `close(control_fd)`；`wait_for_session()` 现在只在 supervisor 收到 shutdown signal 后开始 bounded TERM→KILL deadline，健康 session 不再有固定六秒生命周期；native fake-helper regression 同时覆盖异常退出 EOF 和超过七秒的持久 session，真实通过；
- source-locked rebuild、helper/supervisor `-Werror`、protocol test、installer boundary test、Clang static analysis、typecheck、lint、format 和 diff checks 均通过；helper digest 保持 `42d32f41737854a161b7bcb27ac716612f0d6a7bd88ea863ee2ff8d30c17c96c`，修正 supervisor digest 为 `d1ebff9d0d2ef5e4410b3ce9e762371b432846e3ebcefe6987d57e62feaa3fd2`；
- 已安装 LaunchDaemon 仍运行旧 supervisor digest `50ddb6298eb819975ac7fa1d9f771ce1d8c51dfaf91fc669437fbeb361f4b5e1`。按“一次授权”边界，本轮没有再次执行 installer；此前旧 binary 的短时 traffic 只能证明当时流量曾通过，不能证明修正 artifact 的持久 session、EOF 或 no-residue gate；
- `install.mjs --install` 现已把 initial-install-only 作为代码边界：当前机器已有 LaunchDaemon 时，它在进入 `osascript` 前直接失败；focused test 同时锁定普通用户 preflight、root 侧二次拒绝和不可执行 user-owned privileged script；
- Apple 平台机制核对表明，当前 npm/CLI + ad-hoc artifact 没有可安全静默更新旧 root supervisor 的信任根。未来必须由首次安装建立 Developer ID/Team ID/notarized 的受信任 upgrade boundary，或采用受系统支持的 signed helper bundle；不能给 ad-hoc supervisor 增加接受 user-writable binary 的 root update API，也不能靠每次 update 再请求密码；

在范围纠正前，这些缺口意味着 helper 不能发布或接入 daemon：修正 artifact 的真实 root gate、daemon bootstrap、地址冲突策略、正式可复跑 fault matrix、install/upgrade/remove、Developer ID/notarization、Mihomo 启动顺序和 release packaging 均未关闭。当前 ad-hoc binary 不进入 npm tarball；范围纠正后也不得继续投入这些工作。

## 责任边界

### daemon

- 以普通用户权限运行，不直接打开 `/dev` 或 macOS utun control socket。
- 只通过 helper 的受限本地 IPC 请求 `status`、`start`、`stop` 和必要的健康状态。
- 为每个 start 生成 capability，绑定远程 daemon identity、虚拟 peer IP 和 carrier adapter；不把任意用户输入原样传给 HEV。
- 关闭或 helper 断开后停止接受新 stream，并等待已知资源进入终态。

### privileged helper

- 一次性安装后由 macOS 的受信任启动机制托管；每次 daemon 启动、连接、重连、停止和测试都不得通过临时 `osascript` 提权。
- root parent 只保留安装 `/32`、持有 TUN 和最终清理所需的最小权限；远端可影响的 HEV/lwIP packet processing 不在 root address space 运行。
- dropped-UID child 链接 BySpace 从 pinned HEV source 构建的 library，并从普通控制线程调用 `hev_socks5_tunnel_quit()`；root parent 对 child 执行 3 秒正常停止、1 秒 TERM、随后 KILL 的有界监督。
- 只创建/删除 BySpace 管理的 TUN 和精确 peer `/32` route；拒绝默认路由、DNS、系统代理、防火墙、Mihomo 配置和任意 shell 命令。
- IPC 只接受固定版本、固定操作和受约束的 IPv4/端口/MTU；未知字段、重复 stop、越权 peer 或非 BySpace-owned resource 都失败关闭。
- 不使用 HEV 的任意 `post-up-script`/`pre-down-script` 作为产品权限边界。若 HEV 当前 library API 无法在无 shell hook 的情况下可靠暴露 interface lifecycle，需携带一个最小、可审计的 source patch 或 native adapter，不能把 shell 拼接伪装成 helper API。
- LaunchDaemon/supervisor 必须监督整个 root-parent/worker process group；root parent 被强杀、child quit 卡死时也必须 KILL child，并验证没有残留接口、route 或 helper-owned listener。

## 未先选死的安装技术

需要在 macOS 目标版本上用真实安装/卸载实验冻结一种受系统支持的管理员边界，例如受签名保护的 LaunchDaemon/helper 安装方式。不能因为 `osascript with administrator privileges` 能完成一次穿刺，就把它当成产品安装方案。

安装方案必须回答：

- daemon 如何发现 helper 版本、状态和 socket，而不信任可写目录中的同名程序。
- helper 二进制、HEV source patch、静态依赖和 license 如何固定、签名、notarize 和升级。
- 多个 daemon 实例、daemon 崩溃、helper 崩溃、系统睡眠和卸载时谁拥有唯一的 TUN/route 清理权。
- 本地 IPC 的文件 owner、mode、nonce/认证、重放保护和协议版本如何验证。

## 验证契约

1. macOS ARM64 从固定 HEV parent/submodule commit 和 hash-locked patch 重复执行 source-locked build；产物带 Developer ID 签名、notarization、完整 transitive license、pre-sign digest 和 signed digest 证据。时间戳签名后的字节不要求跨运行相同。
2. 普通 daemon 无管理员权限时只能得到明确的 helper unavailable 错误，不留下接口、route 或 listener。
3. helper start 只创建一个 BySpace-owned TUN 和一个专用 overlay 策略内的精确 `/32`；IPC 不能诱导它路由 public/LAN 地址，或改动默认 route、DNS、系统代理、防火墙或 Mihomo。
4. helper 正常 stop、daemon 崩溃、helper 强杀、启动中途失败和系统侧 route 冲突都能收敛；活动 stream 明确关闭，资源无残留。
5. HEV library `quit()` 在正常控制线程执行；TERM fallback 只做监督兜底，不是正常关闭路径。
6. Mihomo 先启动、BySpace 先启动、Mihomo 重启和 reverse-start 顺序均有接口/route/普通代理快照；不自动改写 Mihomo。
7. 通过受控 local SOCKS fixture 重跑 TCP、half-close、gzip HTTP、WebSocket 和 backpressure；真实 Relay/E2EE carrier 留给后续 Issue，不在这里假装完成。

## 不在本 Issue

- daemon-to-daemon identity、E2EE handshake、Relay production route、stream multiplexing。
- Browser Tab、Ports UI、安装设置页和国际化。
- UDP、P2P、远程 LAN 子网、内部 DNS、默认路由和完整 VPN。
- Windows/Linux 的支持承诺；各平台另行选择 helper/data plane 后再开 Issue。
- 继续修补旧 HTML Bridge、CookieJar 或 HTML response rewriting。

## Closure (2026-08-16)

Closed with user authorization as a superseded implementation experiment, not as a released privileged-helper feature. The original delivery contract remains intentionally unmet: there is no trusted upgrade path, corrected-artifact root runtime gate, daemon bootstrap, notarized release asset, complete install/remove lifecycle, or supported virtual-network product.

Quality conclusion at closure:

- **Functional suitability and reliability:** source-level helper framing, privilege separation, bounded shutdown, and focused regressions are useful evidence, but the stale installed artifact cannot validate the corrected source and no product capability depends on it.
- **Information security:** root ownership is limited in source design and ad-hoc self-update remains rejected. Absence of Developer ID/Team ID/notarization trust means the artifact must not be promoted or silently updated.
- **Compatibility and maintainability:** the helper never became a prerequisite for selected-port access. Freezing it avoids administrator prompts, TUN routing, platform-specific packaging, and a second lifecycle system in the supported product path.

The owning Epic graduates only the negative product boundary: current Remote Port Access requires no privileged helper, TUN, route, installer, or update chain. Native implementation details and unresolved gates remain archived here and do not enter Project Spec.

No follow-up Issue is created. Reopening this direction requires a new explicit transparent-networking requirement and fresh platform trust decisions.
