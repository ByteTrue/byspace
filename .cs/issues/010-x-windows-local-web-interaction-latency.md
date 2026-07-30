---
kind: issue
title: "Windows Local Direct 页面与 Terminal 间歇性高延迟"
type: bug
status: closed
created: 2026-07-30
epic: ""
---

# Windows Local Direct 页面与 Terminal 间歇性高延迟

## 目标

Windows 上使用 daemon 自带的 `http://localhost:6777` Web UI 直连本机 daemon 时，切换 Workspace、Agent 与 Terminal 应保持可预测的即时反馈；持续运行的后台 Agent、长 Timeline 或隐藏 Terminal 不得让交互出现秒级停顿。

## 归属

- 独立性能 bug；Terminal 子路径关联 `.cs/epics/2026/07/21/terminal-experience/spec.md`。
- 相关系统说明：`docs/terminal-performance.md`、`docs/development.md`、`docs/expo-router.md`。

## 当前证据

- 预期行为：Local Direct 没有 Relay RTT 与加解密开销，Workspace/Tab 切换应接近本地 UI 切换速度；Terminal attach 的 daemon RPC 本身不应成为可见瓶颈。
- 实际行为：用户在 Windows Chrome 直接打开 Localhost 并连接本地 daemon，仍间歇遇到 Workspace 很久才显示内容、切到 Terminal 延迟很高，整体性能表现差。
- 最小场景：
  1. Windows Chrome → `http://localhost:6777` → 在已有 Workspace 间切换。
  2. 在包含长时间运行 Pi Agent 与多个 Terminal Tab 的 Workspace 内切换 Agent/Terminal。
- 原始证据：用户 2026-07-30 反馈；2026-07-31 已取得问题设备正式版 `0.2.1` 的完整 Windows daemon 日志。

### Windows 正式版日志基线（修复前）

- 约 18 小时内启动约 15.5 万次 Git 命令，平均每 30 秒 69 次、峰值 585 次。
- 每 30 秒 event-loop 最大延迟 p95 为 1.06s、峰值 2.75s；Git 命令数与 event-loop 延迟的相关系数为 0.72。
- 最强反例窗口中没有已加载 Agent、没有 Terminal stream、浏览器仅发送 heartbeat，但 daemon 仍运行 162 次 Git 命令/30s，同时 event loop 卡住 2.75s。
- `subscribe_checkout_diff` 有 300 次慢请求，中位约 2s、p95 9.4s；`checkout.commits.list` 有 290 次慢请求，中位约 2.05s。
- 26 次慢 Timeline 请求中，25 次精确对应 `Agent resumed from persistence`；Provider runtime 冷恢复耗时 3.6–10.95s。这是与 Git 风暴、隐藏 Terminal 独立的第二条慢路径。

### 修复前代码与本机对照

- Workspace deck 最多保留 3 个 Workspace；每个 pane 最多保留 3 个 Tab。超出后重新挂载，但 macOS 本机 0.2.1 对照中，已保留与被逐出后重新进入 Workspace 的首个可见内容均为 43–81ms。
- 激活 Workspace 时，所有保留的 Terminal Tab 都会挂载并订阅；`TerminalPane` 的输出写入只检查 `isWorkspaceFocused`，不检查 `isPaneFocused`。因此不可见 Terminal 仍可能持续解码并写入隐藏 xterm。
- macOS 本机真实 daemon 曾同时保有 2 个 Terminal subscription，每 30 秒约 1,000–2,000 个 binary frame，WebSocket `bufferedAmount` 峰值 6.2MiB。
- 同一 daemon 的长 Pi 会话约有 7,300–7,800 个 Timeline source row；一次 `fetch_agent_timeline_request` 为 2.125s，`pull_request_timeline_request` 为 5.37s，多个 `clear_agent_attention` 为 2.15–2.20s，而 `subscribe_terminal_request` 为 0–1ms。后续绕过浏览器、直接用 SDK 对当前活跃长会话请求 projected tail（100 项、约 576KB）连续 10 次仅 6.5–10.6ms，说明 warm Timeline 服务端计算不是已观测秒级停顿的主因；此前秒级 client latency 更符合浏览器处理被后台负载阻塞。
- macOS 控制测量：保留 Terminal warm switch 为 7–36ms，冷创建到 renderer ready 为 131ms；让隐藏 Terminal 以约 1MB/s 输出时，20 次 Agent↔Terminal 可见切换仍为 7–25ms 且无 >50ms long task。问题尚未在 macOS 复现，Windows 或用户真实状态是必要因素。

## 待确认问题

- Windows 侧 BySpace/daemon 版本、Chrome 版本、CPU/GPU 与硬件加速状态。
- 卡顿是否只在 Agent/Terminal 正持续输出时发生；关闭所有 Terminal Tab 或停止输出后是否立即改善。
- 慢 Workspace 是否都有长 Timeline、多个保留 Tab，还是新建空 Workspace 也会发生。
- 卡顿期间 Windows daemon 的 RPC latency、event-loop delay、binary frame 数与 WebSocket buffered amount。

## 修复前如何工作

Sidebar 点击先通过 Expo Router 更新 active Workspace；Workspace deck 以 LRU 保留最多 3 个 `WorkspaceScreen`。每个 pane 再保留最多 3 个 Tab。Agent 复用 Host replica 并按需做 authoritative Timeline 恢复；Terminal 在 Workspace 激活时挂载 xterm、订阅 daemon stream、恢复 snapshot。Terminal Tab 即使不可见，只要所属 Workspace 仍激活，就继续接收并写入输出。

## 影响范围

- 必须调查：浏览器点击到首帧/内容 ready 分段、React commit/long task、Timeline fetch/projection、Terminal mount/snapshot/隐藏输出。
- 需要验证：Windows Local Direct；空/长 Timeline；无输出/后台高输出；warm/evicted Workspace；warm/cold Terminal。
- 明确不包含：Relay 性能、视觉 loading 改造、无证据地扩大 retained cap、Terminal 协议或 xterm 版本升级。

## 质量目标

- Local Direct 交互延迟：先在用户 Windows 场景记录修复前 p50/p95/max，再为 warm Workspace、cold Workspace、warm Terminal、cold Terminal 各自设预算；不以 macOS 数字冒充 Windows 结论。
- 背景隔离：隐藏 Agent/Terminal 的持续活动不能造成可见 Workspace 的秒级交互停顿。
- 正确性：优化不得丢 Terminal 字节、乱序、破坏 snapshot 恢复、漏 Timeline 消息，或改变 Workspace/Tab 保留语义。
- 可回归：留下可重复的浏览器 profile 场景与机器可判定断言，而不是只靠体感。

## 根因定位

- **已确认的主因：Git 后台任务风暴。** 每个被观察 Workspace 的 60s Git self-heal 同相触发；每个 repo 的 180s fetch 也同相触发，并在 fetch 后通过 `Promise.all` 并发刷新该 repo 下所有 Workspace。客户端 retained Changes/Commit Diff 还会在隐藏时保有 commits/file-diff 查询，checkout status push 又会因纯 dirty-state 更新无条件 invalidate commits。正式版日志中的 Git 密度、慢 diff/commits RPC 与 event-loop 延迟形成同窗证据。
- **已确认并修复的独立慢路径：Agent 冷恢复。** 空闲 Agent runtime 被回收后，历史读取过去会无条件恢复 Provider，产生 3.6–10.95s 延迟；现在 daemon 进程内保留的 canonical Timeline replica 与 stored agent snapshot 直接满足只读 fetch，只有缺少 replica 或发生 Provider mutation 时才恢复 runtime。
- **已确认的次因：隐藏 Terminal stream。** 同一激活 Workspace 内，隐藏 retained Terminal Tab 仍持有 daemon stream、接收二进制帧并持续写入隐藏 xterm；PR #12 已单独修复。
- 已排除：warm 活跃长 Timeline 的服务端投影本身。真实 576KB projected tail 连续请求仅 6.5–10.6ms。
- 影响面：Windows Local Direct 最明显，但 Git 后台风暴和冷恢复等待均为跨平台结构性问题。

## 反馈回路

- 浏览器：记录点击、route commit、Workspace deck visible、Agent content visible、Terminal renderer ready、attach overlay 消失、long task 与 frame gap。
- daemon：从 `~/.byspace/daemon.log` 对齐同一分钟的 `ws_runtime_metrics`，读取 request latency、event-loop delay、binary frames、buffered amount、Timeline row 数。
- 断言：相同状态下可稳定复现秒级阶段，并能由单一变量（隐藏输出、Timeline 规模、eviction）打开/关闭。

## 修复方案

### Slice A：Terminal stream（PR #12）

- Terminal stream 所有权跟随组合后的 `RetainedPanel` 可见状态；隐藏时 unsubscribe，重显时复用 authoritative snapshot/revision recovery。
- Split pane 中仍可见但未聚焦的 Terminal 继续持有 stream。

### Slice B：Git 后台负载

- 隐藏 retained Changes/Commit Diff 不再启动 commits/file-diff 查询。
- checkout status 的纯 dirty-state 更新不再使 commits 查询失效；daemon 通过 optional opaque `commitsVersion` 明确传递 commits cache 失效语义，旧 daemon 缺字段时客户端保持保守 invalidation。
- 60s Workspace self-heal 和 180s repo fetch 使用稳定分散的首次 phase；repo fetch 后的 Workspace 刷新串行执行，避免子进程并发风暴。
- 不删除 self-heal/fetch，也不降低 Git 状态正确性；保留当前恢复周期和显式 refresh 行为。

### Slice C：Timeline 冷恢复

- 历史 Timeline 的首屏展示不得等待已回收 Provider runtime 恢复；daemon-retained canonical Timeline replica 与 stored agent snapshot 先满足读取，Provider runtime 在缺少 replica 或需要继续执行时恢复。
- fast path 只在候选 retained state 上等待正在进行的 runtime close，且只有 `closed` snapshot 持久化成功后才允许无 runtime 读取；reload 共享同一 Agent lifecycle gate，删除则同时 fence storage 与 runtime registration，避免 fallback 竞态复活 Provider。随后只读 projection 不 touch Agent activity，也不阻止后续 idle collection。
- daemon 重启后没有内存 replica 时保持原有 Provider resume + hydration；本 slice 不新增第二套持久化 Timeline。
- 不改 Timeline wire schema，不用 loading 掩盖 3–11s 等待，也不与 Git 修复耦合。

## 实现设计

### 一步步怎么改

1. `TerminalPane` 直接读取组合后的 retained-panel activity，得到真实可见性。
2. 仅在 Workspace focused 且 pane visible 时给 `TerminalStreamController` 设置 terminal id。
3. 隐藏时由现有 controller cleanup 发送 unsubscribe；显示时重新 subscribe，不新建恢复协议。
4. output/restore/snapshot 回调用同一 predicate 防止 effect cleanup 前的在途事件写入隐藏 xterm；snapshot 仍可进入既有 workspace cache。
5. 用真实 Direct WebSocket 回归验证 subscription 集合、隐藏输出恢复和 split-pane 可见语义。

### 怎么确认做对

- 同 pane 两个 retained Terminal 的 active stream 集合始终只包含可见 Tab。
- A 隐藏期间继续产生输出，回到 A 后完整显示 sentinel，证明不是静默丢帧。
- split 后 Terminal 虽失去 pane focus 但仍可见，subscription 不被移除。
- Windows 原有工作负载 A/B 未完成，作为本次关闭的显式残余风险；若症状再次出现再建立新证据链。

## 验证

- Desktop Chrome E2E：同 pane 两个 retained Terminal 始终只有可见 Tab 持有 stream；切换时前一个 unsubscribe、后一个 subscribe；隐藏期间产生的 PTY 输出在重新显示后由 authoritative snapshot 恢复；split 后失焦但仍可见的 Terminal 保持订阅。`terminal-retained-stream.spec.ts` 1/1 通过（3.6–4.1s）。
- Timeline daemon E2E：idle collection 与 fetch 并发时会等待 close flush；完成后 Agent runtime 保持不存在，`fetch_agent_timeline_request` 仍返回 retained history 与 stored `closed` snapshot；delete fence 与 fetch 并发不会复活 Agent；13/13 通过。AgentManager 149/149、AgentStorage 17/17、wire compatibility 7/7 通过。
- `npm run typecheck`、目标 lint、目标 format、`git diff --check` 与真实 Web export 均通过。
- 两轮独立 correctness review 无 blocker/high/medium；ponytail review 后将 visibility hook 收回唯一调用方并精简测试 probe。
- Windows Local Direct 用户场景未复测，不能用 macOS/伪装 UA 代替；用户在原设备不可用时知情接受该证据缺口并授权关闭。

## 执行记录

- 2026-07-30：完成代码路径审阅、macOS Local Direct 对照与 daemon metrics 初筛；macOS 未复现秒级卡顿，确认至少需要区分隐藏 Terminal 负载与长 Timeline 两条路径。
- 2026-07-30：直接 SDK 复测 warm 长 Timeline 为 6.5–10.6ms；实现隐藏 retained Terminal 停流与显示时权威恢复，E2E、静态检查、Web export 和独立 review 通过，等待 Windows 实机验收。
- 2026-07-31：完成 Slice B 实现。隐藏 retained Git panels 停止 commits/file-diff 查询；daemon-issued `commitsVersion` 对 dirty-only 更新保持稳定，对 HEAD/比较输入、refs watcher、repo fetch 与显式 refresh 保守推进，且旧 daemon 缺字段时保留原始 invalidation；60s/180s timer 使用稳定 per-target phase，repo fetch 的 in-flight 背压覆盖完整 sibling sequential refresh cycle。99 个相关单测、server/client build、全仓 typecheck/lint/format 与 Web export 通过。
- 2026-07-31：完成 Slice C 最小实现。timeline fetch 在 idle runtime close flush 完成后直接读取 daemon-retained canonical replica 与 stored snapshot，不调用 Provider resume；close snapshot 持久化失败时不开放 retained read。并补齐同一边界暴露的 reload lifecycle gate 与 delete registration/storage fence，防止 fallback 并发启动第二个或已删除 runtime。Provider mutation 与 daemon-restart fallback 保持原行为。Timeline E2E 13/13、AgentManager 149/149、AgentStorage 17/17、wire compatibility 7/7 通过。

## 历史关闭结论（2026-07-30，已撤销）

- 判断：用户明确授权关闭。已修复一个有独立证据的性能缺陷——隐藏 retained Terminal 不再持续占用 daemon stream 和浏览器 xterm 渲染；重显仍经权威 snapshot/revision 恢复。
- 质量证据：真实 Direct 浏览器 E2E 覆盖可见订阅唯一性、隐藏输出恢复与 split-pane 可见语义；typecheck、lint、format、Web export 通过；两轮独立 correctness review 无 blocker/high/medium，ponytail review 后已完成减法。
- 验收边界：原 Windows 设备当前不可用，因此没有 Windows 实机修复前后 A/B。关闭不代表已证明所有间歇性 Workspace 卡顿都由该缺陷造成；这是用户知情接受的残余风险。若症状再次出现，应以当时的 daemon metrics 与浏览器 trace 建立新 issue，而不是沿用本次假设。
- 毕业回写：当前 stream 所有权不变量写入 `.cs/spec/index.md`、Terminal epic 与 `docs/terminal-performance.md`；调查过程、macOS 对照和未复现边界留在本 issue。

## 重开记录

- 2026-07-31：用户补充问题设备正式版 daemon 日志。日志证明即使没有 Agent/Terminal 活动，Git 后台任务仍可令 event loop 卡住 2.75s，并同时揭示 Provider runtime 冷恢复慢路径；此前“Windows 设备不可用、接受残余风险”的关闭前提不再成立，Issue 010 重开。
- 后续按三个单一职责 PR 处理：Terminal stream（#12）、Git 后台负载、Timeline 冷恢复。三条路径全部完成并验证前不再次关闭。

## 最终关闭结论（2026-07-31）

- 三条独立根因均已完成单一职责修复：隐藏 Terminal stream（PR #12）、Git 后台负载（PR #13）、idle-collected Timeline runtime-free read（本 PR）。
- Timeline slice 不新增持久层或 wire schema：daemon 进程内 retained canonical replica 直接满足历史读取；继续执行或 daemon 重启后缺少 replica 时仍按原路径恢复 Provider。
- 并发边界一并收紧：close snapshot 未持久化不开放 retained read；reload 共享 Agent lifecycle gate；delete 同时 fence runtime registration 与 storage，不能由 Timeline fallback 复活。
- 验证：Timeline E2E 13/13、AgentManager 149/149、AgentStorage 17/17、daemon restart persistence 2/2、wire compatibility 7/7；server build、全仓 typecheck/lint/format 与 `git diff --check` 全绿；最终独立 review 无 blocker/high/medium。
- 原 Windows 设备仍不可用于发布后 A/B，因此不声称获得 Windows 端量化改善值；但正式版日志证明的三个结构性原因均已有对应修复和机器可判定回归。用户已授权按该证据链完成修复。

## 关闭回写

- Project Spec：`.cs/spec/index.md` 的 Terminal 当前真相。
- Epic Spec：`.cs/epics/2026/07/21/terminal-experience/spec.md` 的方案、架构与验证边界。
- 系统文档：`docs/terminal-performance.md` 的 retained Terminal stream 不变量。
