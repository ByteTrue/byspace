# 同条件 workload 如何形成 Direct Terminal 证据

## 读者先带走什么

在同一台机器、同一 Chromium、同一 viewport 和同一 loopback Direct 条件下，当前 BySpace Web 的输入、PTY 往返、xterm 解析、持续输出和 resize 时间没有落后于 Orca Web；五次重复样本中，BySpace 在每项已测时间指标上都更快。这只排除了 raw hot path 作为首要性能根因，不代表键盘、剪贴板、bracketed paste、图片输入和视觉呈现已经达到完整 Terminal 体验。

## 测量怎样从输入走到结果

每个产品都启动隔离的 server/daemon、临时仓库和真实 Web client，不经过 Relay，也不连接 BySpace 的 `~/.byspace` 或 6777 主 daemon。Orca 使用临时 profile 完成一次配对，Terminal 实际 ID 为远程 runtime terminal，并经过 `terminal.multiplex`；BySpace 使用现有 Playwright 隔离 daemon 和 Direct WebSocket。

浏览器在真实 xterm 上记录四个落点：

1. 捕获 `keydown`；
2. xterm `onData` 产生输入；
3. PTY workload 回传带序号的 OSC 777 marker，浏览器 parser handler 记录输出已到达；
4. xterm `onWriteParsed` 记录该批输出已 commit。

持续输出 workload 每 5ms 写约 16KiB、持续 4 秒；TUI workload 使用 synchronized update 重新绘制整个可见网格；吞吐 workload 输出 50,000 行；resize workload 在 1040–1280px 间交替改变 viewport，并等待 xterm resize 后两个 animation frame。

## 运行条件

- 日期：2026-07-21。
- 主机：同一台 macOS 机器。
- 浏览器：同一个 Chromium 145.0.7632.6 headless binary。
- 浏览器身份：两边都使用 Playwright Desktop Chrome 的 Windows UA，避免产品按 UA 选择不同分支。
- viewport：1280×720。
- renderer：两边都确认一个 xterm WebGL canvas。
- transport：loopback Direct，不经过 Relay。
- 样本：每个产品独立运行 5 次；表中是五次 run-level 数值的中位数。

两边产品布局和默认字体不同，因此可见网格不同：Orca 为 75×41，BySpace 为 131×45。固定 50,000 行吞吐不受网格大小影响；TUI workload 按实际网格重绘，BySpace 每帧反而生成更多单元格，仍保持更低延迟。

## 结果

| 指标                            | Orca Web Direct | BySpace Direct | 解释                                                        |
| ------------------------------- | --------------: | -------------: | ----------------------------------------------------------- |
| idle keydown → xterm commit p50 |          16.8ms |          7.8ms | BySpace 没有 Orca Web 普通输入/输出调度带来的约一帧固定等待 |
| idle keydown → xterm commit p95 |          18.0ms |          9.2ms | 两边都稳定，BySpace tail 更低                               |
| 持续输出下 keydown → commit p50 |          17.5ms |          6.9ms | BySpace 当前 direct write 未被 16KiB/5ms workload 压住      |
| 持续输出下 keydown → commit p95 |          26.3ms |         11.0ms | 没有证据支持先搬 Orca renderer scheduler                    |
| synchronized TUI redraw p50     |          17.4ms |          8.5ms | BySpace 在更大实际网格下仍更快                              |
| synchronized TUI redraw p95     |          19.1ms |          9.4ms | 未复现用户感知的 TUI 响应落后                               |
| 50,000 行 parse 完成            |         139.5ms |         91.9ms | BySpace 解析约快 34%                                        |
| 50,000 行 paint 完成            |         162.1ms |        106.6ms | BySpace 到后续绘制约快 34%                                  |
| 吞吐                            |        1.97MB/s |       3.00MB/s | 固定 payload 下 BySpace 更高                                |
| 最大 rAF gap                    |          25.9ms |         10.2ms | 本 workload 下 BySpace 主线程让帧情况更好                   |
| resize → 两帧后 p50             |          41.5ms |         14.2ms | BySpace 当前 resize 首次可见响应更快                        |
| resize → 两帧后 p95             |          65.9ms |         21.5ms | 未证明需要先移植 Orca resize scheduler                      |

完整五次 run-level 数组保存在 `baseline-results.json`。

现有 BySpace 专项 stress test还验证了 600 字符零延迟 burst：无 agent load、1000 条小 agent stream 更新和单个约 256KiB diff 三种场景的总完成时间分别约 187ms、182ms、198ms，没有观察到共享 WebSocket 使本轮 workload 明显退化。该项没有等价 Orca 样本，因此只用于降低“立即拆独立 Terminal WebSocket”的优先级，不能证明生产环境的大型应用负载永远没有竞争。

## 已确认的默认呈现差异

| 默认值                       |      Orca |                         BySpace |
| ---------------------------- | --------: | ------------------------------: |
| 字号                         |      14px | 12px（复用全局 code font size） |
| 常规 / 粗体字重              | 500 / 700 |                   normal / bold |
| xterm minimum contrast ratio |       4.5 |                               1 |
| 实测网格                     |     75×41 |                          131×45 |

这些差异会直接改变字形大小、笔画密度、低对比 ANSI 色的可读性和整体视觉密度；它们仍是后续 headed 呈现 A/B 的候选，但用户随后确认了更基础的文本与图片 paste 语义缺口，因此不再默认作为首个实现。BySpace 还默认加载 ligatures addon，而 Orca 默认关闭；单次 A/B 曾显示逐键 p50 从 4.8ms 到 3.3ms、吞吐不变，但样本不足，不能作为当前结论。

## 这轮证据排除了什么

- 没有证据支持把 Orca Web renderer scheduler 作为首个 raw 性能实现；这不排除修复 Orca 已支持、BySpace 缺失的输入语义。
- 没有证据支持把独立 Terminal WebSocket 作为 Local Direct 的首个实现。
- 没有证据支持为了追平 Orca 而改变 BySpace 的即时 input 或 leading-edge output。
- 当前绝对性能预算应基于 BySpace 自己更快的基线防回退，而不是把 Orca 较慢的数值当作目标。

## 仍未知什么

- headless、隔离 app 没有复现用户日常 headed 浏览器、真实 agent UI、长期历史和生产主题组合；并且本 workload 没有覆盖文本/图片 clipboard 语义，不能据此声称体验已经 100 分。
- 默认字号、字重、contrast 与主题颜色之间哪个因素贡献最大，需要在真实 headed 浏览器做分离 A/B。
- 多 MiB agent payload、持续 React commit 或多个活跃 Terminal 是否会暴露共享主线程/连接竞争，仍需后续有症状证据时再测。
- 多行文本与图片 paste 的缺口已经转入 `terminal-paste-path.md`；它们属于行为正确性，不由本文件的毫秒基线解释。
- Relay 的 RTT、加密、ACK 和恢复不在本轮范围。

## 证据入口

- `packages/app/e2e/terminal-direct-baseline.spec.ts`：BySpace 的同义浏览器探针与 opt-in 基准。
- `packages/app/e2e/fixtures/terminal-direct-workload.mjs`：双方共用的 idle、load 与 synchronized TUI workload。
- `packages/app/e2e/terminal-keystroke-stress.spec.ts`：BySpace burst input 与 agent message 竞争证据。
- `baseline-results.json`：本轮五次完整 run-level 摘要。
