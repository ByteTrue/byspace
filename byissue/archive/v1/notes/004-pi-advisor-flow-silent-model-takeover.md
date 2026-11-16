# 004：pi 会话模型被静默篡改——pi-advisor-flow 的 alwaysOn 接管

来源：2026-09-29 会话 `01a0d161`（byspace worktree lavish-sloth）报告「qwen3.8-max + xhigh 被改成 glm-5.3 + 低思考」。排查结论与 issue 056 的「纯显示层回退」相反：**会话本体这次真的被改了**，改写者不在 daemon 也不在 pi 核心，而是 pi 的扩展 `pi-advisor-flow`。

## 机制（触发链）

1. `~/.pi/agent/advisor.json` 配置 `alwaysOn: true` 且 `executor: bytetrueapi/glm-5.3`。
2. pi 每次启动/恢复会话（含 byspace daemon 重启后 resume agent）触发 `session_start` 事件。
3. pi-advisor-flow 的 session_start handler 因 `alwaysOn` 执行 `activateAdvisor` → `setExecutorModel(executor)` → **`pi.setModel("glm-5.3")` 直接覆盖会话当前模型**，并追加 `model_change` 到 jsonl。
4. thinking 同步被踩：pi 的 `setModel` 内部按新模型 clamp 思考档位（glm-5.3 无 xhigh → 就近取 max）。用户以为的「low」是 BySpace UI 显示层问题（见 issue 056），实际档位是 max。

**为什么完全静默**：扩展的 activate 通知走 `ctx.hasUI` 才显示，byspace 以 RPC 模式拉起 pi 无 UI——零提示。且 `~/.pi/agent/settings.json` 的 `packages` 列表装着它，每次会话自动生效。

**executor 怎么被污染的**：flow 启用期间任何一次 `set` 来源的 `model_select`（用户在任意 pi 会话手动切模型）都会被同步持久化为新 executor 写回 advisor.json。即用户某次切到 glm-5.3 的动作被记成了 executor 默认值。

## 排查路径（下次直接抄）

1. 疑似模型被改时，先看 pi 会话 jsonl（`~/.pi/agent/sessions/<cwd-dir>/<id>.jsonl`）里的 `model_change` / `thinking_level_change` 条目时间戳，与 daemon.log 的 `Agent resumed from persistence` 对时——**同毫秒出现即 resume 内部写入，不是客户端 RPC**。
2. daemon.log 窗口内查 `set_agent_model_request` / `agent.config.apply`——零条即排除客户端路径。
3. 复现实验：拷贝 jsonl，用 byspace 同款 argv 拉 pi（`--mode rpc --model <想要的> --thinking <想要的> --session <file> --approve`）+ `get_state`：带全部扩展复现 → `--no-extensions` 不复现 → 逐个 `--extension <path>/dist/index.js` 加回，锁定元凶。
4. `~/.pi/agent/settings.json` 的 `packages` 列表就是扩展清单，逐个怀疑。

## 与 issue 056 的关系

056（2026-09-28 晚）针对同一症状「切回会话显示 qwen3.8-max + Low」诊断出**显示层回退链**并修复，当时核验「会话本体未被改」在当时的证据下成立（daemon 写入路径确实干净）。但 2026-09-29 晨的复发走的是 056 没覆盖的路径：pi 进程内部扩展篡改 jsonl 本体。两者叠加误导了定位——显示层修好后仍「被改」，说明还有第二个写入源。056 的显示层修复仍然正确且必要（本 case 中 glm-5.3 无 xhigh、UI 把 max 显示成 low 也是它管的现象之一）。

## 修复选项（按推荐排序）

1. `advisor.json` 的 `alwaysOn` 改 `false`：保留 /advisor 手动激活，根治每次 session_start 的强制接管。注意同步陷阱：flow 启用期间手动切模型会回写 executor。
2. 从 `settings.json` packages 移除 `pi-advisor-flow`：彻底放弃 advisor 功能。
3. 上游反馈：alwaysOn 不应覆盖显式 `--model`；RPC 模式无 UI 时至少要留日志。
4. BySpace 侧兜底（可选）：resume 后对 `get_state` 模型与持久化 config 比对，不一致时告警——能拦住未来任何扩展级篡改。

## 通用教训

- 「模型被改」类问题有三个独立写入源：客户端 RPC（daemon.log 可查）、pi 恢复回退（`restoreModelFromSession`，只在模型/provider 不存在时发生）、**扩展 session_start 钩子（完全无日志）**。前两个排查干净不等于没事，第三个要靠隔离实验。
- 复现实验是终审证据：`--no-extensions` 二分法一次就能把责任从「pi 核心/byspace」切到「扩展」。
- pi 的 `--extension` 可以指定单包路径逐个加载，是扩展问题的标准隔离手段。
