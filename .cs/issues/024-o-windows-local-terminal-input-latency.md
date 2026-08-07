---
kind: issue
title: "Windows Local Direct Terminal 输入延迟复发"
type: bug
status: open
created: 2026-08-07
epic: ".cs/epics/2026/07/21/terminal-experience/spec.md"
---

# Windows Local Direct Terminal 输入延迟复发

## 目标

Windows Chrome 通过 daemon 自带的 localhost Web UI 使用 Local Direct Terminal 时，普通逐键输入应持续即时回显；刷新页面不应成为恢复流畅度的手段。

## 当前证据

- 用户 2026-08-07 反馈：同一产品在 macOS 很少卡，Windows 本地 Web 经常出现 Terminal 输入延迟；刷新 Web 页面有时暂时恢复流畅。
- 问题设备 `0.4.0` 的完整日志 `/Users/byte/Downloads/daemon.log` 覆盖 2026-08-07 06:45–23:16（1,980 个 30s metrics 窗口）：共启动 135,861 次 Git 命令，约 2.29 次/秒；`eventLoopDelay.maxMs` p50 405.3ms / p95 1,967.1ms / max 4,131.4ms。
- Git 命令数与 event-loop max 的相关系数为 0.748，与 Git execution p95 的相关系数为 0.808。无 Git 命令的窗口 event-loop max p50 29.6ms；至少 20 次 Git 命令的窗口 p50 784.3ms。
- 110 个包含 `terminal_input` 的窗口中，event-loop max p50 1,083.2ms / p95 2,065.7ms。`terminal_input` handler 自身 p50 多为 0ms，只说明回调开始执行后很快；它不计入消息已到达但 event loop 尚未调度回调的等待。
- 日志给出自然 A/B：17:31–18:05，checkout diff + 两个 workspace Git observer 时 event-loop max p50 1,587.5ms；18:05 diff subscription 关闭后降至 419.4ms；18:33 observer 从两个降为一个后再降至 43.7ms。
- 旧 010 日志约 18 小时 15.5 万次 Git 命令（约 2.39 次/秒）；当前仍为 2.29 次/秒。010 的 phase spreading 降低了同相爆发，但没有降低总 subprocess 密度，因而不能视为根因已经关闭。
- 当前 checkout 的隔离 Local Direct 压测未复现 Windows 症状：daemon 600 键 burst 的 send→output p50 10.73ms / p95 13.69ms，event-loop p99 11.4ms / max 34.4ms；浏览器 keydown→input frame p95 0.1ms，xterm write p95 1ms。该 macOS 对照与 Windows 日志一致指向平台上的 Git subprocess/event-loop 路径，而不是 Terminal wire 或 xterm write。
- 同一次 opt-in 压测的 mock-agent 阶段因页面重新加载后 probe 未重新安装而超时；daemon 实际发出了 1004 个 `agent_stream`，浏览器 probe 记录为 0。此失败不作为产品延迟证据，也不为本 issue 顺手修改测试工具。

## 必须区分的阶段

1. keydown → binary input frame：浏览器主线程、React/事件处理。
2. input frame → PTY output：WebSocket、daemon event loop、ConPTY/前台应用。
3. binary output received → xterm commit：客户端 decode、stream controller、runtime queue、xterm renderer。
4. xterm commit 正常但肉眼迟：renderer/GPU/compositor。

没有分段数据前不得加 scheduler、换 transport、升级 xterm 或按平台写特殊路径。

## 当前可证伪假设

- WebGL context loss 是候选，不是结论。xterm 在 context 3 秒未恢复时会输出 `webgl context not restored; firing onContextLoss`；BySpace 随后永久 dispose WebGL 并降级到 DOM renderer，刷新页面会重新尝试 WebGL。Windows 的 GPU/驱动/context 上限可能使该路径更常见，但必须先由问题发生时的浏览器 console 或 trace 确认。
- **已确认主因：Windows daemon 的 Git subprocess 密度与并发启动阻塞 event loop。** 修复前 checkout diff 的 150ms watcher refresh 强制绕过缓存，并按 tracked path 以 8 路 `git diff` 启动子进程；每个被观察 Workspace 还保留 60s 全量 Git self-heal。完整日志中的相关性与 subscription 数量自然 A/B 已关闭“只是浏览器慢”的替代解释。
- 首次错误宽度导致的长快照重复排版已在 013 的 2026-08-07 残余修复中单独处理；若输入只在首次 restore 期间迟，应归该路径，不在这里再造第二个修复。

## 当前修复

- Git/forge 状态改为全平台统一的 demand-driven 模型：没有文件系统触发的 Git refresh、60s workspace self-heal、3 分钟 background fetch 或 GitHub PR adaptive poll。checkout diff subscription 只首读一次；之后仅 `checkout.refresh.request` 和 BySpace 自己完成的 Git mutation 会刷新。外部程序修改仓库后 UI 可保持旧状态，直到用户手动刷新。
- 默认 Git 并发在所有平台统一为 2；`BYSPACE_GIT_CONCURRENCY` 显式配置仍优先，不再有 Windows/macOS 默认分支。
- tracked text diff 每个 subprocess 最多合并 64 个 path；structured diff 的历史内容从每文件一个 `git show` 改为一次 `git cat-file --batch`。已有单文件/总量上限、binary/too-large placeholder 与异常 fallback 保持不变。
- macOS 隔离 E2E：1,200 个 tracked 修改时 checkout 948ms、原生 `git diff` 171ms、比值 5.54×，通过 `<10×` 门槛；100 文件门槛也通过。

## 下一份必要证据

问题再次出现且刷新前，保留同一分钟：

- Windows `~/.byspace/daemon.log`（至少前后各 2 分钟，重点是 `ws_runtime_metrics`）。
- Chrome DevTools Console 中是否出现 `webglcontextlost`、`webglcontextrestored` 或 `webgl context not restored`。
- `chrome://gpu` 的 Graphics Feature Status 与 Problems Detected（无需任何隐私数据）。
- 若 daemon event loop 正常且无 WebGL context loss，再录一份 DevTools Performance trace，覆盖 5 秒普通输入；按上述四段定位阻塞点。

## 质量目标

- Windows 实机普通逐键 keydown→可见 commit 的 p50/p95/max 先测修复前基线，再定义预算并做 A/B。
- 修复必须关闭一个能由单一变量稳定开关的根因；刷新、UA 伪装或 macOS 数字不能作为 Windows 验收。
- 不得破坏字节顺序、快照/revision recovery、隐藏 Terminal 停流或 Local Direct 优先级。
