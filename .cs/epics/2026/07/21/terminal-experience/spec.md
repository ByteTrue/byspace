---
kind: epic
title: "把 Direct Terminal 做到完整体验"
status: active
created: 2026-07-21
---

# 把 Direct Terminal 做到完整体验

## 这个 Epic 要改变什么

让浏览器直接连接 daemon 时的 Terminal 成为 BySpace 的完整参考体验：在同一机器、同一浏览器和同一 shell workload 下，键盘与剪贴板语义、交互响应、持续输出、TUI 重绘、resize、字体渲染与长时间稳定性不得明显落后于 Orca Web Direct。

Relay 复用同一套正确的 Terminal 基础，但允许公网 RTT、端到端加密和中继调度带来有界的性能下降；不能因此降低输出正确性、恢复能力或安全性。

## 为什么现在做

当前 BySpace 已具备 xterm/WebGL、二进制 Terminal 帧、PTY worker、headless snapshot 和慢客户端恢复等基础，但用户实际感受到的完整 Terminal 体验仍明显落后于 Orca。首轮同条件证据排除了 raw Direct hot path 落后；用户随后确认了 snapshot 后多行文本失去 bracketed paste、浏览器图片 clipboard 无法进入 Pi CLI 两个输入语义缺口，因此后续按行为正确性继续归因，而不是先搬 renderer scheduler 或只调视觉参数。

## 关联 Project Spec

- `.cs/spec/index.md`：当前产品只支持浏览器 Web/PWA；本 Epic 只改善该产品边界内的 Direct 与 Relay Terminal，不引入 Electron 或原生客户端。

## 当前方案

首轮 Orca Web Direct 与 BySpace Direct 同条件阶段化基准已经完成：BySpace 在 idle/loaded/TUI keydown→commit、50,000 行 parse/paint、rAF gap 和 resize 的五次样本中均更快，没有证据支持先移植 renderer scheduler 或独立 Terminal WebSocket。

随后按用户真实 Pi CLI workflow 扩展体验边界：恢复 snapshot replay 中的 bracketed paste mode；针对 ConPTY 可能不转发 DECSET 2004 的 Windows 边界，强制把多行 clipboard 文本安全地 frame 成单个 block；浏览器图片 clipboard 经现有 binary upload 写入 daemon，并把服务端路径强制作为单个 bracketed block 送入 PTY。headed 字号、字重、minimum contrast ratio 与 ligatures A/B 保留为后续呈现切片。Relay 特有的 ACK、序号或恢复增强继续单独推进。

Terminal agent integration now treats hook installation as a provider-scoped external side effect: Claude Code, Codex, OpenCode, and Pi are independently opt-in, while the legacy global setting remains a compatibility aggregate. Pi uses its documented global extension lifecycle and also appears in the built-in Terminal profiles.

## 需求变化

- Direct Terminal 从“功能可用”提升为有明确参照对象和性能证据的完整体验。
- Relay 不追求消除物理网络差异，但必须在性能下降时保持字符、顺序、画面、恢复和安全契约完整。
- Terminal 优化从零散参数调整变成可阶段测量、可归因、可回归的持续能力。
- “完整体验”包含终端应用可理解的键盘与 clipboard 协议语义；低延迟不能掩盖 paste 被解释成错误输入。

## 架构考量

- Orca Electron-local 与 Orca Web 是不同传输路径；本 Epic 的主要参照是 Orca Web Direct，共享 renderer 代码可以参考，Electron 原生 producer 控制不能原样复制。
- BySpace 已有权威 headless snapshot、output revision 和恢复路径。新增流控或序号时应扩展这些能力，不建立第二套恢复系统。
- BySpace 当前 leading-edge 输出与即时输入优于 Orca Web 的 trailing-only 输出批处理和普通输入 debounce；不能为对齐实现而倒退。
- 独立 Terminal WebSocket 可以隔离传输排队，但不能单独消除浏览器主线程上的大型 agent JSON parse/render；是否采用必须由阶段化基准决定。
- renderer scheduler 若成为首要方向，只移植能被 profile 证明需要的 chunk、time budget、visibility 与 yield 行为，不整套复制 Orca 的大型状态机。
- 首轮同条件数据未显示 renderer、共享连接或 resize 是 Local Direct 的现行瓶颈；除非后续真实 workload 提供新证据，否则不提前购买这些架构复杂度。
- 任何协议扩展都保持新旧 client/daemon 双向可解析，并在单点 capability gate 后提供干净的下游形状。
- BySpace 已有 authoritative worker `TerminalInputModeTracker` 和 snapshot `replayPreamble`；bracketed paste 应扩展这条现有状态恢复路径，而不是在浏览器另建猜测状态。
- 图片 clipboard 属于浏览器拥有的二进制数据；不能依赖远端 Pi 进程读取浏览器所在机器的系统剪贴板。应由 client 读取、daemon 安全落盘并把 daemon 可访问路径作为一次 paste 输入。
- Agent hook state is independent from managed-provider enablement because users can run provider CLIs manually in Terminal. Startup installs enabled hooks but does not let a disabled secondary/test daemon remove another daemon's global hook files; only a live provider switch change performs removal.

## 质量约束与取舍

- 性能效率 / 时间特性：
  - 约束：Direct 在同条件对照中不得明显落后于 Orca Web Direct；首轮数据已证明当前 raw Direct 更快，后续 Issue 必须保护该基线，跨机器 CI 预算取得 CI 样本后再固化。
  - 取舍：Relay 可以因公网和加密成本降低响应与吞吐，不要求达到 Direct 的数值。
  - 继承：所有 Direct renderer、transport 和 daemon 优化 Issue。
- 可靠性 / 可恢复性：
  - 约束：Direct 与 Relay 都不得丢字符、重复、乱序、留下损坏画面或永久卡死；发生背压或断流时必须回到权威 snapshot。
  - 取舍：Relay 可以通过 snapshot 跳过中间绘制过程来保持有界资源，但最终状态必须正确。
  - 继承：所有输出调度、ACK、序号和恢复 Issue。
- 兼容性 / 互操作性：
  - 约束：协议变化遵守 BySpace 的 client/daemon 向后兼容契约；旧版本仍能解析，新增能力集中检测。
  - 取舍：新能力可以要求新 daemon，不为旧 daemon 实现降级版新功能。
  - 继承：所有 protocol、client、server 与 relay Issue。
- 输入语义 / 应用兼容性：
  - 约束：多行 paste 必须保留为一个 paste block；图片 clipboard 必须在 Direct 下形成 daemon 侧真实文件路径并可被 Pi CLI 消费；普通按键和显式 Alt+V 不被误吞。
  - 取舍：图片 paste 可以要求新 daemon capability；不把图片 base64 当作终端字符流发送，也不假装远端进程能读取浏览器本机剪贴板。
  - 继承：文本 paste 修复与图片 clipboard Issue。
- 可维护性 / 可分析性：
  - 约束：每项非平凡优化必须留下定向回归测试和可重复基准；性能结论能定位到 input、daemon、transport、decode、xterm commit 中的阶段。
  - 取舍：不为了理论最优引入未经测量需要的大型 scheduler 或双重恢复状态机。
  - 继承：整个 Epic。
- 信息安全性：
  - 约束：Relay 的端到端加密与身份边界不能因性能优化而削弱。
  - 取舍：接受必要加密开销，把它计入 Relay 的有界性能下降。
  - 继承：所有 Relay transport Issue。

## 统一语言

- Direct：浏览器不经过 Cloudflare Relay，直接连接 daemon；包括 localhost 和局域网直连。
- Direct 参考体验：同条件下不得明显落后于 Orca Web Direct 的完整 Terminal 体验，不等同于某个尚未测量的固定毫秒数。
- Relay 有界降级：只允许时间特性和吞吐相对 Direct 下降，正确性、恢复与安全契约不降级。
- 同条件对照：使用同一机器、同一浏览器、同一终端尺寸和同一 shell workload 比较两套 Web Direct 链路。

## 当前推进

### 可推进范围

- 扩展现有 terminal input-mode replay，修复 snapshot attach/restore 后丢失 bracketed paste mode。
- 建立图片 clipboard → daemon 临时文件 → PTY 路径的独立设计与实现 Issue。
- 在输入语义正确后继续 headed Terminal 呈现 A/B，并保护当前更快的 Direct 时间基线。

### Issues

- [ ] `.cs/issues/2026/07/21/open-terminal-direct-baseline/index.md`：raw 性能和输入语义根因已形成关闭证据；等待用户在真实 Windows + Pi CLI 验证后确认 Explore 毕业。
- [x] `.cs/issues/2026/07/21/closed-terminal-bracketed-paste-restore/index.md`：snapshot 后恢复 DEC private mode 2004，多行 paste 保持单个 bracketed block。
- [x] `.cs/issues/2026/07/21/closed-terminal-clipboard-image-paste.md`：复用现有 binary upload，把浏览器 clipboard 图片写入 daemon 并向 PTY paste 服务端 path。
- [x] `.cs/issues/2026/07/21/closed-terminal-windows-bracketed-paste-fallback/index.md`：Windows 多行文本不依赖 ConPTY 是否转发 DECSET 2004；生成的图片路径始终强制 framing。
- [x] `.cs/issues/2026/07/21/closed-pi-terminal-agents.md`：Terminal hooks 使用 provider 独立开关；Pi 通过全局 extension 上报 activity，并进入默认 Terminal profiles。

### 剩余阻碍

- 已关闭 snapshot restore、Windows ConPTY mode 缺失兜底和浏览器图片上传三个输入语义边界；等待用户用真实 Windows 浏览器 + Pi CLI 复验多行文本与图片粘贴。
- headed 主观渲染差距仍未分解；跨机器绝对 CI gate 也还没有 CI 样本。

## 暂不推进范围

- Electron、本地原生 renderer 或 Ghostty 集成。
- 为了整齐而整体复制 Orca 的 renderer scheduler、输入 debounce 或输出批处理参数。
- 在首轮基准前实现独立 Terminal WebSocket、Relay ACK 或新序号协议。
- 要求 Relay 在公网 RTT 下达到与 Direct 相同的延迟数值。

## 未确认问题

- raw Direct 性能不落后已经确认；用户感知差距至少包含已复现的文本 paste 语义和源码确认缺失的图片 clipboard 路径，视觉呈现仍待 headed A/B。
- 默认字号目前复用全局 code font size；是否需要 Terminal 专属字号，要由 A/B 收益与设置复杂度共同决定。
- 独立 Terminal transport 和 renderer scheduler 只有在新的真实负载证据出现时才升级为实现方向。

## 关闭条件

- Direct Terminal 在已确认的交互、重负载渲染、resize 与稳定性场景中达到 Orca Web Direct 同等级体验，并有可重复证据。
- Direct 下普通按键、多行 bracketed paste、图片 clipboard 与 Pi CLI 等终端应用保持正确语义，并有 Windows 真实浏览器或等价自动化证据。
- Relay 的允许性能差距有独立预算，同时正确性、恢复和安全性证据完整。
- 所有协议变化通过新旧 client/daemon 兼容验证。
- 长期有效的 Terminal 能力、质量边界和验证入口合并回 Project Spec，用户明确确认 Epic 关闭。

## 合并回 Project Spec 的候选

- Direct 是 Terminal 的完整参考路径，Relay 只允许有界性能下降。
- Terminal 的稳定传输、恢复和可观测性架构。
- 可持续执行的 Terminal 性能预算与验证入口。

## 关闭回写

- 状态：关闭时改为 `closed`。
- 合并位置：预计扩展 `.cs/spec/` 下的 Terminal 能力说明，并由 `.cs/spec/index.md` 建立阅读入口。
- Vision 同步：当前没有来源 Vision；关闭时确认是否需要新增目标体验链接，不自动改写目标世界。
- 保留材料：对照数据、被排除方案和阶段性实现证据留在本 Epic 与 Issues 中。

## 相关材料

- `docs/terminal-performance.md`：理解当前 BySpace Terminal 性能路径、不变量、现有基准和 Orca 可迁移机制时阅读。
