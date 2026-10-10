# Daemon 隧道的性能实测与「为什么是强制 relay」的架构依据

> **读者：** 半年后有人问「隧道为什么不像 Tailscale 那样打洞直连」「走官方 relay 到底多慢」「能不能扛住前端连后端的高频调试」时，先读这条。
> **自检：** 一句话结论 · 触发场景 · 细节/数字 · 相关 issue/spec/代码位置。

---

**结论：** 隧道栈本身不是瓶颈（本地 relay 实测 2379 RPS / 62.7 MiB/s，p50=0.3ms——E2EE + 帧转发 + 每 TCP 流独立隧道的全部开销 < 0.5ms）。**延迟完全由 relay 的网络位置决定**：走官方 CF relay 时 p50=449ms，是「B→CF→A × 4 段公网」的物理绕路（本机到 relay.byspace.cc.cd 裸 HTTPS 一次 ~500ms，CF 边缘在 LAX），不是实现慢。架构上 owner 已拍板**排除 P2P 打洞**（其网络环境打洞永远不成功），强制 relay + 出站 WebSocket 恰好换到「稳定 > 延迟」的目标主场；自托管 relay 就近部署是延迟优化的正解（062/063 已支持且文档化）。

**何时用：**

- 评估隧道能否支撑「前端在 B 机、后端在 A 机、调试期高频请求」类场景。
- 有人提议改 Tailscale 式直连 / 质疑官方 relay 延迟。
- 决定 relay 部署位置（官方 vs 自托管）时。

**细节（2026-10-09 实测，Mac M 系，in-process 双 daemon + relay）：**

| 指标                                              | 本地 relay（纯栈开销）         | 官方 CF relay（公网）          |
| ------------------------------------------------- | ------------------------------ | ------------------------------ |
| 串行小请求（1KB JSON）                            | 2379 RPS，p50=0.3ms，p99=2.3ms | 1.8 RPS，p50=449ms，p99=1926ms |
| 并发 10 路                                        | 3630 RPS                       | 16.2 RPS                       |
| 5MiB 响应吞吐                                     | 62.7 MiB/s（≈500Mbps）         | 0.2 MiB/s                      |
| 新建连接（无 keep-alive，含一次 tunnel.open RPC） | +0.33ms，1108 RPS              | +~500ms，p50=949ms             |
| 无隧道基线                                        | 14179 RPS                      | 4679 RPS（公网直连基准）       |

- **449ms 的构成**：4 段公网 RTT（B→CF→A 请求 + A→CF→B 响应），每段 ~110ms。CF Tunnel（cloudflared）在同拓扑下是同样的 4 段——同构架构同量级，不是我们慢。
- **对比 Cloudflare Tunnel**：同构（强制中继 + 出站连接）。我们占优：E2EE（CF Tunnel 的 TLS 终结在 CF，**CF 可见明文**）、relay 可自托管。它占优：实现成熟度（Go/QUIC、边缘网络优化）。
- **对比 Tailscale**：打洞成功时 P2P 直连 1×RTT，物理上优于任何 relay 架构；但打洞失败退化为 DERP 中继后与我们的 relay 模式同构（4×RTT，国内 DERP 也在海外），还要 L3 全网暴露 + 客户端安装。**Owner 网络 = 打洞永远不成功 → Tailscale 的核心优势拿不到，成本全在**，结论是 relay 架构对该环境更优。
- **keep-alive 很重要**：浏览器 fetch 默认复用连接，正常调试无感；短连接工具（每次新建 TCP）在公网上每请求多 ~1 个 RTT 的 open RPC 开销。
- **自托管 relay 是延迟正解**：部署在 A 机或同城（自托管镜像 = web + relay 一体），延迟回落到局域网/同城级，吞吐顶到带宽上限。官方 relay 适合轻量查看，不适合高频调试与大文件。
- **已知的稳定性行为**：断线后 daemon 自动重连（relay 杀掉重启后 e2e 验证恢复）；tunnels.json 持久化 + boot 恢复。中断时**进行中的 TCP 连接会断**（HMR WS、上传中的请求需上层重试）——浏览器 fetch 会自动重试故多数无感，若未来有痛点再做会话保持。

**相关：** issue 062（`byissue/issues/062-x-daemon-tunnel.md`）、063（实验性门控 + 自托管 relay 文档化）；`byissue/spec/connection.md`「Daemon 隧道」节；性能探针脚本的量法可参考 062 执行记录（临时脚本，未入库：双 daemon + `/small` 1KB、`/large` 5MiB、fresh-connection 对照无隧道基线）。
