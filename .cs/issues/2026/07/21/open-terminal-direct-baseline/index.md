---
kind: issue
title: "建立 Direct Terminal 同条件性能基线"
type: explore
status: open
created: 2026-07-21
epic: ".cs/epics/2026/07/21/terminal-experience/spec.md"
related_issue: ""
---

# 建立 Direct Terminal 同条件性能基线

## 探索问题与停止条件

- 要支持的理解或决策：在 Orca Web Direct 与 BySpace Direct 的相同运行条件下，哪些路径造成用户可感知的完整 Terminal 差距——不仅是时间性能，也包括键盘、剪贴板与应用输入协议——首个实现 Issue 应改变哪个责任边界。
- 本轮边界：浏览器键盘与剪贴板输入到 PTY、bracketed paste、图片粘贴、浏览器输入到可见 xterm commit、持续 PTY 输出时的调度、Terminal 与大型应用消息竞争、resize/reflow；只比较不经过 Relay 的 Web Direct 链路。
- 什么状态算足够行动：两套产品使用同一机器、同一浏览器、同一终端尺寸和同一 workload 得到可重复数据；性能与输入语义差距都能归因到明确责任边界；能够提出最小实现切片及其行为和回归预算。

## 一句话模型

浏览器输入经过各自的 Direct transport 到达 PTY，输出再回到同一个浏览器中的 xterm；同条件下分别测量输入、传输、接收、解析与 commit，才能区分网络之外的调度差异并决定先改哪里。

## 探索边界

- 已覆盖：双方 Terminal 主路径的源码比较；BySpace 的 worker、二进制 slot、coalescer、snapshot 与 xterm runtime；Orca Web 的独立 `terminal.multiplex` WebSocket、binary stream、receipt ACK、sequence recovery 与共享 renderer scheduler。
- 明确不展开：Relay 公网波动与加密优化；Electron-local 原生 PTY IPC；Ghostty 集成；最终协议或 scheduler 设计。
- 仍然未知：headed 浏览器、真实 agent UI、主题与长时间历史能否复现剩余渲染差距；真实 Windows ConPTY + headed Chrome 是否与 Windows user-agent E2E 一致，以及浏览器是否会在页面收到事件之前占用 Alt+V。

## 阅读路径

1. `direct-terminal-path.md`：先理解两套 Direct Web 路径如何把一次键盘输入变成可见更新，以及差异位于哪些责任边界。
2. `direct-benchmark-evidence.md`：再看同条件 workload 怎样测量、五次 raw 性能基线得到什么、排除了哪些 hot-path 实现方向。
3. `terminal-paste-path.md`：理解多行文本、图片剪贴板、Alt+V 与 Pi CLI 的输入语义为什么在两套产品中不同。
4. `baseline-results.json`：需要审计时查看每个产品五次 run-level 数组。

## 当前结论

五次同条件数据只证明当前 BySpace raw Direct hot path 在已测时间指标上不落后：idle/loaded/TUI keydown→commit、50,000 行 parse/paint、最大 rAF gap 和 resize→paint 都更快。它不能证明完整 Terminal 体验已经达到 Orca。

用户随后给出两个更基础的输入语义缺口：Windows 浏览器中无法把剪贴板图片交给 Pi CLI，多行文本在初次 snapshot attach 后失去 bracketed paste 包装并被应用逐行当作 Enter。后者已经由真实浏览器红测确认：直接收到 `CSI ? 2004 h` 时 xterm 会正确包裹 paste，但 snapshot reset 后只发送裸文本；前者的浏览器入口只调用 `navigator.clipboard.readText()`，没有图片读取、上传和 daemon 路径插入能力。

因此当前证据不支持先搬 renderer scheduler、拆独立 Terminal WebSocket，或先做呈现默认值 A/B。首个改变应先恢复多行文本 paste 语义；图片 paste 需要作为相邻但独立的跨 client/protocol/server 切片设计。

对应改变已关闭：`closed-terminal-bracketed-paste-restore` 在 snapshot/reload 后恢复 mode 2004；`closed-terminal-clipboard-image-paste` 复用现有 binary file upload，把浏览器图片写到 daemon 并 paste 服务端路径。Windows-platform E2E 已覆盖两条真实链路。

## 与具体变化的关系

- 必须修改：完整体验模型要把键盘、文本 paste、图片 paste 与应用协议语义列为一等约束；首个 bug 修复扩展现有 terminal input-mode replay，不另建状态机。
- 需要验证：snapshot attach/restore 后多行文本仍带 bracketed paste 标记；即使 Windows ConPTY 未转发 DECSET 2004，多行 clipboard 文本与生成的图片路径仍各自只进入一个安全 block；普通单行文本、非 Windows paste、Alt+V fallback、kitty/Win32 输入模式和现有 Direct 性能不退化。
- 仍待调查：字号、字重、contrast 与 ligatures 对 headed 主观体验的独立贡献；Relay 专项预算另由 Epic 承接。

## 用户修正与已排除理解

- “Orca 主要是 Electron/native 路径，Web 代码不可直接参考”：已被纠正。Orca 的 paired Web client 使用独立 E2EE WebSocket 和同一套浏览器 renderer scheduler，是本轮主要参照。
- “Direct 与 Relay 应达到同一性能分数”：已被纠正。Direct 是完整参考体验；Relay 允许时间特性和吞吐有界下降，但正确性、恢复和安全性不降级。
- “现在先拍一个固定毫秒预算”：已排除。先做同条件对照，再把结果固化为绝对回归预算。
- “先搬 Orca renderer scheduler 就能改善 Direct”：同条件数据不支持。Orca 的调度在远程/拥塞条件下仍有参考价值，但本轮 Direct workload 中 BySpace 已更快。
- “raw Direct 基准更快就等于完整体验已经 100 分”：已被用户纠正。原生感首先包含应用能理解的键盘、bracketed paste 和图片剪贴板语义；毫秒数据只能保护 hot path，不能替代行为验收。

## 待确认问题

- 探索已经达到自动化行动停止条件：raw 性能完成归因，snapshot mode 恢复、Windows mode 缺失兜底与图片 clipboard 均有真实 Browser→daemon→PTY E2E；mode-off capture 明确验证一个 bracketed block。
- 关闭前等待用户在真实 Windows ConPTY + headed 浏览器 + Pi CLI 复验图片与多行文本；用户确认后把稳定责任边界毕业到 Project Spec。

## 候选毕业位置

- 稳定 How it works 结论：用户确认关闭后进入 `.cs/spec/index.md` 的 Terminal 当前真相；除 Direct 性能基线外，还需毕业输入模式恢复与浏览器/daemon 剪贴板责任边界。
- 需要更新的阅读入口：`.cs/spec/index.md` 增加 Terminal 主路径与 Direct/Relay 质量分层。
- 留在目标 issue 的影响分析：文本 paste 修复继承 snapshot/input-mode 证据；图片 paste 继承 Orca/Pi 路径对照、安全边界和 Direct 100 分目标；呈现 A/B 保留为后续候选。
- 只留在 Explore issue 的证据与历史：跨产品原始样本、profile、被排除假设和临时探针说明。

## 关闭回写

- 合并到 Project Spec 的内容：用户确认关闭后，毕业 Direct Terminal 主路径、Direct/Relay 质量分层、当前 raw Direct 基线，以及输入语义的稳定责任边界。
- 更新的 spec index：`.cs/spec/index.md`。
- 留在目标 issue 的内容：bracketed paste 修复证据、图片 clipboard 设计、默认呈现变量、现有性能基线和验收约束。
- 留在 Explore issue 的内容：Orca 对照证据、原始测量与排除过程。
- 遗留问题：Relay 专项性能与恢复预算由 Epic 后续 Issue 承接。
