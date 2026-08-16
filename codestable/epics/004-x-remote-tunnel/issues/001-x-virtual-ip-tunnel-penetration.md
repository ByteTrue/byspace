---
kind: issue
title: 虚拟 IP Tunnel 垂直穿刺
type: feature
status: closed
created: 2026-08-13
updated: 2026-08-16
---

# 虚拟 IP Tunnel 垂直穿刺

## 2026-08-16 范围纠正

用户确认实际需求只是按需访问另一个 daemon 的选定端口，并未要求一个虚拟 IP 自动覆盖所有端口。本 Issue 的 TUN/虚拟 IP 方向因此被已关闭的 `003-x-on-demand-tcp-forward.md` 取代，不再是产品前置条件。

本文件继续保留已经完成的可行性证据，但不再推进实现。Issue 已按用户授权作为被取代的可行性实验关闭；不得据此恢复 TUN、路由或管理员权限工作。

## 做成以后是什么样

在当前开发机上启用 Mihomo TUN 后，安装一个最小 BySpace 网络穿刺组件，为另一个“远程 daemon”分配单个虚拟 IPv4 地址。访问：

```text
http://<远程虚拟 IP>:23000
```

必须经过 BySpace TUN 与一个普通 carrier socket，到达第二个进程的 `127.0.0.1:23000`。用户不创建本地端口映射，目标端口保持不变；停止穿刺后，BySpace 创建的接口、路由和进程全部消失，Mihomo 和普通代理流量继续工作。

**范围：** 证明 TUN/userspace TCP、Mihomo 外层、同端口转发和生命周期可行；不交付正式 daemon 协议或产品 UI。

**归属：** `codestable/epics/004-x-remote-tunnel/spec.md`。

## 为什么先做这个

现有 Preview transport 已证明 daemon 可以通过 Gateway 代理 HTTP/WebSocket，但它没有证明操作系统虚拟 IP、TUN 共存、userspace TCP termination、管理员权限和网络状态回收。它继续加厚也不能降低这些新风险。

如果先实现 daemon RPC、Cloudflare pairing、Browser UI 或安装流程，最核心的本机网络路径失败时会留下大量不可复用代码。因此本 Issue 只回答一个 go/no-go 问题：是否存在许可证、平台能力和生命周期都可接受的成熟组件，让 BySpace 用很薄的适配层提供虚拟 IP。

## 穿刺边界与数据流

```text
测试客户端
  → 远程 peer 虚拟 IP:23000
  → 精确 /32 route
  → BySpace TUN / mature userspace TCP engine
  → 普通 TCP/WebSocket carrier
  → 第二个测试进程
  → net.connect(127.0.0.1, 23000)
  → fixture
```

- 虚拟地址从当前机器未使用且不与现有路由、Mihomo Fake-IP 或常见 Overlay 网段冲突的地址池选择。
- BySpace 不安装默认路由，不接管 DNS，不修改系统代理、Mihomo 配置或全局透明代理规则。
- carrier 使用普通操作系统 socket，使 Mihomo 可以继续作为最外层；穿刺不要求绕过 Mihomo。
- 远程侧只连接 `127.0.0.1` 的原目标端口，不创建 TUN，也不注入系统路由。
- 穿刺可以使用受控测试 carrier，不提前设计生产 Relay multiplexing、身份或恢复协议；不得通过未加密公网 carrier 发送真实用户数据。
- 优先评估成熟、许可兼容、可分发的 TUN/userspace networking 组件。没有合适组件时给出停止结论，不自行实现 TCP/IP 栈。

## 质量承诺

- **功能适宜性：** 一个虚拟 `/32` 的任意测试 TCP 端口按同端口到达远程 loopback；至少用 TCP echo、HTTP gzip body 和 WebSocket 双向消息证明。
- **兼容性：** Mihomo TUN 开启前后均可运行；BySpace 启停不改变普通请求的既有代理路径。carrier 可以由 Mihomo 承载，不要求用户关闭代理。
- **可靠性：** 正常停止、强制终止和启动失败都不能遗留 BySpace route、TUN device、helper 或监听进程；再次启动结果确定。
- **信息安全性：** 提权 helper 只接受建立/删除 BySpace 精确路由和接口所需的最小操作；穿刺 capability 不授予任意命令执行或系统代理修改。
- **可维护性：** 候选组件必须给出许可证、支持平台、发布方式、活跃维护状态和 BySpace 需要维护的适配面；自研网络栈判定为不通过。

## 风险按这个顺序打通

1. **组件选择：** 比较最少数量的成熟候选，先排除许可证、平台或分发边界不成立者；不为“以后可能”设计统一抽象。
2. **单机 TUN：** 在 Mihomo 开启时只安装一个 `/32`，证明测试连接进入 BySpace，普通连接仍按原路径。
3. **TCP termination：** 将进入 TUN 的一条 TCP 连接转换为有 backpressure 的字节流，不整包缓冲。
4. **第二进程同端口：** 经受控 carrier 到第二个进程，由它连接 loopback 同端口。
5. **真实协议：** 依次验证 TCP echo、HTTP gzip 字节保真和 WebSocket；不在本 Issue 扩大到 UDP。
6. **故障与回收：** 分别终止客户端、carrier、远程进程和 helper，检查连接与系统网络状态。
7. **Mihomo 顺序：** 覆盖先启动 Mihomo、先启动 BySpace，以及 Mihomo 重启后的行为；只有真实冲突时才记录所需的单条排除建议。

## 穿刺结果（2026-08-15）

**结论：macOS ARM64 数据路径 go，产品化有条件。** Mihomo TUN 已持有默认路由时，成熟 userspace TCP engine 可以用独立 utun 只接管一个虚拟 `/32`，按原端口把 TCP 字节送到第二个进程的 loopback，并在强杀后由内核回收接口与路由。`hev-socks5-tunnel` 可作为首选数据面，但它的原始 CLI 生命周期不够可靠，不能直接成为 BySpace sidecar。本轮证明的是 TUN 共存，不是 carrier 已经实际经过 Mihomo 或 Relay。

### 组件选择

| 候选                              | 结论           | 证据与边界                                                                                                                                                                                                                                                                              |
| --------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `heiher/hev-socks5-tunnel` 2.17.1 | **首选数据面** | 官方 tag/Release 对应提交 `9a06bc6e7989da54e3d32ff701ef7a7ce4995d3a`；源码构建的 Darwin ARM64 可执行文件约 308 KiB，SHA-256 为 `458d5125bdffc32121ae9fb537f00eb65314e959931fbcb7c8164690a88f6b60`。它能动态创建 utun、传出实际接口名，也提供 library、外部 TUN fd 和显式 `quit()` API。 |
| `xjasonlyu/tun2socks` v2.7.0      | **保留为备选** | MIT，Darwin ARM64 release 可执行文件约 8.8 MiB；Go/gVisor 依赖面和 BySpace 自行配置动态接口/路由的工作都更大。只有 HEV library wrapper 路径后续不成立时再切换，不提前做统一抽象。                                                                                                       |

HEV 顶层、SOCKS core、task system 与 libyaml 为 MIT；lwIP 为 BSD-3-Clause。Windows 依赖的预编译 Wintun 使用单独的可再分发条款，只允许以其 API 方式随使用它的软件分发且不得修改；Windows 打包仍需单独验证。上游发布 Darwin、Linux、Windows 等资产只证明存在构建入口，本 Issue 只实测了 macOS ARM64。下载的 Darwin 二进制是 ad-hoc 签名且未通过 Gatekeeper 评估，因此产品必须固定源码/提交自行构建，再随 BySpace 完成平台签名与发布验证。

候选审计使用 `gh api`、`git show`、`make`、`file`、`shasum -a 256`、`codesign` 和 `spctl` 完成；上面的精确大小、哈希与签名状态是本轮本机观察值，原始命令输出没有作为持久 artifact 入库。正式 CI 必须从 pinned source 重复产生并验证这些供应链证据，不能把本轮数值当可复现发布证明。

### 实际闭环

实测环境为 macOS 26.6.1 ARM64，Clash Mi 的 Network Extension 已占用 `utun8` 并持有默认路由。穿刺从 HEV 2.17.1 源码构建数据面，以管理员权限创建 `utun9`：

```text
10.253.254.2/32 → utun9
utun9 local address: 10.253.254.1/32
default route → utun8 (Mihomo，始终不变)
```

测试 viewer 只接受 `10.253.254.2` 和允许的 fixture 端口，把 SOCKS CONNECT 转成普通 TCP carrier；第二个 peer 进程验证虚拟 IP 后，只连接 `127.0.0.1:<原端口>`。carrier 和 fixture 都在本机受控进程内，没有把未加密测试协议用于公网，也没有提前实现 Relay/E2EE。临时 harness 位于 `/tmp/byspace-tunnel-spike.rjAJ2q/spike/`，没有进入产品代码。

协议与资源结果：

- TCP 持续连接回传 1,048,576 字节，SHA-256 `631b84027d6b9e52b539c4e8373622d23032dfadc64d60af87339c9037e4f769`。
- TCP half-close 回传 262,144 字节，SHA-256 `8b666f88f7b033f647f9b5ae66d668b7bb88376630dbecfb0fba757f4f84334c`。
- HTTP gzip wire body 为 583 字节，SHA-256 `5a24d53e991d301a02cc693c2d11c0337cf3079f5ecd47a1daf619408b42877f`；解压后为 172,032 字节，SHA-256 `d5469e300b5edd7e3f24500981eb6c371e2b674e6befeb6276fe9972928db664`。
- WebSocket 文本、512 字节 binary 和 `1000` close code 均按字节往返。
- 64 MiB 慢回压测试在约 1.95 秒内回传同一 SHA-256 `98dc891b284e4d84ac25b0c0a24fdbe39a7f0dbd643ad5e8aa06e02fc6258254`。本轮 `ps` 轮询观察到 HEV RSS 峰值比基线增加 80 KiB、viewer 增加约 17.4 MiB、peer 增加约 23.7 MiB；这些单次采样支持“本次没有按 64 MiB payload 整体缓冲”，但不是长期内存上界证明，且采样原始输出没有持久化。正式 carrier 必须继续把 backpressure 作为协议不变量，并用可复跑基准保留 RSS/heap 证据。

故障与共存结果：

- 普通用户启动 HEV 立即以 `Operation not permitted` 失败，没有新增接口或路由；macOS 首版必须有显式管理员/helper 边界。
- 强杀远端 peer 后，活跃流在 45 ms 内关闭；保持 HEV/TUN 不变并重启 peer 后，全部协议探针无需重建 TUN 再次通过。
- HEV standalone CLI 在无活跃流时收到 TERM，3 秒内仍不退出。源码的 signal handler 直接调用包含自旋、sleep、fd write 和日志的 stop 路径；BySpace 不采用这个 CLI 生命周期。最低边界是 BySpace-owned supervisor 执行 TERM→短超时→KILL，更稳的产品方向是链接 library 并从正常控制线程调用 `quit()`。
- TERM fallback 到 SIGKILL 和直接 SIGKILL 两条路径都使 `utun9` 消失，精确 `/32` 自动撤销。持久 route/interface 快照证明网络条目无残留；最终交互检查也未观察到 HEV、supervisor 或 fixture listener，但进程快照没有作为 machine-readable artifact 入库，本轮也没有产品 helper。
- **library quit probe（同一 pinned source，2026-08-15）：** 以 `ENABLE_LIBRARY` 重建 `libhev-socks5-tunnel.a`，worker 运行 `hev_socks5_tunnel_main_from_file(-1)`，普通控制线程在一个活动虚拟 IP TCP 流存在时调用公开 `hev_socks5_tunnel_quit()`。结果 JSON 为 `{"mainResult":0,"quitJoinMs":688}`；活动流关闭，lifecycle 记录 `UP interface=utun9`/`DOWN interface=utun9`，停止后 `utun9` 与 peer `/32` 消失，默认路由仍在 Mihomo `utun8`。probe 和日志仍只在 `/tmp/byspace-tunnel-spike.rjAJ2q/`，这不是正式 helper 或发布证据。
- 持久 route 快照证明 BySpace 运行中只有 peer `/32` 指向 `utun9`，默认路由仍由 Mihomo `utun8` 持有；停止后 peer 又回到 `utun8`。本轮只保留了一份运行中 `scutil --proxy` 快照，harness 本身没有 DNS、防火墙、系统代理或 Mihomo 修改命令，因此不把这些面写成已经完成前后状态验收。carrier 使用本机 `127.0.0.1:19081`，没有证明真实 carrier 经 Mihomo 或 Relay。

当前仍有五类证据没有冒充为已完成：

- 为避免未经授权影响用户代理，本轮没有重启 Mihomo，也没有覆盖“先启动 BySpace，再启动 Mihomo”的反向顺序；应在正式 helper 验收时单独执行。
- carrier 和第二进程都在本机，实际 Mihomo carriage、Relay/E2EE、身份、授权、多路复用与并发 stream 完全未测，继续属于后续 Issue。
- viewer/client 强杀、route 冲突和持久地址分配也未覆盖。library `quit()` 的正常控制线程路径已由一次性 `/tmp` probe 实测，但尚未进入正式 helper、IPC 或可复跑产品测试。
- 可复跑 harness 与 RSS/process 采样目前只保存在 `/tmp` 或本轮执行记录。关闭前应把最小测试收敛为正式 helper/carrier 集成测试或受控验收工具，而不是把一次性脚本当产品骨架。
- 一次性管理员安装、签名/notarization、受限本地 IPC、无任意 shell hook 的 route 权限和跨平台打包仍未完成，归属新 Issue 002。

## 验证证据契约

穿刺结果必须留下可复跑命令或最小测试程序，以及以下证据：

- 启动前、运行中、停止后的接口与路由快照，证明只出现和删除 BySpace 所有的条目。
- Mihomo 开启时，一个普通 HTTP 请求在 BySpace 启停前后的代理行为一致。
- TCP echo 大小与哈希一致。
- HTTP fixture 返回 gzip body；客户端解压后的内容和 wire bytes 都与 fixture 预期一致。
- WebSocket text、binary、双向 close 正常。
- carrier 慢读或断开时内存有界，发送方得到 backpressure 或明确关闭。
- helper/sidecar 强制终止后无孤儿接口、路由和进程。
- 候选组件对 macOS、Windows、Linux 的支持矩阵与许可证结论；穿刺只要求当前开发平台实际跑通，不把未验证平台写成已支持。

## 不在这次穿刺里做

- 正式 daemon-to-daemon 身份、E2EE 握手、多路复用与恢复协议。
- Cloudflare 生产 Relay 路由、部署或发布配置。
- Browser Tab、Ports UI、设置页或国际化。
- 单 daemon HTTP Gateway 收敛。
- UDP、P2P、远程 LAN 子网、DNS、系统全局 VPN。
- 为旧 HTML Bridge、CookieJar 或页面改写继续补兼容。

## Closure (2026-08-16)

Closed with user authorization as a superseded feasibility experiment, not as a delivered virtual-IP feature. The macOS ARM64 probe established a conditional data-plane `go`, but the product requirement was narrowed to explicit selected-port forwarding before the TUN path completed its original delivery contract.

Quality conclusion at closure:

- **Functional suitability:** the experiment proved one exact `/32`, TCP byte integrity, half-close, gzip HTTP, WebSocket, backpressure, peer interruption, and cleanup on the tested macOS host; it did not produce a supported BySpace virtual network.
- **Compatibility and reliability:** Mihomo coexistence and kernel cleanup were observed for the tested ordering, while reverse startup, real Relay carriage, durable benchmarks, and full failure matrices remain unproven and are not claimed.
- **Information security and maintainability:** the mature-component and least-privilege constraints remain valid historical lessons; custom TCP/IP, arbitrary route authority, and the HEV standalone CLI lifecycle remain rejected.

Graduation is intentionally narrow: the owning Epic records that a mature TUN engine was conditionally feasible but is not required for Remote Port Access. Detailed component versions, hashes, probe results, and unresolved productization gaps remain archived in this Issue rather than becoming Project Spec.

No follow-up Issue is created. TUN or transparent virtual networking may resume only after a new explicit product requirement and a separately authorized Issue.
