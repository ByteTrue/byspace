# 一次键盘输入如何成为可见的 Direct Terminal 更新

## 读者先带走什么

BySpace 与 Orca Web 都把浏览器输入送到 daemon/runtime 的 PTY，再把二进制输出送回同一浏览器中的 xterm；差异不在“浏览器还是原生 renderer”，而在输出怎样隔离、排队、流控并让 xterm 消费。

## 主路径

用户在浏览器 Terminal 中按键后，xterm 或自定义键盘处理器生成输入。Direct transport 将输入发给本机或局域网中的 daemon/runtime，PTY 写入 shell 或 TUI；程序产生的输出经过服务端聚合后，以二进制帧返回浏览器。浏览器解码并按 Terminal 标识分流，最终交给 xterm 解析、更新 buffer 并由 WebGL 或 DOM renderer 绘制。

BySpace 将 Terminal binary、文件帧和 agent/control 消息放在同一 daemon WebSocket 上。服务端 PTY worker 和每客户端各有一层 leading-edge coalescer；浏览器同步分流 output，并连续提交给 xterm 自身的有序写队列。权威 headless snapshot 与 revision 负责慢客户端恢复。

Orca Web 为 `terminal.multiplex` 建立独立 child WebSocket，一个 runtime 的多个 Terminal 共用该连接。服务端按 stream 维护 sequence、in-flight credit、pending output 和 snapshot 恢复；浏览器解密和分流后，复用 Orca 的 renderer output scheduler，以分片、时间预算和主动 yield 控制 xterm 消费。

## 关键责任、数据和状态

- 输入即时性：BySpace 当前直接发送浏览器 input，并在 worker 同一事件循环批量写 PTY；Orca Web 对普通 input 有短 debounce，但 query reply 可以立即发送。对照不能只测 transport 参数，必须从真实 keydown 到可见 commit。
- 服务端输出：BySpace 以 output revision 维持 snapshot 顺序；Orca Web 以 stream sequence 和 receipt ACK 维持窗口与 gap recovery。两者都能恢复，但可观测的背压信号不同。
- 浏览器消费：BySpace 主要依赖 xterm 内部写队列；Orca 显式调度每轮写入量和时间，并给输入与 paint 让路。
- 应用竞争：BySpace 的大型 agent JSON 与 Terminal 共用 WebSocket 和浏览器主线程；Orca Web 的 Terminal transport 独立，但最终 xterm 与应用仍共享浏览器主线程。
- renderer：两者都优先使用 xterm WebGL，并在不可用或 context loss 时回退；基准必须记录实际 renderer，不能把 fallback 样本混入正常样本。

## 关键分支与边界

- idle echo 与持续 bulk output 是不同路径：首块延迟低不代表高负载时仍能及时让出输入和绘制。
- 独立 WebSocket 能避免同一 socket 的顺序排队，但不能自动消除另一个 handler 造成的主线程 JSON parse/render 长任务。
- receipt ACK 证明浏览器 transport 已消费，不等于 xterm parser 已 commit；两者不可混成同一个阶段指标。
- snapshot 恢复可以跳过中间绘制以保证最终正确，但吞吐测试必须区分连续 live output 与 snapshot catch-up。
- Relay 加密、Cloudflare 路径和公网 RTT 不属于本轮 Direct 归因。

## 影响范围

- 必须修改：本轮只建立可比测量、共享 workload 和证据，不修改产品 hot path。
- 需要验证：同一浏览器身份、同一 viewport、真实 WebGL、真实 PTY 往返、持续输出、TUI 全屏重绘和 resize；这些入口已经以五次隔离样本验证。
- 仍待调查：默认字号、字重、minimum contrast ratio 与 ligatures 对 headed 浏览器主观清晰度的独立贡献；多 MiB agent payload、多 Terminal 和长期历史下是否出现本轮没有覆盖的竞争。

## 当前归因

同条件基准没有复现 BySpace Direct 的 raw latency、吞吐、TUI 或 resize 落后；BySpace 在所有已测时间指标上反而更快。Orca 独立 Terminal WebSocket、credit/ACK 和 renderer scheduler 是值得保留的后续设计参考，但当前没有证据支持先移植它们。

两边已观测到的主要可见差异是默认呈现：Orca 使用 14px、500/700 字重和 4.5 minimum contrast ratio；BySpace 使用 12px、normal/bold 和 1。下一步应把这些变量拆开做 headed A/B，而不是用 transport 重构解释尚未被测量复现的主观差距。详细方法、结果和限制见 `direct-benchmark-evidence.md`。

## 仍未知

- 用户日常 headed 浏览器、真实 agent UI、主题和长时间历史是否会触发隔离 headless 基准没有覆盖的路径。
- 默认呈现变量中，哪一个对“渲染更好”的贡献最大。
- 更极端应用竞争是否会使独立 Terminal transport 从后续参考升级为必要改变。

## 证据索引

- `docs/terminal-performance.md`：BySpace 当前性能路径、不变量、基准入口和 Orca Web 对照摘要。
- `packages/app/src/terminal/runtime/terminal-emulator-runtime.ts`：BySpace xterm 写入、WebGL、fit 与 commit 落点。
- `packages/client/src/daemon-client.ts`：BySpace 单连接上的 binary/JSON 接收与分流。
- `packages/server/src/terminal/terminal-session-controller.ts`：BySpace per-client output、backpressure 与 snapshot recovery。
- `scripts/benchmark-terminal-latency.ts` 与 `packages/app/e2e/terminal-keystroke-stress.spec.ts`：BySpace 已有 daemon 和浏览器阶段化测量基础。
- Orca `src/renderer/src/runtime/web-runtime-client.ts`：paired Web subscription 的 child WebSocket 与二进制 E2EE 路径。
- Orca `src/renderer/src/runtime/remote-runtime-terminal-multiplexer.ts`：浏览器多路复用、sequence gap 与 ACK。
- Orca `src/main/runtime/rpc/methods/terminal.ts`：服务端 batch、credit、pending 与 snapshot 恢复。
- Orca `src/renderer/src/lib/pane-manager/pane-terminal-output-scheduler.ts`：共享 Web renderer 的分片和时间预算调度。
- `direct-benchmark-evidence.md` 与 `baseline-results.json`：同条件方法、五次样本和当前归因。
