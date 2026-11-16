# 007：pi-subagent 超时 timer 会迟到、退出通知会积压、运行中升级包不生效

> **读者：** 用 subagent 工具跑长任务的人；等 subagent 通知没等到的人；升级 pi 扩展包后想验证新代码是否生效的人。
> **自检：** 一句话结论 · 何时用 · 坑 · 相关位置。

---

**结论：** pi-subagent 的超时定时器（`timeoutTimer = setTimeout(() => abort("timeout"), timeoutMs)`）在 deadline 过后可能长时间不触发——触发点几乎总是子进程自然结束（最后一条 assistant 消息 / close）时刻。复现 5 次，迟到 51s～102s，事故一次迟到 **54m50s**。根因未定（已排除系统睡眠、事件循环冻结、unref 缺陷、stdout 洪流饿死 timers、线程模型、kill 失效），修复建议已交给 pi-package-mono 侧。

**何时用：** 任何依赖 `timeoutMs` 兜底、或等待 `subagent-exit` 通知的编排——尤其长任务。

## 坑

- **不要依赖 timeout 兜底。** 子进程会越过 deadline 一直跑到自然完成。长任务显式传 `timeoutMs` + 主动轮询 `subagent_status`。
- **pause 文案骗人。** "timed out after 20m0s" 打印的是配置值 `fmtDur(timeoutMs)`，不是实际 elapsed——实际可能是 74m50s。看 elapsed 字段。
- **退出通知按父回合门控积压。** `subagent-exit` 在父 agent 回合忙碌时入队（agentBusy 门控），回合结束才 flush；父回合连续跑数小时，通知就积压数小时。等通知的编排要设自己的超时。
- **运行中的 pi 不加载新包。** 扩展经 jiti 在进程启动时加载；npm 更新包后磁盘是新版、进程里跑的还是旧版。升级扩展后要重启 pi agent 才生效。
- **复现实验别用 maxTurns=1。** max_turns 路径在第一条 assistant 消息到达时按设计触发，会污染 timer 测试（踩过）。用 maxTurns=50。
- **排查父进程是否活着，用 bili.log 客户端行。** `~/.local/state/billion-context/bili.log` 由两个进程写：带 `[sess=...]` 前缀的是父进程内插件（processTurn / forward POST 行），不带的是独立 proxy。客户端行的时间戳是父进程主线程活性的直接证据。
- **考古实际加载的扩展源码，用 jiti 缓存。** `%TEMP%/jiti/src-index.*.mjs` 的 mtime = 编译时刻，文件头 createRequire 的路径 = 实际源位置，可与包落盘时间对照确认版本错位。

## 相关位置

- 扩展源码：`~/.pi/agent/npm/node_modules/@bytetrue/pi-subagent/src/index.ts`（abort ~L1069、timeoutTimer ~L1080、close handler ~L1143，0.12.0 行号）。
- 子代理会话日志：`~/.pi/agent/sessions/<worktree-dir>/..._sub_*.jsonl`，最后一行截断=被 kill，完整=自然退出。
- 事故时间线与完整排除清单：2026-10-03/04 会话（zealous-piranha worktree），bug 报告提示词已交用户转 pi-package-mono 侧 Agent。
