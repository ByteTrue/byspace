---
kind: issue
title: "补回成本/速率类不变量：运行时指标、终端背压、后台 fetch、检查详情上限"
type: ff
created: 2026-11-01
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# 补回成本/速率类不变量：运行时指标、终端背压、后台 fetch、检查详情上限

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。
> **自检：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `byissue/` 有无影响。

---

上一轮从「帧=DO 请求」那次事故里盘出 5 条同类缺口（行为正常、只是资源多花一个数量级，四道既有守卫都看不见）。本轮把其中 4 条按 Node 语义补回，1 条判 N/A，1 条转 issue。现在 daemon 第一次能自己回答「谁在发帧、发的是什么」。

- 改动：
  - `internal/server/runtime_metrics.go`（新）— 30s 一条 `ws_runtime_metrics`：入站/出站消息类型 top、`agent_stream` 按事件类型与 agent 分桶、`bufferedAmount` p50/p95/max、同步处理耗时、goroutine/heap、ticker 漂移（Node `eventLoopDelay` 的 Go 等价物）。Node 有而本 daemon 没埋点的 15 个生命周期计数器**不输出 0**，宁可缺字段也不给假零。
  - `internal/server/server.go` — `wsSink.pending` 记录未刷出的字节（`bufferedAmount` 的等价物）、`Buffered()`、`sinkBuffered()` 返回「是否可知」、入站/出站挂钩、relay 适配器转发 backlog。
  - `internal/server/ws_workspace.go` — 终端输出背压门：`outputBytesSinceSnapshot > 256KB` **且** 客户端 backlog `> 4MB` 才回落到快照（1000 行 scrollback）；transport 无背压信号时按「落后」处理，与 Node 的 `null` 分支一致。
  - `internal/server/background_fetch.go`（新）— 180s 后台 `git fetch origin --prune`，按仓库去重（worktree 共享 refs）、串行、复用 `workspace.GitNetworkTimeout`。
  - `internal/workspace/forge.go` + `git.go` — `CheckDetails` 的 `failedJobs` 此前恒为 `[]`（等于没有）：现在按 Node 取失败 job（上限 5）、每个取日志尾（200 行 / 16KB）、`truncated` 三处来源（job 页满、失败数超限、日志被截）并补 annotations 的 `per_page=20`；导出 `GitNetworkTimeout` 供后台 fetch 使用。
- 验证：新增 4 个测试文件 — 背压两条件（含「恰好在阈值」与「无信号」）、metrics 窗口内容与重置、fetch 目标去重与 180s 常量、检查详情 5 条上限与日志尾保留的是「最后 200 行」以及 UTF-8 后缀不劈开字符；`go test ./internal/server ./internal/workspace ./internal/terminal` 全绿；`npm run audit -- --no-browser` 全绿（Go 测试 + 出入站字段 + 台账一致）。
- byissue：已同步台账「同类缺口」小节（4 条已补、1 条 N/A）；PR 状态轮询转 `2026-11-01-o-forge-pr-status-push.md`。

顺手发现：`file-observer` 的 250,000 条目上限在 Go 里**没有对应实体**——daemon 走 1s 轮询、没有 watcher 条目表（`decisions/004` 已记录机制差异），所以这条不是遗漏。

未验证：`ws_runtime_metrics` 30s 行只在单元测试里验证过输出形状；运行中的 daemon（6777）不能被重启，真机观察留待下次自然重启后 `grep ws_runtime_metrics ~/.byspace/daemon.log`。
